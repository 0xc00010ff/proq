import { app, BrowserWindow, Menu, nativeImage, nativeTheme, ipcMain, dialog, shell, powerMonitor } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { electronApp, is } from '@electron-toolkit/utils'
import iconDark from '../../resources/icon.png?asset'
import iconLight from '../../resources/icon-light.png?asset'
import iconDevDark from '../../resources/icon-dev-dark.png?asset'
import iconDevLight from '../../resources/icon-dev-light.png?asset'
import { getConfig, setConfig, resetConfig, isDevMode } from './config'
import {
  checkNodeVersion,
  checkClaudeCli,
  checkXcodeTools,
  installXcodeTools,
  installClaude,
  cloneProq,
  validateExistingInstall,
  runNpmInstall,
  runNpmBuild,
  persistClaudePath
} from './setup'
import { startServer, stopServer, tryConnectToExisting, restartServer, healthCheck, onServerExit, getServerLogPath } from './server'
import { parseErrorSummary } from './error-diagnostics'
import { checkForUpdates, applyUpdate } from './updater'
import { startUpdateScheduler, stopUpdateScheduler } from './update-scheduler'
import { initShellUpdater, checkForShellUpdate, installShellUpdate, startShellUpdateScheduler, stopShellUpdateScheduler } from './shell-updater'

// Fix PATH for macOS GUI apps (they don't inherit shell PATH)
import { ensurePath } from './shell-path'
ensurePath()

// Suppress Chromium's Media Session integration — it probes macOS media frameworks
// on startup, which triggers a scary "would like to access Apple Music" TCC prompt
// that has nothing to do with our app.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService')

// Isolate dev mode: separate userData dir so dev and production don't share config/ports
if (process.env.PROQ_DEV) {
  app.setName('proq-desktop-dev')
}

function getIcon(): Electron.NativeImage {
  const dark = nativeTheme.shouldUseDarkColors
  const path = is.dev ? (dark ? iconDevDark : iconDevLight) : (dark ? iconDark : iconLight)
  return nativeImage.createFromPath(path)
}

let mainWindow: BrowserWindow | null = null
let findWindow: BrowserWindow | null = null
let isResetting = false
let isQuitting = false
let isTransitioning = false
let healthInterval: ReturnType<typeof setInterval> | null = null
let consecutiveFailures = 0
let isRecovering = false

function getLogPath(): string {
  try {
    return join(app.getPath('userData'), 'desktop.log')
  } catch {
    return join(getConfig().proqPath, 'data', 'desktop.log')
  }
}

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { fs.appendFileSync(getLogPath(), line) } catch { /* */ }
}

