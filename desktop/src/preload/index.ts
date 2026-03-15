import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const proqDesktopAPI = {
  // Setup checks
  checkNode: (): Promise<unknown> => ipcRenderer.invoke('setup:check-node'),
  checkTmux: (): Promise<unknown> => ipcRenderer.invoke('setup:check-tmux'),
  installTmux: (): Promise<unknown> => ipcRenderer.invoke('setup:install-tmux'),
  checkClaude: (): Promise<unknown> => ipcRenderer.invoke('setup:check-claude'),
  checkXcode: (): Promise<unknown> => ipcRenderer.invoke('setup:check-xcode'),
  checkHomebrew: (): Promise<unknown> => ipcRenderer.invoke('setup:check-homebrew'),
  installHomebrew: (): Promise<unknown> => ipcRenderer.invoke('setup:install-homebrew'),
  installNode: (): Promise<unknown> => ipcRenderer.invoke('setup:install-node'),
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
  applyUpdate: (): Promise<unknown> => ipcRenderer.invoke('updates:apply'),
  applyAndRestart: (): Promise<unknown> => ipcRenderer.invoke('updates:apply-and-restart'),
  onUpdateAvailable: (cb: (_e: unknown, result: unknown) => void): (() => void) => {
    ipcRenderer.on('updates:available', cb as (...args: unknown[]) => void)
    return (): void => {
      ipcRenderer.removeListener('updates:available', cb as (...args: unknown[]) => void)
    }
  },

  // App
  getVersion: (): Promise<unknown> => ipcRenderer.invoke('app:version')
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
