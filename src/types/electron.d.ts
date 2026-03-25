interface UpdateCheckResult {
  available: boolean
  commits: string[]
  error?: string
}

interface ProqDesktopAPI {
  checkUpdates: () => Promise<UpdateCheckResult>
  applyAndRestart: () => Promise<{ ok: boolean; error?: string }>
  onUpdateAvailable: (cb: (e: unknown, result: UpdateCheckResult) => void) => () => void
  checkShellUpdate: () => Promise<{ available: boolean; version?: string; error?: string }>
  installShellUpdate: () => Promise<void>
  onShellUpdateAvailable: (cb: (e: unknown, result: { version: string }) => void) => () => void
  onShellUpdateDownloaded: (cb: (e: unknown, result: { version: string }) => void) => () => void
  findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean }) => Promise<void>
  stopFind: () => Promise<void>
  onFindShow: (cb: () => void) => () => void
  onFindResult: (cb: (result: { activeMatchOrdinal: number; matches: number }) => void) => () => void
  getVersion: () => Promise<string>
}

interface Window {
  proqDesktop?: ProqDesktopAPI
}
