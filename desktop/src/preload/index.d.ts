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
  checkTmux: () => Promise<CheckResult>
  installTmux: () => Promise<CheckResult>
  checkClaude: () => Promise<CheckResult>
  checkXcode: () => Promise<CheckResult>
  checkHomebrew: () => Promise<CheckResult>
  installHomebrew: () => Promise<CheckResult>
  installNode: () => Promise<CheckResult>
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
  applyUpdate: () => Promise<{ ok: boolean; error?: string }>
  applyAndRestart: () => Promise<{ ok: boolean; error?: string }>
  onUpdateAvailable: (cb: (e: unknown, result: UpdateCheckResult) => void) => () => void

  getVersion: () => Promise<string>
}

declare global {
  interface Window {
    electron: ElectronAPI
    proqDesktop: ProqDesktopAPI
  }
}
