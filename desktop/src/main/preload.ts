import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("proqDesktop", {
  // Setup checks
  checkNode: () => ipcRenderer.invoke("setup:check-node"),
  checkTmux: () => ipcRenderer.invoke("setup:check-tmux"),
  installTmux: () => ipcRenderer.invoke("setup:install-tmux"),
  checkClaude: () => ipcRenderer.invoke("setup:check-claude"),
  checkXcode: () => ipcRenderer.invoke("setup:check-xcode"),
  cloneRepo: (targetDir: string) => ipcRenderer.invoke("setup:clone", targetDir),
  validateInstall: (dirPath: string) => ipcRenderer.invoke("setup:validate", dirPath),
  npmInstall: () => ipcRenderer.invoke("setup:npm-install"),
  buildProq: () => ipcRenderer.invoke("setup:build"),
  persistClaude: (claudePath: string) => ipcRenderer.invoke("setup:persist-claude", claudePath),

  // Config
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (partial: Record<string, any>) => ipcRenderer.invoke("config:set", partial),
  selectDirectory: () => ipcRenderer.invoke("dialog:select-directory"),

  // Server
  startServer: () => ipcRenderer.invoke("server:start"),
  onServerReady: (cb: () => void) => {
    ipcRenderer.on("server:ready", cb);
    return () => ipcRenderer.removeListener("server:ready", cb);
  },
  onServerLog: (cb: (_e: any, line: string) => void) => {
    ipcRenderer.on("server:log", cb);
    return () => ipcRenderer.removeListener("server:log", cb);
  },
  onServerError: (cb: (_e: any, error: string) => void) => {
    ipcRenderer.on("server:error", cb);
    return () => ipcRenderer.removeListener("server:error", cb);
  },

  // Setup log streaming
  onSetupLog: (cb: (_e: any, line: string) => void) => {
    ipcRenderer.on("setup:log", cb);
    return () => ipcRenderer.removeListener("setup:log", cb);
  },

  // Updates
  checkUpdates: () => ipcRenderer.invoke("updates:check"),
  applyUpdate: () => ipcRenderer.invoke("updates:apply"),

  // App
  getVersion: () => ipcRenderer.invoke("app:version"),
});
