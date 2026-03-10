import { app, BrowserWindow, Menu, nativeImage, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getConfig, setConfig, resetConfig } from './config'
import {
  checkNodeVersion,
  checkTmux,
  installTmux,
  checkClaudeCli,
  checkXcodeTools,
  cloneProq,
  validateExistingInstall,
  runNpmInstall,
  runNpmBuild,
  persistClaudePath
} from './setup'
import { startServer, stopServer } from './server'
import { checkForUpdates, applyUpdate } from './updater'

// Fix PATH for macOS GUI apps (they don't inherit shell PATH)
try {
  require('fix-path')()
} catch {
  // fix-path may fail in some environments, proceed without it
}

let mainWindow: BrowserWindow | null = null
let isResetting = false

function createWindow(mode: 'wizard' | 'splash' | 'app'): BrowserWindow {
  const config = getConfig()

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    show: false,
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  }

  switch (mode) {
    case 'wizard':
      Object.assign(windowOptions, {
        width: 620,
        height: 620,
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
      Object.assign(windowOptions, {
        width: bounds?.width || 1400,
        height: bounds?.height || 900,
        x: bounds?.x,
        y: bounds?.y,
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 16, y: 18 }
      })
      break
    }
  }

  const win = new BrowserWindow(windowOptions)

  win.once('ready-to-show', () => win.show())

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
  ipcMain.handle('setup:check-tmux', () => checkTmux())
  ipcMain.handle('setup:install-tmux', () => installTmux())
  ipcMain.handle('setup:check-claude', () => checkClaudeCli())
  ipcMain.handle('setup:check-xcode', () => checkXcodeTools())
  ipcMain.handle('setup:clone', (_e, targetDir: string, overwrite?: boolean) => cloneProq(targetDir, overwrite))
  ipcMain.handle('setup:validate', (_e, dirPath: string) => validateExistingInstall(dirPath))

  ipcMain.handle('setup:npm-install', async () => {
    const { proqPath } = getConfig()
    return runNpmInstall(proqPath, (line) => {
      mainWindow?.webContents.send('setup:log', line)
    })
  })

  ipcMain.handle('setup:build', async () => {
    const { proqPath } = getConfig()
    return runNpmBuild(proqPath, (line) => {
      mainWindow?.webContents.send('setup:log', line)
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

  // Server
  ipcMain.handle('server:start', async () => {
    const result = await startServer((line) => {
      mainWindow?.webContents.send('server:log', line)
    })
    if (result.ok) {
      transitionToApp()
    }
    return result
  })

  // Updates
  ipcMain.handle('updates:check', () => checkForUpdates())
  ipcMain.handle('updates:apply', () =>
    applyUpdate((line) => mainWindow?.webContents.send('setup:log', line))
  )

  // App info
  ipcMain.handle('app:version', () => app.getVersion())
}

// ── App Lifecycle ─────────────────────────────────────────────────────

function transitionToApp(): void {
  const config = getConfig()
  const appWindow = createWindow('app')
  appWindow.loadURL(`http://localhost:${config.port}`)

  const previousWindow = mainWindow
  appWindow.webContents.once('did-finish-load', () => {
    if (previousWindow && previousWindow !== appWindow && !previousWindow.isDestroyed()) {
      previousWindow.close()
    }
    mainWindow = appWindow
  })

  // Retry loading if the page fails (e.g. Cmd-R while server is slow)
  appWindow.webContents.on('did-fail-load', (_e, _code, _desc, url) => {
    if (url.startsWith('http://localhost') && !appWindow.isDestroyed()) {
      setTimeout(() => {
        if (!appWindow.isDestroyed()) appWindow.loadURL(url)
      }, 1000)
    }
  })

  // Open external links in default browser
  appWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

async function launchApp(): Promise<void> {
  const config = getConfig()

  if (!config.setupComplete) {
    // First run — show wizard
    mainWindow = createWindow('wizard')
    loadRendererPage(mainWindow, 'wizard')
  } else {
    // Normal launch — show splash, start server, then navigate to app
    mainWindow = createWindow('splash')
    loadRendererPage(mainWindow, 'splash')

    try {
      const result = await startServer((line) => {
        mainWindow?.webContents.send('server:log', line)
      })

      if (result.ok) {
        transitionToApp()
      } else {
        mainWindow?.webContents.send('server:error', result.error || 'Server failed to start')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      mainWindow?.webContents.send('server:error', message)
    }
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.proq.desktop')

  // Set dock icon on macOS (in dev mode it doesn't come from the app bundle)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

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
                  copyright: 'Build beautiful things',
                  iconPath: icon,
                  icons: [nativeImage.createFromPath(icon)]
                })
                app.showAboutPanel()
              }
            },
            { type: 'separator' },
            {
              label: 'Reset to Defaults…',
              click: async (): Promise<void> => {
                const { response } = await dialog.showMessageBox({
                  type: 'warning',
                  icon: nativeImage.createFromPath(icon),
                  buttons: ['Cancel', 'Reset'],
                  defaultId: 0,
                  message: 'Reset proq Desktop?',
                  detail: 'This will clear all settings and restart the setup wizard.'
                })
                if (response === 1) {
                  isResetting = true
                  await stopServer()
                  resetConfig()
                  // Close all existing windows before relaunching
                  for (const win of BrowserWindow.getAllWindows()) {
                    win.destroy()
                  }
                  mainWindow = null
                  isResetting = false
                  launchApp()
                }
              }
            },
            { type: 'separator' },
            { role: 'quit' }
          ]
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' }
      ])
    )
  }

  registerIpcHandlers()
  launchApp()
})

app.on('window-all-closed', () => {
  if (!isResetting) app.quit()
})

app.on('before-quit', async () => {
  await stopServer()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    launchApp()
  }
})