function safeSend(channel: string, ...args: unknown[]): void {
  if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function createWindow(mode: 'wizard' | 'splash' | 'app'): BrowserWindow {
  const config = getConfig()

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    show: false,
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    icon: getIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  }

  switch (mode) {
    case 'wizard':
      Object.assign(windowOptions, {
        width: 620,
        height: 520,
        resizable: false,
        maximizable: false,
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 16, y: 16 }
      })
      break

    case 'splash':
      Object.assign(windowOptions, {
        width: 400,
        height: 320,
        resizable: false,
        maximizable: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true
      })
      break

    case 'app': {
      const bounds = config.windowBounds
      const validBounds = bounds && bounds.width >= 800 && bounds.height >= 600 ? bounds : null
      Object.assign(windowOptions, {
        width: validBounds?.width || 1400,
        height: validBounds?.height || 900,
        x: validBounds?.x,
        y: validBounds?.y,
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 16, y: 18 }
      })
      break
    }
  }

  const win = new BrowserWindow(windowOptions)

  // Enable native right-click context menu (copy/paste/etc)
  win.webContents.on('context-menu', (_e, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = []

    if (params.isEditable) {
      if (params.misspelledWord) {
        for (const suggestion of params.dictionarySuggestions) {
          menuItems.push({
            label: suggestion,
            click: () => win.webContents.replaceMisspelling(suggestion)
          })
        }
        menuItems.push({
          label: 'Add to dictionary',
          click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
        })
        menuItems.push({ type: 'separator' })
      }

      menuItems.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      )
    } else if (params.selectionText) {
      menuItems.push(
        { role: 'copy' }
      )
    }

    if (params.hasImageContents) {
      if (menuItems.length > 0) menuItems.push({ type: 'separator' })
      menuItems.push(
        {
          label: 'Copy Image',
          click: () => win.webContents.copyImageAt(params.x, params.y)
        },
        {
          label: 'Save Image As\u2026',
          click: () => {
            win.webContents.downloadURL(params.srcURL)
          }
        }
      )
      if (params.srcURL) {
        menuItems.push({
          label: 'Open Image in Browser',
          click: () => shell.openExternal(params.srcURL)
        })
      }
    }

    if (params.linkURL) {
      if (menuItems.length > 0) menuItems.push({ type: 'separator' })
      menuItems.push({
        label: 'Open Link in Browser',
        click: () => shell.openExternal(params.linkURL)
      })
    }

    if (menuItems.length > 0) {
      Menu.buildFromTemplate(menuItems).popup({ window: win })
    }
  })

  // Enable context menu for embedded <webview> tags (e.g. LiveTab preview)
  win.webContents.on('did-attach-webview', (_e, guestContents) => {
    guestContents.on('context-menu', (_ev, params) => {
      const menuItems: Electron.MenuItemConstructorOptions[] = []

      if (params.isEditable) {
        if (params.misspelledWord) {
          for (const suggestion of params.dictionarySuggestions) {
            menuItems.push({
              label: suggestion,
              click: () => guestContents.replaceMisspelling(suggestion)
            })
          }
          menuItems.push({
            label: 'Add to dictionary',
            click: () => guestContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
          })
          menuItems.push({ type: 'separator' })
        }

        menuItems.push(
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        )
      } else if (params.selectionText) {
        menuItems.push({ role: 'copy' })
      }

      if (params.linkURL) {
        if (menuItems.length > 0) menuItems.push({ type: 'separator' })
        menuItems.push({
          label: 'Open Link in Browser',
          click: () => shell.openExternal(params.linkURL)
        })
      }

      // Always show Inspect Element for webviews
      if (menuItems.length > 0) menuItems.push({ type: 'separator' })
      menuItems.push({
        label: 'Inspect Element',
        click: () => guestContents.inspectElement(params.x, params.y)
      })

      if (menuItems.length > 0) {
        Menu.buildFromTemplate(menuItems).popup({ window: win })
      }
    })
  })

  win.once('ready-to-show', () => win.show())

  // Forward find-in-page results to the find bar child window
  if (mode === 'app') {
    win.webContents.on('found-in-page', (_e, result) => {
      if (findWindow && !findWindow.isDestroyed()) {
        findWindow.webContents.send('find:result', {
          activeMatchOrdinal: result.activeMatchOrdinal,
          matches: result.matches
        })
      }
    })
  }

  // Save window bounds on resize/move
  if (mode === 'app') {
    const saveBounds = (): void => {
      if (!win.isMaximized() && !win.isMinimized()) {
        setConfig({ windowBounds: win.getBounds() })
      }
    }
    win.on('resize', saveBounds)
    win.on('move', saveBounds)
  }

  return win
}

