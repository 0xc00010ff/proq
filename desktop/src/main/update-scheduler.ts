import { BrowserWindow } from 'electron'
import { getConfig, isDevMode } from './config'
import { checkForUpdates, type UpdateCheckResult } from './updater'

let checkTimer: ReturnType<typeof setTimeout> | null = null
let intervalTimer: ReturnType<typeof setInterval> | null = null

const INITIAL_DELAY = 30_000 // 30 seconds
const CHECK_INTERVAL = 60 * 60 * 1000 // 1 hour

async function isAutoUpdateEnabled(): Promise<boolean> {
  const config = getConfig()
  try {
    const res = await fetch(`http://localhost:${config.port}/api/settings`)
    if (!res.ok) return true
    const settings = await res.json()
    return settings.autoUpdate !== false
  } catch {
    return true // default to enabled if we can't reach the server
  }
}

async function runCheck(win: BrowserWindow): Promise<void> {
  try {
    const enabled = await isAutoUpdateEnabled()
    if (!enabled) return

    const result: UpdateCheckResult = await checkForUpdates()
    if (result.available && !win.isDestroyed()) {
      win.webContents.send('updates:available', result)
    }
  } catch {
    // Silently swallow errors
  }
}

export function startUpdateScheduler(win: BrowserWindow): void {
  stopUpdateScheduler()

  // Dev mode: no background update checks
  if (isDevMode()) return

  checkTimer = setTimeout(() => {
    runCheck(win)
    intervalTimer = setInterval(() => runCheck(win), CHECK_INTERVAL)
  }, INITIAL_DELAY)
}

export function stopUpdateScheduler(): void {
  if (checkTimer) {
    clearTimeout(checkTimer)
    checkTimer = null
  }
  if (intervalTimer) {
    clearInterval(intervalTimer)
    intervalTimer = null
  }
}
