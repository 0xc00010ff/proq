import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import {
  startServer,
  stopServer,
  restartServer,
  healthCheck,
  onServerExit,
  getServerLogPath,
  tryConnectToExisting
} from './server'
import { startUpdateScheduler, stopUpdateScheduler } from './update-scheduler'
import {
  initShellUpdater,
  startShellUpdateScheduler,
  stopShellUpdateScheduler
} from './shell-updater'
import { getConfig, isDevMode } from './config'
import { checkForUpdates, applyUpdate } from './updater'
import { parseErrorSummary } from './error-diagnostics'

export type ExitReason = 'quit' | 'relaunch' | 'install-shell-update'

export type AppState =
  | { kind: 'idle' }
  | { kind: 'setup' }
  | { kind: 'launching' }
  | { kind: 'running' }
  | { kind: 'recovering' }
  | { kind: 'exiting'; reason: ExitReason }

export interface AppStateDeps {
  createWindow: (mode: 'wizard' | 'splash' | 'app') => BrowserWindow
  loadRendererPage: (win: BrowserWindow, hash?: string) => void
  createAppWindow: () => BrowserWindow
  log: (msg: string) => void
}

let deps: AppStateDeps | null = null
let currentState: AppState = { kind: 'idle' }
let mainWindow: BrowserWindow | null = null
let healthInterval: ReturnType<typeof setInterval> | null = null
let consecutiveFailures = 0
let serverExitWired = false
let transitionInFlight: Promise<void> | null = null
const listeners = new Set<(state: AppState) => void>()

const HEALTH_CHECK_INTERVAL_MS = 10_000
const HEALTH_FAILURES_BEFORE_RECOVERY = 3
const RECOVERY_ATTEMPTS = 3
const RECOVERY_RETRY_DELAY_MS = 2000
const SPLASH_TO_APP_DELAY_MS = 1500
const EXIT_WATCHDOG_MS = 3000

function getDeps(): AppStateDeps {
  if (!deps) throw new Error('initAppState must be called before any state operation')
  return deps
}

export function initAppState(d: AppStateDeps): void {
  deps = d
}