function loadRendererPage(win: BrowserWindow, hash?: string): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = hash
      ? `${process.env['ELECTRON_RENDERER_URL']}#${hash}`
      : process.env['ELECTRON_RENDERER_URL']
    win.loadURL(url)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  // Setup
  ipcMain.handle('setup:check-node', () => checkNodeVersion())
  ipcMain.handle('setup:check-claude', () => checkClaudeCli())
  ipcMain.handle('setup:check-xcode', () => checkXcodeTools())
  ipcMain.handle('setup:install-xcode', () => installXcodeTools())
  ipcMain.handle('setup:install-claude', () =>
    installClaude((line) => safeSend('setup:log', line))
  )
  ipcMain.handle('setup:clone', (_e, targetDir: string, overwrite?: boolean) => cloneProq(targetDir, overwrite))
  ipcMain.handle('setup:validate', (_e, dirPath: string) => validateExistingInstall(dirPath))

  ipcMain.handle('setup:npm-install', async () => {
    const { proqPath } = getConfig()
    return runNpmInstall(proqPath, (line) => {
      safeSend('setup:log', line)
    })
  })

  ipcMain.handle('setup:build', async () => {
    const { proqPath } = getConfig()
    return runNpmBuild(proqPath, (line) => {
      safeSend('setup:log', line)
    })
  })

  ipcMain.handle('setup:persist-claude', async (_e, claudePath: string) => {
    const { proqPath } = getConfig()
    await persistClaudePath(proqPath, claudePath)
  })

  // Config
  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:set', (_e, partial) => setConfig(partial))

  // Directory picker
  ipcMain.handle('dialog:select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose proq install location'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Wizard complete — main process takes over to show splash + start server
  ipcMain.handle('wizard:complete', () => {
    showSplashAndStartServer()
  })

  // Server (used by splash Retry button)
  ipcMain.handle('server:start', async () => {
    const result = await startServer((line) => {
      safeSend('server:log', line)
    })
    if (result.ok) {
      transitionToApp()
    }
    return result
  })

  // Rebuild + start (used by splash Retry when build failed)
  ipcMain.handle('server:rebuild-and-start', async () => {
    const { proqPath } = getConfig()
    safeSend('server:log', 'Rebuilding...')
    const buildResult = await runNpmBuild(proqPath, (line) => {
      safeSend('server:log', line)
    })
    if (!buildResult.ok) {
      const err = {
        message: parseErrorSummary(buildResult.error || '', 'build'),
        phase: 'build',
        logPath: getServerLogPath()
      }
      safeSend('server:error', JSON.stringify(err))
      return { ok: false }
    }
    safeSend('server:log', 'Starting server...')
    const result = await startServer((line) => {
      safeSend('server:log', line)
    })
    if (result.ok) {
      transitionToApp()
    } else {
      const err = {
        message: parseErrorSummary(result.error || '', 'server'),
        phase: 'server',
        logPath: getServerLogPath()
      }
      safeSend('server:error', JSON.stringify(err))
    }
    return result
  })

  // Open log file (used by splash "View full log" link)
  ipcMain.handle('app:open-log', (_e, logPath: string) => {
    shell.openPath(logPath)
  })

  // Updates
  ipcMain.handle('updates:check', () => checkForUpdates())
  ipcMain.handle('updates:apply', () =>
    applyUpdate((line) => safeSend('setup:log', line))
  )
  ipcMain.handle('updates:apply-and-restart', async () => {
    try {
      stopUpdateScheduler()
      stopHealthMonitor()
      await stopServer()

      // Create splash window, wait for it to load, then swap
      const splashWindow = createWindow('splash')
      loadRendererPage(splashWindow, 'splash')

      const previousWindow = mainWindow
      mainWindow = splashWindow

      // Wait for splash content to load so status messages are visible
      await new Promise<void>((resolve) => {
        splashWindow.webContents.once('did-finish-load', () => resolve())
      })

      splashWindow.show()
      splashWindow.focus()
      if (previousWindow && previousWindow !== splashWindow && !previousWindow.isDestroyed()) {
        previousWindow.close()
      }

      // Only forward friendly status lines to the splash — raw command
      // output (build warnings, npm noise) is silently dropped so it
      // doesn't flood the small splash window.
      const sendStatus = (line: string): void => {
        safeSend('server:log', line)
      }

      sendStatus('Pulling updates...')
      const sendUpdateLog = (line: string): void => {
        const t = line.trim()
        if (t === 'Installing dependencies...' || t === 'Building...' || t === 'Pulling updates...' || t === 'Stashing local changes...') {
          sendStatus(t)
        }
      }
      let result = await applyUpdate(sendUpdateLog)
      if (!result.ok && result.dirty) {
        const { response } = await dialog.showMessageBox({
          type: 'question',
          icon: getIcon(),
          buttons: ['Stash & Update', 'Skip Update'],
          defaultId: 0,
          title: 'Local Changes Detected',
          message: 'You have local changes to proq that need to be stashed before updating.',
          detail: 'Your changes will be saved in the git stash and can be recovered later with "git stash pop".'
        })
        if (response === 0) {
          result = await applyUpdate(sendUpdateLog, { stashFirst: true })
        } else {
          result = { ok: true }
        }
      }

      if (!result.ok) {
        safeSend('server:error', JSON.stringify({
          message: parseErrorSummary(result.error || '', 'build'),
          phase: 'build',
          logPath: getServerLogPath()
        }))
        return { ok: false, error: result.error }
      }

      // Restart server — startServer streams its own status via onLog
      const serverResult = await startServer((line) => {
        safeSend('server:log', line)
      })

      if (serverResult.ok) {
        await new Promise((r) => setTimeout(r, 1500))
        transitionToApp()
      } else {
        safeSend('server:error', JSON.stringify({
          message: parseErrorSummary(serverResult.error || '', 'server'),
          phase: 'server',
          logPath: getServerLogPath()
        }))
      }

      return { ok: true }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      safeSend('server:error', JSON.stringify({
        message: 'Update failed. Click Retry to try again.',
        phase: 'build',
        logPath: getServerLogPath()
      }))
      return { ok: false, error: message }
    }
  })

  // Shell updates
  ipcMain.handle('shell-update:check', () => checkForShellUpdate())
  ipcMain.handle('shell-update:install', () => installShellUpdate())

  // App info
  ipcMain.handle('app:version', () => app.getVersion())

  // Find in page — target the parent window (caller is the find bar child window)
  ipcMain.handle('find:find', (event, text: string, options?: { forward?: boolean; findNext?: boolean }) => {
    const sender = BrowserWindow.fromWebContents(event.sender)
    const target = sender?.getParentWindow() || sender
    if (target && text) {
      target.webContents.findInPage(text, options)
    }
  })
  ipcMain.handle('find:stop', (event) => {
    const sender = BrowserWindow.fromWebContents(event.sender)
    const target = sender?.getParentWindow() || sender
    if (target) {
      target.webContents.stopFindInPage('clearSelection')
    }
  })
}

