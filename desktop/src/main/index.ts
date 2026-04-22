import { app, BrowserWindow, Menu, nativeImage, nativeTheme, ipcMain, dialog, shell, powerMonitor } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { electronApp, is } from '@electron-toolkit/utils'
import iconDark from '../../resources/icon.png?asset'
import iconLight from '../../resources/icon-light.png?asset'
import iconDevDark from '../../resources/icon-dev-dark.png?asset'
import iconDevLight from '../../resources/icon-dev-light.png?asset'
import { getConfig, setConfig, resetConfig, isDevMode } from './config'
import {
  checkNodeVersion,
  checkClaudeCli,
  checkXcodeTools,
  installXcodeTools,
  installClaude,
  cloneProq,
  validateExistingInstall,
  runNpmInstall,
  runNpmBuild,
  persistClaudePath
} from './setup'
import { startServer, healthCheck, getServerLogPath } from './server'
import { parseErrorSummary } from './error-diagnostics'
import { checkForUpdates } from './updater'
import { checkForShellUpdate, isShellUpdateDownloaded } from './shell-updater'
import {
  initAppState,
  transitionTo,
  getState,
  getMainWindow,
  setMainWindow,
  isExiting,
  safeSendToMain,
  pauseRunningTimers,
  resumeRunningTimers,
  onStateChange,
  type AppState
} from './app-state'

// Fix PATH for macOS GUI apps (they don't inherit shell PATH)
import { ensurePath } from './shell-path'
ensurePath()

// Suppress Chromium's Media Session integration — it probes macOS media frameworks
// on startup, which triggers a scary "would like to access Apple Music" TCC prompt
// that has nothing to do with our app.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService')

// Isolate dev mode: separate userData dir so dev and production don't share config/ports
if (process.env.PROQ_DEV) {
  app.setName('proq-desktop-dev')
}

function getIcon(): Electron.NativeImage {
  const dark = nativeTheme.shouldUseDarkColors
  const path = is.dev ? (dark ? iconDevDark : iconDevLight) : (dark ? iconDark : iconLight)
  return nativeImage.createFromPath(path)
}

let findWindow: BrowserWindow | null = null

function getLogPath(): string {
  try {
    return join(app.getPath('userData'), 'desktop.log')
  } catch {
    return join(getConfig().proqPath, 'data', 'desktop.log')
  }
}

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { fs.appendFileSync(getLogPath(), line) } catch { /* */ }
}