export function getState(): AppState {
  return currentState
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function isExiting(): boolean {
  return currentState.kind === 'exiting'
}

export function isInteractive(): boolean {
  return currentState.kind === 'running'
}

export function onStateChange(cb: (state: AppState) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function safeSendToMain(channel: string, ...args: unknown[]): void {
  if (currentState.kind === 'exiting') return
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

export async function transitionTo(next: AppState): Promise<void> {
  // Serialize concurrent calls so that the second waits for the first to settle.
  if (transitionInFlight) {
    await transitionInFlight
  }
  const run = doTransition(next)
  transitionInFlight = run.finally(() => {
    if (transitionInFlight === run) transitionInFlight = null
  })
  return run
}

async function doTransition(next: AppState): Promise<void> {
  const d = getDeps()
  const prev = currentState

  // Once exiting, ignore further transitions
  if (prev.kind === 'exiting') {
    d.log(`state: ignoring transition to ${describe(next)} (already exiting)`)
    return
  }

  // Drop redundant transitions to the same non-terminal state
  // (prev.kind cannot be 'exiting' here — caught above)
  if (prev.kind === next.kind) return

  d.log(`state: ${describe(prev)} → ${describe(next)}`)

  await exitState(prev, next)
  currentState = next
  notifyListeners(next)
  await enterState(prev, next)
}

function describe(state: AppState): string {
  return state.kind === 'exiting' ? `exiting/${state.reason}` : state.kind
}

function notifyListeners(state: AppState): void {
  for (const cb of listeners) {
    try {
      cb(state)
    } catch {
      /* swallow listener errors */
    }
  }
}

async function exitState(_prev: AppState, next: AppState): Promise<void> {
  const d = getDeps()
  // Stop everything time-driven when leaving running for any non-running state.
  if (next.kind === 'exiting' || next.kind === 'setup') {
    stopHealthMonitor()
    stopUpdateScheduler()
    stopShellUpdateScheduler()
  }
  // Going back to the wizard (Reset path) tears down the server too — the
  // wizard runs serverless. enterExiting handles its own stopServer with the
  // watchdog, so don't double-stop here.
  if (next.kind === 'setup') {
    try {
      await stopServer()
    } catch (err) {
      d.log(`exit→setup: stopServer error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function enterState(prev: AppState, state: AppState): Promise<void> {
  switch (state.kind) {
    case 'idle':
      return
    case 'setup':
      enterSetup()
      return
    case 'launching':
      await enterLaunching()
      return
    case 'running':
      enterRunning(prev)
      return
    case 'recovering':
      await enterRecovering()
      return
    case 'exiting':
      await enterExiting(state.reason)
      return
  }
}

function enterSetup(): void {
  const d = getDeps()
  // Reset is the only path that lands here after launch — destroy any stale windows
  // so we start from a known-clean wizard.
  for (const win of BrowserWindow.getAllWindows()) {
    win.destroy()
  }
  mainWindow = d.createWindow('wizard')
  d.loadRendererPage(mainWindow, 'wizard')
}

async function enterLaunching(): Promise<void> {
  const d = getDeps()
  const config = getConfig()

  // Skip the splash if a server is already healthy on the configured port.
  const alreadyHealthy = await tryConnectToExisting(config.port)
  if (alreadyHealthy) {
    d.log('launching: existing server healthy, going straight to running')
    void transitionTo({ kind: 'running' })
    return
  }

  // Open the splash before closing the previous window so window-all-closed never fires.
  const previousWindow = mainWindow
  mainWindow = d.createWindow('splash')
  d.loadRendererPage(mainWindow, 'splash')
  if (previousWindow && !previousWindow.isDestroyed()) {
    previousWindow.close()
  }

  await new Promise<void>((resolve) => {
    if (!mainWindow) {
      resolve()
      return
    }
    mainWindow.webContents.once('did-finish-load', () => resolve())
  })
  d.log('launching: splash ready')

  // Auto-update web content (skip in dev)
  if (!isDevMode()) {
    try {
      safeSendToMain('server:log', 'Checking for updates...')
      const updateCheck = await checkForUpdates()
      if (updateCheck.available) {
        d.log(`launching: ${updateCheck.commits.length} update(s) available, applying`)
        safeSendToMain('server:log', 'Pulling updates...')
        const sendUpdateLog = (line: string): void => {
          const t = line.trim()
          if (
            t === 'Installing dependencies...' ||
            t === 'Building...' ||
            t === 'Pulling updates...'
          ) {
            safeSendToMain('server:log', t)
          }
        }
        const updateResult = await applyUpdate(sendUpdateLog)
        if (!updateResult.ok) {
          d.log(`launching: update failed: ${updateResult.error}`)
          safeSendToMain(
            'server:error',
            JSON.stringify({
              message: parseErrorSummary(updateResult.error || '', 'build'),
              phase: 'build',
              logPath: getServerLogPath()
            })
          )
          // Stay in launching; user can retry from the splash.
          return
        }
      } else {
        d.log('launching: already up to date')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      d.log(`launching: update check failed (non-fatal): ${message}`)
    }
  }

  try {
    const result = await startServer((line) => {
      d.log(`server: ${line.trim()}`)
      safeSendToMain('server:log', line)
    })
    d.log(`launching: startServer ok=${result.ok} error=${result.error}`)
    if (result.ok) {
      await new Promise((r) => setTimeout(r, SPLASH_TO_APP_DELAY_MS))
      void transitionTo({ kind: 'running' })
    } else {
      safeSendToMain(
        'server:error',
        JSON.stringify({
          message: parseErrorSummary(result.error || '', 'server'),
          phase: 'server',
          logPath: getServerLogPath()
        })
      )
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    d.log(`launching: startServer exception: ${message}`)
    safeSendToMain(
      'server:error',
      JSON.stringify({
        message,
        phase: 'server',
        logPath: getServerLogPath()
      })
    )
  }
}

function enterRunning(prev: AppState): void {
  const d = getDeps()
  const config = getConfig()
  const url = `http://localhost:${config.port}`

  if (prev.kind === 'recovering') {
    // Server came back up: reload every open window, including secondary app windows.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.loadURL(url)
    }
    consecutiveFailures = 0
    startHealthMonitor()
    return
  }

  // Coming from launching (or fresh start): create the app window, then close the splash.
  const previousWindow = mainWindow
  const appWindow = d.createAppWindow()
  mainWindow = appWindow
  if (previousWindow && previousWindow !== appWindow && !previousWindow.isDestroyed()) {
    previousWindow.close()
  }

  appWindow.webContents.once('did-finish-load', () => {
    startHealthMonitor()
    startUpdateScheduler(appWindow)
    initShellUpdater()
    startShellUpdateScheduler()
    if (!serverExitWired) {
      onServerExit(() => {
        if (currentState.kind === 'running') {
          void transitionTo({ kind: 'recovering' })
        }
      })
      serverExitWired = true
    }
  })
}

async function enterRecovering(): Promise<void> {
  const d = getDeps()
  const config = getConfig()
  if (!config.setupComplete) return

  for (let attempt = 1; attempt <= RECOVERY_ATTEMPTS; attempt++) {
    const result = await restartServer()
    if (result.ok) {
      d.log(`recovering: server restarted on attempt ${attempt}`)
      void transitionTo({ kind: 'running' })
      return
    }
    d.log(`recovering: attempt ${attempt}/${RECOVERY_ATTEMPTS} failed: ${result.error}`)
    if (attempt < RECOVERY_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RECOVERY_RETRY_DELAY_MS))
    }
  }

  d.log('recovering: exhausted attempts, exiting')
  void transitionTo({ kind: 'exiting', reason: 'quit' })
}

async function enterExiting(reason: ExitReason): Promise<void> {
  const d = getDeps()

  // Watchdog: if anything in teardown hangs, force-exit so the app actually closes.
  const watchdog = setTimeout(() => {
    d.log('exiting: watchdog expired, forcing process.exit(0)')
    process.exit(0)
  }, EXIT_WATCHDOG_MS)
  watchdog.unref?.()

  try {
    await stopServer()
  } catch (err) {
    d.log(`exiting: stopServer error: ${err instanceof Error ? err.message : String(err)}`)
  }

  switch (reason) {
    case 'quit':
      app.exit(0)
      break
    case 'relaunch':
      app.relaunch()
      app.exit(0)
      break
    case 'install-shell-update':
      // Defer so any pending IPC replies finish before quitAndInstall fires.
      // isForceRunAfter=true ensures macOS relaunches after install.
      setImmediate(() => {
        autoUpdater.quitAndInstall(false, true)
      })
      break
  }
}

function startHealthMonitor(): void {
  stopHealthMonitor()
  consecutiveFailures = 0
  // In dev mode the dev server handles its own restarts via HMR; recovering would
  // hard-reload and kill React state, which is worse than letting HMR sort it out.
  if (isDevMode()) return
  const config = getConfig()
  healthInterval = setInterval(async () => {
    if (currentState.kind !== 'running') return
    const healthy = await healthCheck(config.port)
    if (healthy) {
      consecutiveFailures = 0
      return
    }
    consecutiveFailures++
    if (consecutiveFailures >= HEALTH_FAILURES_BEFORE_RECOVERY) {
      void transitionTo({ kind: 'recovering' })
    }
  }, HEALTH_CHECK_INTERVAL_MS)
}

function stopHealthMonitor(): void {
  if (healthInterval) {
    clearInterval(healthInterval)
    healthInterval = null
  }
}

// ── Power-monitor side effects ───────────────────────────────────────
// These live here so all timer ownership is in one place. index.ts wires the
// powerMonitor events to these and to a possible recovery transition.

export function pauseRunningTimers(): void {
  stopHealthMonitor()
  stopUpdateScheduler()
  stopShellUpdateScheduler()
}

export function resumeRunningTimers(): void {
  if (currentState.kind !== 'running') return
  if (mainWindow && !mainWindow.isDestroyed()) {
    startUpdateScheduler(mainWindow)
  }
  startHealthMonitor()
  startShellUpdateScheduler()
}