// ── Find Bar (child window) ──────────────────────────────────────────

const FIND_BAR_HTML = `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:transparent}
.bar{display:flex;align-items:center;gap:6px;padding:6px 12px;background:#27272a;border:1px solid #52525b;border-radius:8px}
input{width:192px;background:#18181b;border:1px solid #52525b;border-radius:4px;padding:4px 8px;font-size:13px;color:#f4f4f5;outline:none}
input:focus{border-color:#3b82f6}input::placeholder{color:#71717a}
.count{font-size:12px;color:#a1a1aa;white-space:nowrap;min-width:60px;text-align:center}
button{background:none;border:none;padding:4px;color:#a1a1aa;cursor:pointer;border-radius:4px;display:flex;align-items:center}
button:hover{color:#e4e4e7;background:#3f3f46}
svg{width:14px;height:14px}
</style></head><body><div class="bar">
<input id="q" type="text" placeholder="Find..." autofocus/>
<span id="count" class="count"></span>
<button id="prev" title="Previous (Shift+Enter)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg></button>
<button id="next" title="Next (Enter)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>
<button id="close" title="Close (Escape)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
</div><script>
const q=document.getElementById('q'),countEl=document.getElementById('count'),api=window.proqDesktop;
let cur='';
q.addEventListener('input',()=>{cur=q.value;if(cur){api.findInPage(cur)}else{api.stopFind();countEl.textContent=''}});
q.addEventListener('keydown',(e)=>{if(e.key==='Escape'){api.stopFind();window.close()}else if(e.key==='Enter'){e.preventDefault();if(cur)api.findInPage(cur,{forward:!e.shiftKey,findNext:true})}});
document.getElementById('prev').addEventListener('click',()=>{if(cur)api.findInPage(cur,{forward:false,findNext:true});q.focus()});
document.getElementById('next').addEventListener('click',()=>{if(cur)api.findInPage(cur,{forward:true,findNext:true});q.focus()});
document.getElementById('close').addEventListener('click',()=>{api.stopFind();window.close()});
if(api&&api.onFindResult){api.onFindResult((r)=>{if(cur){countEl.textContent=r.matches>0?r.activeMatchOrdinal+' of '+r.matches:'No results'}})}
</script></body></html>`

