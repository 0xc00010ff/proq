import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const proqDesktopAPI = {
  // Setup checks
  checkNode: (): Promise<unknown> => ipcRenderer.invoke('setup:check-node'),
  checkClaude: (): Promise<unknown> => ipcRenderer.invoke('setup:check-claude'),
  checkXcode: (): Promise<unknown> => ipcRenderer.invoke('setup:check-xcode'),
  installXcode: (): Promise<unknown> => ipcRenderer.invoke('setup:install-xcode'),
  installClaude: (): Promise<unknown> => ipcRenderer.invoke('setup:install-claude'),
  cloneRepo: (targetDir: string, overwrite?: boolean): Promise<unknown> => ipcRenderer.invoke('setup:clone', targetDir, overwrite),
  validateInstall: (dirPath: string): Promise<unknown> =>
    ipcRenderer.invoke('setup:validate', dirPath),
  npmInstall: (): Promise<unknown> => ipcRenderer.invoke('setup:npm-install'),
  buildProq: (): Promise<unknown> => ipcRenderer.invoke('setup:build'),
  persistClaude: (claudePath: string): Promise<unknown> =>
    ipcRenderer.invoke('setup:persist-claude', claudePath),

  // Config
  getConfig: (): Promise<unknown> => ipcRenderer.invoke('config:get'),
  setConfig: (partial: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('config:set', partial),
  selectDirectory: (): Promise<unknown> => ipcRenderer.invoke('dialog:select-directory'),

  // Wizard
  wizardComplete: (): Promise<unknown> => ipcRenderer.invoke('wizard:complete'),

  // Server
  startServer: (): Promise<unknown> => ipcRenderer.invoke('server:start'),
  onServerReady: (cb: () => void): (() => void) => {
    ipcRenderer.on('server:ready', cb)
    return (): void => {
      ipcRenderer.removeListener('server:ready', cb)
    }
  },
  onServerLog: (cb: (_e: unknown, line: string) => void): (() => void) => {
    ipcRenderer.on('server:log', cb as (...args: unknown[]) => void)
    return (): void => {
      ipcRenderer.removeListener('server:log', cb as (...args: unknown[]) => void)
    }
  },
  onServerError: (cb: (_e: unknown, error: string) => void): (() => void) => {
    ipcRenderer.on('server:error', cb as (...args: unknown[]) => void)
    return (): void => {
      ipcRenderer.removeListener('server:error', cb as (...args: unknown[]) => void)
    }
  },

  // Setup log streaming
  onSetupLog: (cb: (_e: unknown, line: string) => void): (() => void) => {
    ipcRenderer.on('setup:log', cb as (...args: unknown[]) => void)
    return (): void => {
      ipcRenderer.removeListener('setup:log', cb as (...args: unknown[]) => void)
    }
  },

  // Updates
  checkUpdates: (): Promise<unknown> => ipcRenderer.invoke('updates:check'),
  restart: (): Promise<unknown> => ipcRenderer.invoke('app:restart'),
  onUpdateAvailable: (cb: (_e: unknown, result: unknown) => void): (() => void) => {
    ipcRenderer.on('updates:available', cb as (...args: unknown[]) => void)
    return (): void => {
      ipcRenderer.removeListener('updates:available', cb as (...args: unknown[]) => void)
    }
  },

  // Shell updates
  checkShellUpdate: (): Promise<unknown> => ipcRenderer.invoke('shell-update:check'),
  installShellUpdate: (): Promise<unknown> => ipcRenderer.invoke('shell-update:install'),
  onShellUpdateAvailable: (cb: (_e: unknown, result: unknown) => void): (() => void) => {
    ipcRenderer.on('shell-update:available', cb as (...args: unknown[]) => void)
    return (): void => {
      ipcRenderer.removeListener('shell-update:available', cb as (...args: unknown[]) => void)
    }
  },
  onShellUpdateDownloaded: (cb: (_e: unknown, result: unknown) => void): (() => void) => {
    ipcRenderer.on('shell-update:downloaded', cb as (...args: unknown[]) => void)
    return (): void => {
      ipcRenderer.removeListener('shell-update:downloaded', cb as (...args: unknown[]) => void)
    }
  },

  // Find in page
  findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean }): Promise<unknown> =>
    ipcRenderer.invoke('find:find', text, options),
  stopFind: (): Promise<unknown> => ipcRenderer.invoke('find:stop'),
  onFindShow: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('find:show', handler)
    return (): void => { ipcRenderer.removeListener('find:show', handler) }
  },
  onFindResult: (cb: (result: { activeMatchOrdinal: number; matches: number }) => void): (() => void) => {
    const handler = (_e: unknown, result: { activeMatchOrdinal: number; matches: number }): void => cb(result)
    ipcRenderer.on('find:result', handler)
    return (): void => { ipcRenderer.removeListener('find:result', handler) }
  },

  // Rebuild + start (used by splash Retry when build failed)
  rebuildAndStart: (): Promise<unknown> => ipcRenderer.invoke('server:rebuild-and-start'),

  // Open log file
  openLogFile: (logPath: string): Promise<unknown> => ipcRenderer.invoke('app:open-log', logPath),

  // Open URL in default browser
  openExternal: (url: string): Promise<unknown> => ipcRenderer.invoke('app:open-external', url),

  // App
  getVersion: (): Promise<unknown> => ipcRenderer.invoke('app:version'),

  // App state changes (broadcast from main on every transition)
  onAppStateChanged: (
    cb: (_e: unknown, state: { kind: string; reason?: string }) => void
  ): (() => void) => {
    ipcRenderer.on('app-state:changed', cb as (...args: unknown[]) => void)
    return (): void => {
      ipcRenderer.removeListener('app-state:changed', cb as (...args: unknown[]) => void)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('proqDesktop', proqDesktopAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.proqDesktop = proqDesktopAPI
}
