import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'
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
  return updateDownloaded
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