function showFindBar(parent: BrowserWindow): void {
  if (findWindow && !findWindow.isDestroyed()) {
    findWindow.focus()
    // Select all text in the input for easy replacement
    findWindow.webContents.executeJavaScript('document.getElementById("q").select()')
    return
  }

  const parentBounds = parent.getBounds()
  const w = 380
  const h = 48

  findWindow = new BrowserWindow({
    width: w,
    height: h,
    x: parentBounds.x + parentBounds.width - w - 20,
    y: parentBounds.y + 52,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    parent,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  findWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(FIND_BAR_HTML))
  findWindow.once('ready-to-show', () => findWindow?.show())

  findWindow.on('closed', () => {
    // Clear highlights when find bar closes
    if (!parent.isDestroyed()) {
      parent.webContents.stopFindInPage('clearSelection')
    }
    findWindow = null
  })

  // Reposition when parent moves or resizes
  const reposition = (): void => {
    if (!findWindow || findWindow.isDestroyed()) return
    const b = parent.getBounds()
    findWindow.setPosition(b.x + b.width - w - 20, b.y + 52)
  }
  parent.on('move', reposition)
  parent.on('resize', reposition)

  findWindow.on('closed', () => {
    parent.removeListener('move', reposition)
    parent.removeListener('resize', reposition)
  })
}

// ── Health Monitor & Recovery ─────────────────────────────────────────

async function recoverServer(): Promise<void> {
  if (isRecovering) return
  // Don't recover if setup isn't complete (wizard is showing)
  const config = getConfig()
  if (!config.setupComplete) return
  isRecovering = true
  try {
    const result = await restartServer()
    if (result.ok) {
      const url = `http://localhost:${config.port}`
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.loadURL(url)
      }
    }
  } finally {
    isRecovering = false
    consecutiveFailures = 0
  }
}

function startHealthMonitor(): void {
  stopHealthMonitor()
  consecutiveFailures = 0
  // In dev mode, the dev server handles its own restarts via HMR.
  // The health monitor's recovery (restartServer + loadURL) causes destructive
  // hard reloads that kill React state and running processes.
  if (isDevMode()) return
  const config = getConfig()
  healthInterval = setInterval(async () => {
    const healthy = await healthCheck(config.port)
    if (healthy) {
      consecutiveFailures = 0
    } else {
      consecutiveFailures++
      if (consecutiveFailures >= 3) {
        recoverServer()
      }
    }
  }, 10_000)
}

function stopHealthMonitor(): void {
  if (healthInterval) {
    clearInterval(healthInterval)
    healthInterval = null
  }
}

// ── App Lifecycle ─────────────────────────────────────────────────────

function createAppWindow(): BrowserWindow {
  const config = getConfig()
  const appWindow = createWindow('app')
  appWindow.loadURL(`http://localhost:${config.port}`)

  // Retry loading if the page fails (e.g. Cmd-R while server is slow)
  // In dev mode, the dev server handles its own HMR — don't force-reload.
  if (!isDevMode()) {
    appWindow.webContents.on('did-fail-load', (_e, _code, _desc, url, isMainFrame) => {
      if (isMainFrame && url.startsWith('http://localhost') && !appWindow.isDestroyed()) {
        setTimeout(() => {
          if (!appWindow.isDestroyed()) appWindow.loadURL(url)
        }, 1000)
      }
    })
  }

  // Open external links in default browser
  appWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  return appWindow
}

function transitionToApp(): void {
  // Close previous window immediately — don't leave wizard/splash visible
  isTransitioning = true
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close()
  }

  const appWindow = createAppWindow()
  mainWindow = appWindow
  isTransitioning = false

  appWindow.webContents.once('did-finish-load', () => {
    startHealthMonitor()
    startUpdateScheduler(appWindow)
    initShellUpdater()
    startShellUpdateScheduler()
    onServerExit(() => recoverServer())
  })
}

