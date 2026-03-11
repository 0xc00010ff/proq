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

## Stack

- [electron-vite](https://electron-vite.org/) + [electron-builder](https://www.electron.build/)
- React + TypeScript (renderer)
- Node.js child process management (main)
