import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getConfig, setConfig } from './config'
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
  ipcMain.handle('setup:clone', (_e, targetDir: string) => cloneProq(targetDir))
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
    return startServer((line) => {
      mainWindow?.webContents.send('server:log', line)
    })
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
        // Replace splash with main app window
        const appWindow = createWindow('app')
        appWindow.loadURL(`http://localhost:${config.port}`)

        appWindow.webContents.on('did-finish-load', () => {
          mainWindow?.close()
          mainWindow = appWindow
        })

        // Open external links in default browser
        appWindow.webContents.setWindowOpenHandler(({ url }) => {
          if (url.startsWith('http')) shell.openExternal(url)
          return { action: 'deny' }
        })
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

  registerIpcHandlers()
  launchApp()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', async () => {
  await stopServer()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    launchApp()
  }
})