async function showSplashAndStartServer(): Promise<void> {
  const config = getConfig()

  // Check if server is already running before showing splash
  const alreadyHealthy = await tryConnectToExisting(config.port)
  if (alreadyHealthy) {
    log('showSplash: existing server healthy, transitioning directly')
    transitionToApp()
    return
  }

  // Create splash before closing wizard so there's never zero windows
  // (zero windows triggers app.quit via window-all-closed)
  const previousWindow = mainWindow
  mainWindow = createWindow('splash')
  loadRendererPage(mainWindow, 'splash')
  if (previousWindow && !previousWindow.isDestroyed()) {
    previousWindow.close()
  }
  await new Promise<void>((resolve) => {
    mainWindow!.webContents.once('did-finish-load', () => resolve())
  })
  log('showSplash: splash ready')

  // Auto-update web content on launch (unless dev mode)
  if (!isDevMode()) {
    try {
      safeSend('server:log', 'Checking for updates...')
      const updateCheck = await checkForUpdates()
      if (updateCheck.available) {
        log(`showSplash: ${updateCheck.commits.length} update(s) available, applying`)
        safeSend('server:log', 'Pulling updates...')
        const sendUpdateLog = (line: string): void => {
          const t = line.trim()
          if (t === 'Installing dependencies...' || t === 'Building...' || t === 'Pulling updates...' || t === 'Stashing local changes...') {
            safeSend('server:log', t)
          }
        }
        let updateResult = await applyUpdate(sendUpdateLog)
        if (!updateResult.ok && updateResult.dirty) {
          log('showSplash: dirty working tree, prompting user')
          const { response } = await dialog.showMessageBox({
            type: 'question',
            icon: getIcon(),
            buttons: ['Stash & Update', 'Skip Update'],
            defaultId: 0,
            title: 'Local Changes Detected',
            message: 'You have local changes to proq that need to be stashed before updating.',
            detail: 'Your changes will be saved in the git stash and can be recovered later with "git stash pop".'
          })
          if (response === 0) {
            updateResult = await applyUpdate(sendUpdateLog, { stashFirst: true })
          } else {
            log('showSplash: user skipped update')
            updateResult = { ok: true }
          }
        }
        if (!updateResult.ok) {
          log(`showSplash: update failed: ${updateResult.error}`)
          safeSend('server:error', JSON.stringify({
            message: parseErrorSummary(updateResult.error || '', 'build'),
            phase: 'build',
            logPath: getServerLogPath()
          }))
          return
        }
      } else {
        log('showSplash: already up to date')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log(`showSplash: update check failed (non-fatal): ${message}`)
      // Continue — update failure shouldn't block app launch
    }
  }

  // Start server
  try {
    const result = await startServer((line) => {
      log(`server: ${line.trim()}`)
      safeSend('server:log', line)
    })

    log(`showSplash: startServer result ok=${result.ok} error=${result.error}`)
    if (result.ok) {
      await new Promise((r) => setTimeout(r, 1500))
      transitionToApp()
    } else {
      safeSend('server:error', JSON.stringify({
        message: parseErrorSummary(result.error || '', 'server'),
        phase: 'server',
        logPath: getServerLogPath()
      }))
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    log(`showSplash: startServer exception: ${message}`)
    safeSend('server:error', JSON.stringify({
      message,
      phase: 'server',
      logPath: getServerLogPath()
    }))
  }
}

async function launchApp(): Promise<void> {
  const config = getConfig()
  log(`launchApp: setupComplete=${config.setupComplete} proqPath=${config.proqPath} port=${config.port} devMode=${config.devMode}`)
  log(`launchApp: PATH=${process.env.PATH}`)

  if (!config.setupComplete) {
    // First run — show wizard. When wizard calls wizard:complete,
    // the IPC handler calls showSplashAndStartServer().
    mainWindow = createWindow('wizard')
    loadRendererPage(mainWindow, 'wizard')
  } else {
    // Normal launch — splash → server → app
    await showSplashAndStartServer()
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.proq.desktop')

  // Set dock icon on macOS (in dev mode always; in prod for theme switching)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(getIcon())
    nativeTheme.on('updated', () => {
      if (app.dock) app.dock.setIcon(getIcon())
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.setIcon(getIcon())
      }
    })
  }

  // App menu
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            {
              label: 'About proq',
              click: (): void => {
                app.setAboutPanelOptions({
                  applicationName: 'proq',
                  applicationVersion: app.getVersion(),
                  version: '',
                  copyright: 'Build beautiful things'
                })
                app.showAboutPanel()
              }
            },
            {
              label: 'Check for Updates…',
              click: async (): Promise<void> => {
                const result = await checkForUpdates()
                if (result.available && mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('updates:available', result)
                } else if (!result.available) {
                  dialog.showMessageBox({
                    type: 'info',
                    icon: getIcon(),
                    buttons: ['OK'],
                    message: 'You\'re up to date',
                    detail: 'proq is running the latest version.'
                  })
                }
              }
            },
            { type: 'separator' },
            {
              label: 'Settings…',
              click: (): void => {
                const config = getConfig()
                if (!config.setupComplete) return
                const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
                if (win) win.loadURL(`http://localhost:${config.port}/settings`)
              }
            },
            { type: 'separator' },
            {
              label: 'Reset to Defaults…',
              click: async (): Promise<void> => {
                const config = getConfig()
                const { response } = await dialog.showMessageBox({
                  type: 'warning',
                  icon: getIcon(),
                  buttons: ['Cancel', 'Reset'],
                  defaultId: 0,
                  message: 'Reset proq Desktop?',
                  detail: `This resets the desktop app and restarts the setup wizard. Your project data at ${config.proqPath} will not be affected.\n\nUse this to switch to dev mode or change your proq installation path.`
                })
                if (response === 1) {
                  isResetting = true
                  stopHealthMonitor()
                  stopUpdateScheduler()
                  stopShellUpdateScheduler()
                  await stopServer()
                  resetConfig()
                  // Close all existing windows before relaunching
                  for (const win of BrowserWindow.getAllWindows()) {
                    win.destroy()
                  }
                  mainWindow = null
                  await launchApp()
                  isResetting = false
                }
              }
            },
            { type: 'separator' },
            { role: 'quit' }
          ]
        },
        {
          label: 'File',
          submenu: [
            {
              label: 'New Window',
              accelerator: 'CmdOrCtrl+N',
              click: (): void => {
                const config = getConfig()
                if (config.setupComplete) createAppWindow()
              }
            }
          ]
        },
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
            { type: 'separator' },
            {
              label: 'Find',
              accelerator: 'CmdOrCtrl+F',
              click: (): void => {
                const win = BrowserWindow.getFocusedWindow()
                if (win) showFindBar(win)
              }
            }
          ]
        },
        {
          label: 'History',
          submenu: [
            {
              label: 'Back',
              accelerator: 'CmdOrCtrl+[',
              click: (): void => {
                const win = BrowserWindow.getFocusedWindow()
                if (win) win.webContents.goBack()
              }
            },
            {
              label: 'Forward',
              accelerator: 'CmdOrCtrl+]',
              click: (): void => {
                const win = BrowserWindow.getFocusedWindow()
                if (win) win.webContents.goForward()
              }
            }
          ]
        },
        { role: 'viewMenu' },
        { role: 'windowMenu' }
      ])
    )
  }

  // Power monitor — handle sleep/wake
  powerMonitor.on('suspend', () => {
    stopHealthMonitor()
    stopUpdateScheduler()
    stopShellUpdateScheduler()
  })

  powerMonitor.on('resume', async () => {
    const config = getConfig()
    if (!config.setupComplete) return
    if (!isDevMode()) {
      const healthy = await healthCheck(config.port)
      if (!healthy) {
        recoverServer()
      } else {
        const url = `http://localhost:${config.port}`
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.isDestroyed()) continue
          try {
            const alive = await win.webContents.executeJavaScript(
              'document.body?.children.length > 0'
            )
            if (!alive) win.loadURL(url)
          } catch {
            win.loadURL(url)
          }
        }
      }
    }
    startHealthMonitor()
    startShellUpdateScheduler()
    const firstWindow = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (firstWindow) {
      startUpdateScheduler(firstWindow)
    }
  })

  registerIpcHandlers()
  launchApp()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !isResetting && !isTransitioning) app.quit()
})

app.on('before-quit', async () => {
  isQuitting = true
  stopHealthMonitor()
  stopUpdateScheduler()
  stopShellUpdateScheduler()
  await stopServer()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const config = getConfig()
    if (config.setupComplete) createAppWindow()
    else launchApp()
  }
})
