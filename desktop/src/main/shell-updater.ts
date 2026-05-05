import { autoUpdater } from 'electron-updater'
import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { isDevMode } from './config'

let initialized = false
let updateDownloaded = false

function sendToAll(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
}

// electron-updater stores downloads in {userData parent}/{name}-updater/pending/.
// We check this directly so a download from a previous session is still "ready"
// — the in-memory updateDownloaded flag only reflects the current session.
function getPendingUpdatePath(): string {
  return join(app.getPath('userData'), '..', `${app.getName()}-updater`, 'pending')
}

function readPendingUpdateInfo(): { fileName: string } | null {
  try {
    const infoPath = join(getPendingUpdatePath(), 'update-info.json')
    if (!fs.existsSync(infoPath)) return null
    const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'))
    if (!info?.fileName) return null
    const filePath = join(getPendingUpdatePath(), info.fileName)
    if (!fs.existsSync(filePath)) return null
    return { fileName: info.fileName }
  } catch {
    return null
  }
}

// SemVer compare: returns true if `candidate` is strictly newer than `current`.
// Both are expected to be plain x.y.z (ignores pre-release suffixes by trimming).
function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string): number[] =>
    v.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false
  }
  return false
}

// Filename pattern: proq-{version}-arm64-mac.zip — extract the version.
function extractVersionFromFilename(fileName: string): string | null {
  const match = fileName.match(/-(\d+\.\d+\.\d+(?:-[\w.]+)?)-/)
  return match ? match[1] : null
}

// Called once at app startup BEFORE creating any windows. If a previous session
// downloaded an update but never installed it (broken in-app restart, hung
// quit, force-quit before autoInstallOnAppQuit, etc.), kick electron-updater
// to re-discover the pending file and apply it. This is the rescue mechanism
// for users on buggy shells — they only need to relaunch once.
//
// Returns a promise that resolves to true if an install was triggered (caller
// should bail out of normal launch). Times out at 12s so a network-down boot
// doesn't stall the user forever.
export function applyPendingUpdateIfAny(log?: (msg: string) => void): Promise<boolean> {
  if (isDevMode()) return Promise.resolve(false)

  const pending = readPendingUpdateInfo()
  if (!pending) return Promise.resolve(false)

  const pendingVersion = extractVersionFromFilename(pending.fileName)
  if (!pendingVersion) {
    log?.(`pending-update: could not parse version from ${pending.fileName}`)
    return Promise.resolve(false)
  }

  const currentVersion = app.getVersion()
  if (!isNewerVersion(pendingVersion, currentVersion)) {
    // Stale pending file for an older or equal version — clean it up so we
    // don't keep checking it on every launch.
    log?.(`pending-update: ${pendingVersion} <= current ${currentVersion}, removing stale cache`)
    try {
      fs.rmSync(getPendingUpdatePath(), { recursive: true, force: true })
    } catch (err) {
      log?.(`pending-update: cleanup failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    return Promise.resolve(false)
  }

  log?.(`pending-update: ${pendingVersion} pending (current ${currentVersion}), checking feed`)

  // electron-updater's quitAndInstall() requires in-memory state populated by
  // the download flow. Calling it cold against an orphan file is a no-op. So
  // we run a fresh checkForUpdates: if the latest released version matches the
  // pending file, electron-updater will see the cached download, fire
  // update-downloaded immediately, and we quitAndInstall from there.
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    const timeout = setTimeout(() => {
      log?.('pending-update: feed check timed out after 12s, continuing normal launch')
      finish(false)
    }, 12_000)

    autoUpdater.once('update-downloaded', (info) => {
      log?.(`pending-update: downloaded ${info.version}, installing`)
      // Defer so the event handler returns cleanly before quit.
      setImmediate(() => {
        try {
          autoUpdater.quitAndInstall(false, true)
        } catch (err) {
          log?.(`pending-update: quitAndInstall failed: ${err instanceof Error ? err.message : String(err)}`)
          finish(false)
        }
      })
      finish(true)
    })

    autoUpdater.once('update-not-available', () => {
      log?.('pending-update: feed reports no update, skipping')
      finish(false)
    })

    autoUpdater.once('error', (err) => {
      log?.(`pending-update: feed error: ${err.message}`)
      finish(false)
    })

    autoUpdater.checkForUpdates().catch((err) => {
      log?.(`pending-update: checkForUpdates threw: ${err instanceof Error ? err.message : String(err)}`)
      finish(false)
    })
  })
}

export function initShellUpdater(): void {
  if (initialized || isDevMode()) return
  initialized = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    sendToAll('shell-update:available', { version: info.version })
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true
    sendToAll('shell-update:downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    sendToAll('shell-update:error', { error: err.message })
  })
}

export function isShellUpdateDownloaded(): boolean {
  if (updateDownloaded) return true
  // Also true if a previous session left a download pending for a newer version.
  const pending = readPendingUpdateInfo()
  if (!pending) return false
  const pendingVersion = extractVersionFromFilename(pending.fileName)
  if (!pendingVersion) return false
  return isNewerVersion(pendingVersion, app.getVersion())
}

export async function checkForShellUpdate(): Promise<{ available: boolean; version?: string; error?: string }> {
  if (isDevMode()) {
    return { available: false }
  }

  try {
    const result = await autoUpdater.checkForUpdates()
    if (result && result.updateInfo) {
      return { available: true, version: result.updateInfo.version }
    }
    return { available: false }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return { available: false, error: message }
  }
}

let shellCheckTimer: ReturnType<typeof setInterval> | null = null

export function startShellUpdateScheduler(): void {
  stopShellUpdateScheduler()

  if (isDevMode()) return

  // Check after 60s, then every 4 hours
  shellCheckTimer = setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
    shellCheckTimer = setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {})
    }, 4 * 60 * 60 * 1000)
  }, 60_000) as unknown as ReturnType<typeof setInterval>
}

export function stopShellUpdateScheduler(): void {
  if (shellCheckTimer) {
    clearTimeout(shellCheckTimer)
    clearInterval(shellCheckTimer)
    shellCheckTimer = null
  }
}
