# Proq Desktop

The native macOS/Linux/Windows app for Proq. A thin Electron wrapper that manages the server lifecycle — no terminal required.

On first launch, it walks you through setup: cloning the repo, installing dependencies, and building the server. After that, it starts the server automatically and loads the UI in a native window.

## Development

```bash
cd desktop
npm install
npm run dev
```

## Build

```bash
npm run build:mac     # macOS (.dmg)
npm run build:linux   # Linux (.AppImage)
npm run build:win     # Windows (.exe)
```

## How It Works

The desktop app does **not** embed or modify the Next.js server. It spawns the server as a child process using your system's Node.js, then loads `localhost:{port}` in a BrowserWindow. This avoids native module rebuild issues entirely.

```
Electron App
  ├── Setup Wizard (first run) → clone, install deps, build
  ├── Splash Screen → start server, poll until ready
  └── BrowserWindow → load localhost:{port}
```

Config is stored in the OS app data directory (`~/Library/Application Support/proq-desktop/config.json` on macOS).

## Updates

The desktop app has two independent update paths:

- **Web content** (the Next.js app) — on each launch, the splash screen checks `origin/main` for new commits and runs `git pull` + `npm install` + `npm run build` automatically. A background check also runs hourly while the app is open; updates are indicated by a dot on the Settings icon.
- **Shell** (the Electron `.app` itself) — delivered via [electron-updater](https://www.electron.build/auto-update) from GitHub Releases. The app checks for shell updates periodically and downloads them in the background. When ready, a prompt appears in Settings to restart.

Web updates ship as patch versions (e.g. 0.5.0 → 0.5.1). Shell updates ship as minor versions (e.g. 0.5.x → 0.6.0) with a GitHub Release containing the built DMG.

### Dev mode

When running `npm run dev`, the `PROQ_DEV=1` environment variable is set automatically. This disables all update checks — no git pulls, no background checks, no shell update polling. Developers manage their own git workflow.

## Releasing

From `main`, after merging from `develop`:

```bash
npm run deploy              # patch bump — web content (tag + GitHub Release + push)
npm run deploy -- --desktop # minor bump — desktop + web (tag + build + GitHub Release + push)
```

## Stack

- [electron-vite](https://electron-vite.org/) + [electron-builder](https://www.electron.build/)
- [electron-updater](https://www.electron.build/auto-update) for shell auto-updates
- React + TypeScript (renderer)
- Node.js child process management (main)
