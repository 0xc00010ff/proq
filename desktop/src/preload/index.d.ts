import { ElectronAPI } from '@electron-toolkit/preload'

interface CheckResult {
  ok: boolean
  version?: string
  path?: string
  error?: string
}

interface DesktopConfig {
  proqPath: string
  port: number
  wsPort: number
  devMode: boolean
  setupComplete: boolean
  claudeBinPath: string
  lastUpdated: string
  windowBounds: { x: number; y: number; width: number; height: number } | null
}

interface UpdateCheckResult {
  available: boolean
  commits: string[]
  error?: string
}

interface ProqDesktopAPI {
  checkNode: () => Promise<CheckResult>
  checkClaude: () => Promise<CheckResult>
  checkXcode: () => Promise<CheckResult>
  installXcode: () => Promise<CheckResult>
  installClaude: () => Promise<CheckResult>
  cloneRepo: (targetDir: string, overwrite?: boolean) => Promise<{ ok: boolean; error?: string }>
  validateInstall: (dirPath: string) => Promise<boolean>
  npmInstall: () => Promise<{ ok: boolean; error?: string }>
  buildProq: () => Promise<{ ok: boolean; error?: string }>
  persistClaude: (claudePath: string) => Promise<void>

  getConfig: () => Promise<DesktopConfig>
  setConfig: (partial: Partial<DesktopConfig>) => Promise<DesktopConfig>
  selectDirectory: () => Promise<string | null>

  wizardComplete: () => Promise<void>
  startServer: () => Promise<{ ok: boolean; error?: string }>
  onServerReady: (cb: () => void) => () => void
  onServerLog: (cb: (e: unknown, line: string) => void) => () => void
  onServerError: (cb: (e: unknown, error: string) => void) => () => void

  onSetupLog: (cb: (e: unknown, line: string) => void) => () => void

  checkUpdates: () => Promise<UpdateCheckResult>
  restart: () => Promise<void>
  onUpdateAvailable: (cb: (e: unknown, result: UpdateCheckResult) => void) => () => void

  checkShellUpdate: () => Promise<{ available: boolean; version?: string; error?: string }>
  installShellUpdate: () => Promise<void>
  onShellUpdateAvailable: (cb: (e: unknown, result: { version: string }) => void) => () => void
  onShellUpdateDownloaded: (cb: (e: unknown, result: { version: string }) => void) => () => void

  rebuildAndStart: () => Promise<{ ok: boolean; error?: string }>
  openLogFile: (logPath: string) => Promise<void>

  getVersion: () => Promise<string>

  onAppStateChanged: (
    cb: (e: unknown, state: { kind: string; reason?: string }) => void
  ) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    proqDesktop: ProqDesktopAPI
  }
}