function createWindow(mode: 'wizard' | 'splash' | 'app'): BrowserWindow {
  const config = getConfig()

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    show: false,
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    icon: getIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  }

  switch (mode) {
    case 'wizard':
      Object.assign(windowOptions, {
        width: 620,
        height: 520,
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
      const validBounds = bounds && bounds.width >= 800 && bounds.height >= 600 ? bounds : null
      Object.assign(windowOptions, {
        width: validBounds?.width || 1400,
        height: validBounds?.height || 900,
        x: validBounds?.x,
        y: validBounds?.y,
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 16, y: 18 }
      })
      break
    }
  }

  const win = new BrowserWindow(windowOptions)

  // Enable native right-click context menu (copy/paste/etc)
  win.webContents.on('context-menu', (_e, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = []

    if (params.isEditable) {
      if (params.misspelledWord) {
        for (const suggestion of params.dictionarySuggestions) {
          menuItems.push({
            label: suggestion,
            click: () => win.webContents.replaceMisspelling(suggestion)
          })
        }
        menuItems.push({
          label: 'Add to dictionary',
          click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
        })
        menuItems.push({ type: 'separator' })
      }

      menuItems.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      )
    } else if (params.selectionText) {
      menuItems.push(
        { role: 'copy' }
      )
    }

    if (params.hasImageContents) {
      if (menuItems.length > 0) menuItems.push({ type: 'separator' })
      menuItems.push(
        {
          label: 'Copy Image',
          click: () => win.webContents.copyImageAt(params.x, params.y)
        },
        {
          label: 'Save Image As\u2026',
          click: () => {
            win.webContents.downloadURL(params.srcURL)
          }
        }
      )
      if (params.srcURL) {
        menuItems.push({
          label: 'Open Image in Browser',
          click: () => shell.openExternal(params.srcURL)
        })
      }
    }

    if (params.linkURL) {
      if (menuItems.length > 0) menuItems.push({ type: 'separator' })
      menuItems.push({
        label: 'Open Link in Browser',
        click: () => shell.openExternal(params.linkURL)
      })
    }

    if (menuItems.length > 0) {
      Menu.buildFromTemplate(menuItems).popup({ window: win })
    }
  })

  // Enable context menu for embedded <webview> tags (e.g. LiveTab preview)
  win.webContents.on('did-attach-webview', (_e, guestContents) => {
    guestContents.on('context-menu', (_ev, params) => {
      const menuItems: Electron.MenuItemConstructorOptions[] = []

      if (params.isEditable) {
        if (params.misspelledWord) {
          for (const suggestion of params.dictionarySuggestions) {
            menuItems.push({
              label: suggestion,
              click: () => guestContents.replaceMisspelling(suggestion)
            })
          }
          menuItems.push({
            label: 'Add to dictionary',
            click: () => guestContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
          })
          menuItems.push({ type: 'separator' })
        }

        menuItems.push(
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        )
      } else if (params.selectionText) {
        menuItems.push({ role: 'copy' })
      }

      if (params.linkURL) {
        if (menuItems.length > 0) menuItems.push({ type: 'separator' })
        menuItems.push({
          label: 'Open Link in Browser',
          click: () => shell.openExternal(params.linkURL)
        })
      }

      // Always show Inspect Element for webviews
      if (menuItems.length > 0) menuItems.push({ type: 'separator' })
      menuItems.push({
        label: 'Inspect Element',
        click: () => guestContents.inspectElement(params.x, params.y)
      })

      if (menuItems.length > 0) {
        Menu.buildFromTemplate(menuItems).popup({ window: win })
      }
    })
  })

  win.once('ready-to-show', () => win.show())

  // Forward find-in-page results to the find bar child window
  if (mode === 'app') {
    win.webContents.on('found-in-page', (_e, result) => {
      if (findWindow && !findWindow.isDestroyed()) {
        findWindow.webContents.send('find:result', {
          activeMatchOrdinal: result.activeMatchOrdinal,
          matches: result.matches
        })
      }
    })
  }

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
  ipcMain.handle('setup:check-claude', () => checkClaudeCli())
  ipcMain.handle('setup:check-xcode', () => checkXcodeTools())
  ipcMain.handle('setup:install-xcode', () => installXcodeTools())
  ipcMain.handle('setup:install-claude', () =>
    installClaude((line) => safeSendToMain('setup:log', line))
  )
  ipcMain.handle('setup:clone', (_e, targetDir: string, overwrite?: boolean) => cloneProq(targetDir, overwrite))
  ipcMain.handle('setup:validate', (_e, dirPath: string) => validateExistingInstall(dirPath))

  ipcMain.handle('setup:npm-install', async () => {
    const { proqPath } = getConfig()
    return runNpmInstall(proqPath, (line) => {
      safeSendToMain('setup:log', line)
    })
  })

  ipcMain.handle('setup:build', async () => {
    const { proqPath } = getConfig()
    return runNpmBuild(proqPath, (line) => {
      safeSendToMain('setup:log', line)
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

  // Wizard complete — main process takes over to show splash + start server
  ipcMain.handle('wizard:complete', () => {
    void transitionTo({ kind: 'launching' })
  })

  // Server (used by splash Retry button — we're still in 'launching', re-run the
  // server-start sub-step rather than re-entering the state).
  ipcMain.handle('server:start', async () => {
    const result = await startServer((line) => {
      safeSendToMain('server:log', line)
    })
    if (result.ok) {
      void transitionTo({ kind: 'running' })
    }
    return result
  })

  // Rebuild + start (used by splash Retry when build failed)
  ipcMain.handle('server:rebuild-and-start', async () => {
    const { proqPath } = getConfig()
    safeSendToMain('server:log', 'Rebuilding...')
    const buildResult = await runNpmBuild(proqPath, (line) => {
      safeSendToMain('server:log', line)
    })
    if (!buildResult.ok) {
      const err = {
        message: parseErrorSummary(buildResult.error || '', 'build'),
        phase: 'build',
        logPath: getServerLogPath()
      }
      safeSendToMain('server:error', JSON.stringify(err))
      return { ok: false }
    }
    safeSendToMain('server:log', 'Starting server...')
    const result = await startServer((line) => {
      safeSendToMain('server:log', line)
    })
    if (result.ok) {
      void transitionTo({ kind: 'running' })
    } else {
      const err = {
        message: parseErrorSummary(result.error || '', 'server'),
        phase: 'server',
        logPath: getServerLogPath()
      }
      safeSendToMain('server:error', JSON.stringify(err))
    }
    return result
  })

  // Open log file (used by splash "View full log" link)
  ipcMain.handle('app:open-log', (_e, logPath: string) => {
    shell.openPath(logPath)
  })

  // Open external URL in the default browser. Guard against non-http(s) schemes
  // so renderer code can't use this as a generic launcher (e.g. file://, javascript:).
  ipcMain.handle('app:open-external', (_e, url: string) => {
    if (typeof url !== 'string') return
    if (!/^https?:\/\//i.test(url)) return
    shell.openExternal(url)
  })

  // Updates
  ipcMain.handle('updates:check', () => checkForUpdates())

  // Shell updates
  ipcMain.handle('shell-update:check', () => checkForShellUpdate())
  ipcMain.handle('shell-update:install', () => {
    void transitionTo({ kind: 'exiting', reason: 'install-shell-update' })
  })

  // Restart — if a shell update has been downloaded by electron-updater,
  // route through quitAndInstall so the new .app actually gets installed.
  // Otherwise just relaunch the current process. Splash handles web-update
  // pull-and-build on next boot.
  ipcMain.handle('app:restart', () => {
    const reason = isShellUpdateDownloaded() ? 'install-shell-update' : 'relaunch'
    void transitionTo({ kind: 'exiting', reason })
  })

  // App info
  ipcMain.handle('app:version', () => app.getVersion())

  // Find in page — target the parent window (caller is the find bar child window)
  ipcMain.handle('find:find', (event, text: string, options?: { forward?: boolean; findNext?: boolean }) => {
    const sender = BrowserWindow.fromWebContents(event.sender)
    const target = sender?.getParentWindow() || sender
    if (target && text) {
      target.webContents.findInPage(text, options)
    }
  })
  ipcMain.handle('find:stop', (event) => {
    const sender = BrowserWindow.fromWebContents(event.sender)
    const target = sender?.getParentWindow() || sender
    if (target) {
      target.webContents.stopFindInPage('clearSelection')
    }
  })
}

// ── Find Bar (child window) ──────────────────────────────────────────

const FIND_BAR_HTML = `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:transparent}
.bar{display:flex;align-items:center;gap:6px;padding:6px 12px;background:#27272a;border:1px solid #52525b;border-radius:8px}
input{width:192px;background:#18181b;border:1px solid #52525b;border-radius:4px;padding:4px 8px;font-size:13px;color:#f4f4f5;outline:none}
input:focus{border-color:#3b82f6}input::placeholder{color:#71717a}
.count{font-size:12px;color:#a1a1aa;white-space:nowrap;min-width:60px;text-align:center}
button{background:none;border:none;padding:4px;color:#a1a1aa;cursor:pointer;border-radius:4px;display:flex;align-items:center}
button:hover{color:#e4e4e7;background:#3f3f46}
svg{width:14px;height:14px}
</style></head><body><div class="bar">
<input id="q" type="text" placeholder="Find..." autofocus/>
<span id="count" class="count"></span>
<button id="prev" title="Previous (Shift+Enter)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg></button>
<button id="next" title="Next (Enter)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>
<button id="close" title="Close (Escape)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
</div><script>
const q=document.getElementById('q'),countEl=document.getElementById('count'),api=window.proqDesktop;
let cur='';
q.addEventListener('input',()=>{cur=q.value;if(cur){api.findInPage(cur)}else{api.stopFind();countEl.textContent=''}});
q.addEventListener('keydown',(e)=>{if(e.key==='Escape'){api.stopFind();window.close()}else if(e.key==='Enter'){e.preventDefault();if(cur)api.findInPage(cur,{forward:!e.shiftKey,findNext:true})}});
document.getElementById('prev').addEventListener('click',()=>{if(cur)api.findInPage(cur,{forward:false,findNext:true});q.focus()});
document.getElementById('next').addEventListener('click',()=>{if(cur)api.findInPage(cur,{forward:true,findNext:true});q.focus()});
document.getElementById('close').addEventListener('click',()=>{api.stopFind();window.close()});
if(api&&api.onFindResult){api.onFindResult((r)=>{if(cur){countEl.textContent=r.matches>0?r.activeMatchOrdinal+' of '+r.matches:'No results'}})}
</script></body></html>`

function showFindBar(parent: BrowserWindow): void {
  if (findWindow && !findWindow.isDestroyed()) {
    findWindow.focus()
    // Select all text in the input for easy replacement
    findWindow.webContents.executeJavaScript('document.getElementById("q").select()')
    return
  }

  const parentBounds = parent.getBounds()
  const w = 380
  const h = 48

  findWindow = new BrowserWindow({
    width: w,
    height: h,
    x: parentBounds.x + parentBounds.width - w - 20,
    y: parentBounds.y + 52,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    parent,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  findWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(FIND_BAR_HTML))
  findWindow.once('ready-to-show', () => findWindow?.show())

  findWindow.on('closed', () => {
    // Clear highlights when find bar closes
    if (!parent.isDestroyed()) {
      parent.webContents.stopFindInPage('clearSelection')
    }
    findWindow = null
  })

  // Reposition when parent moves or resizes
  const reposition = (): void => {
    if (!findWindow || findWindow.isDestroyed()) return
    const b = parent.getBounds()
    findWindow.setPosition(b.x + b.width - w - 20, b.y + 52)
  }
  parent.on('move', reposition)
  parent.on('resize', reposition)

  findWindow.on('closed', () => {
    parent.removeListener('move', reposition)
    parent.removeListener('resize', reposition)
  })
}

// ── App Lifecycle ─────────────────────────────────────────────────────

function createAppWindow(): BrowserWindow {
  const config = getConfig()
  const appWindow = createWindow('app')
  appWindow.loadURL(`http://localhost:${config.port}`)

  // Retry loading if the page fails (e.g. Cmd-R while server is slow)
  // In dev mode, the dev server handles its own HMR — don't force-reload.
  if (!isDevMode()) {
    appWindow.webContents.on('did-fail-load', (_e, _code, _desc, url, isMainFrame) => {
      if (isMainFrame && url.startsWith('http://localhost') && !appWindow.isDestroyed()) {
        setTimeout(() => {
          if (!appWindow.isDestroyed()) appWindow.loadURL(url)
        }, 1000)
      }
    })
  }

  // Open external links in default browser
  appWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  return appWindow
}

async function launchApp(): Promise<void> {
  const config = getConfig()
  log(`launchApp: setupComplete=${config.setupComplete} proqPath=${config.proqPath} port=${config.port} devMode=${config.devMode}`)
  log(`launchApp: PATH=${process.env.PATH}`)

  if (!config.setupComplete) {
    await transitionTo({ kind: 'setup' })
  } else {
    await transitionTo({ kind: 'launching' })
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.proq.desktop')

  // Set dock icon on macOS (in dev mode always; in prod for theme switching)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(getIcon())
    nativeTheme.on('updated', () => {
      if (app.dock) app.dock.setIcon(getIcon())
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.setIcon(getIcon())
      }
    })
  }

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
                  copyright: 'Build beautiful things'
                })
                app.showAboutPanel()
              }
            },
            {
              label: 'Check for Updates…',
              click: async (): Promise<void> => {
                const result = await checkForUpdates()
                const win = getMainWindow()
                if (result.available && win && !win.isDestroyed()) {
                  win.webContents.send('updates:available', result)
                } else if (!result.available) {
                  dialog.showMessageBox({
                    type: 'info',
                    icon: getIcon(),
                    buttons: ['OK'],
                    message: 'You\'re up to date',
                    detail: 'proq is running the latest version.'
                  })
                }
              }
            },
            { type: 'separator' },
            {
              label: 'Settings…',
              click: (): void => {
                // Only navigate when the app window is actually live; otherwise
                // loadURL races with reset/exit teardown and crashes.
                if (getState().kind !== 'running') return
                const config = getConfig()
                const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
                if (win) win.loadURL(`http://localhost:${config.port}/settings`)
              }
            },
            { type: 'separator' },
            {
              label: 'Reset to Defaults…',
              click: async (): Promise<void> => {
                const config = getConfig()
                const { response } = await dialog.showMessageBox({
                  type: 'warning',
                  icon: getIcon(),
                  buttons: ['Cancel', 'Reset'],
                  defaultId: 0,
                  message: 'Reset proq Desktop?',
                  detail: `This resets the desktop app and restarts the setup wizard. Your project data at ${config.proqPath} will not be affected.\n\nUse this to switch to dev mode or change your proq installation path.`
                })
                if (response === 1) {
                  resetConfig()
                  // In-process transition back to the wizard. We can't use
                  // app.relaunch() here because in dev mode the relaunched
                  // electron loses ELECTRON_RENDERER_URL (electron-vite sets it
                  // only on the original spawn) and the new window loads
                  // nothing. The state machine tears down the server and
                  // windows in exitState/enterSetup either way.
                  void transitionTo({ kind: 'setup' })
                }
              }
            },
            { type: 'separator' },
            { role: 'quit' }
          ]
        },
        {
          label: 'File',
          submenu: [
            {
              label: 'New Window',
              accelerator: 'CmdOrCtrl+N',
              click: (): void => {
                const config = getConfig()
                if (config.setupComplete) createAppWindow()
              }
            }
          ]
        },
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
            { type: 'separator' },
            {
              label: 'Find',
              accelerator: 'CmdOrCtrl+F',
              click: (): void => {
                const win = BrowserWindow.getFocusedWindow()
                if (win) showFindBar(win)
              }
            }
          ]
        },
        {
          label: 'History',
          submenu: [
            {
              label: 'Back',
              accelerator: 'CmdOrCtrl+[',
              click: (): void => {
                const win = BrowserWindow.getFocusedWindow()
                if (win) win.webContents.goBack()
              }
            },
            {
              label: 'Forward',
              accelerator: 'CmdOrCtrl+]',
              click: (): void => {
                const win = BrowserWindow.getFocusedWindow()
                if (win) win.webContents.goForward()
              }
            }
          ]
        },
        { role: 'viewMenu' },
        { role: 'windowMenu' }
      ])
    )
  }

  // Power monitor — handle sleep/wake. State machine still owns the schedulers;
  // we just pause them on suspend and either trigger a recovery transition or
  // refresh stale window contents on resume.
  powerMonitor.on('suspend', () => {
    pauseRunningTimers()
  })

  powerMonitor.on('resume', async () => {
    if (getState().kind !== 'running') return
    const config = getConfig()
    if (!isDevMode()) {
      const healthy = await healthCheck(config.port)
      if (!healthy) {
        void transitionTo({ kind: 'recovering' })
        return
      }
      const url = `http://localhost:${config.port}`
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue
        try {
          const alive = await win.webContents.executeJavaScript(
            'document.body?.children.length > 0'
          )
          if (!alive) win.loadURL(url)
        } catch {
          win.loadURL(url)
        }
      }
    }
    resumeRunningTimers()
  })

  initAppState({ createWindow, loadRendererPage, createAppWindow, log })

  // Broadcast every state change so the renderer can show overlays
  // ("Restarting…" while exiting, "Reconnecting…" while recovering, etc.)
  onStateChange((state: AppState) => {
    const payload = state.kind === 'exiting'
      ? { kind: state.kind, reason: state.reason }
      : { kind: state.kind }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('app-state:changed', payload)
      }
    }
  })

  registerIpcHandlers()
  launchApp()
})

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  // The state machine handles its own teardown; only short-circuit if it's
  // already exiting, so we don't double-fire the exit path.
  if (isExiting()) return
  void transitionTo({ kind: 'exiting', reason: 'quit' })
})

app.on('before-quit', (event) => {
  // Route every quit through the state machine so server teardown, watchdog,
  // and update-install-on-quit all happen consistently. If we're already
  // exiting, let it through to avoid blocking.
  if (isExiting()) return
  event.preventDefault()
  void transitionTo({ kind: 'exiting', reason: 'quit' })
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const config = getConfig()
    if (config.setupComplete && getState().kind === 'running') {
      const win = createAppWindow()
      setMainWindow(win)
    } else {
      launchApp()
    }
  }
})
