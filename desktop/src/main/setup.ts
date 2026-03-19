import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { getConfig, setConfig } from './config'

const execFileAsync = promisify(execFile)

export interface CheckResult {
  ok: boolean
  version?: string
  path?: string
  error?: string
}

export async function checkNodeVersion(): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync('node', ['-v'])
    const version = stdout.trim().replace(/^v/, '')
    const major = parseInt(version.split('.')[0], 10)
    if (major >= 20) {
      return { ok: true, version }
    }
    return { ok: false, version, error: `Node.js ${version} found — v20+ required` }
  } catch {
    return { ok: false, error: 'Node.js not found' }
  }
}

export async function checkClaudeCli(): Promise<CheckResult> {
  const searchPaths = [
    path.join(process.env.HOME || '', '.local/bin/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(process.env.HOME || '', '.npm-global/bin/claude')
  ]

  try {
    const { stdout } = await execFileAsync('which', ['claude'])
    const claudePath = stdout.trim()
    if (claudePath) {
      return { ok: true, path: claudePath }
    }
  } catch {
    // not on PATH, check known locations
  }

  for (const p of searchPaths) {
    try {
      await fs.promises.access(p, fs.constants.X_OK)
      return { ok: true, path: p }
    } catch {
      continue
    }
  }

  // Check nvm directories
  const nvmDir = process.env.NVM_DIR
  if (nvmDir) {
    const versionsDir = path.join(nvmDir, 'versions/node')
    try {
      const entries = await fs.promises.readdir(versionsDir)
      for (const entry of entries.reverse()) {
        const claudePath = path.join(versionsDir, entry, 'bin/claude')
        try {
          await fs.promises.access(claudePath, fs.constants.X_OK)
          return { ok: true, path: claudePath }
        } catch {
          continue
        }
      }
    } catch {
      // nvm dir doesn't exist
    }
  }

  return { ok: false, error: 'Claude Code CLI not found' }
}

export async function installXcodeTools(): Promise<CheckResult> {
  if (process.platform !== 'darwin') {
    return { ok: true, version: 'n/a' }
  }
  try {
    await execFileAsync('xcode-select', ['--install'])
    // This launches a system dialog — caller should re-check when user says they're done
    return { ok: false, error: 'pending' }
  } catch (e: unknown) {
    // xcode-select --install returns non-zero if already installed or if dialog launched
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('already installed')) {
      return checkXcodeTools()
    }
    // Dialog was launched
    return { ok: false, error: 'pending' }
  }
}

export async function installClaude(onLog: (line: string) => void): Promise<CheckResult> {
  try {
    await runStreamingCommand('npm', ['install', '-g', '@anthropic-ai/claude-code'], onLog)
    return checkClaudeCli()
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Failed to install Claude CLI: ${message}` }
  }
}

/** Run a command with streaming stdout/stderr to onLog callback */
function runStreamingCommand(
  cmd: string,
  args: string[],
  onLog: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout?.on('data', (data: Buffer) => onLog(data.toString()))
    child.stderr?.on('data', (data: Buffer) => onLog(data.toString()))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

export async function checkXcodeTools(): Promise<CheckResult> {
  if (process.platform !== 'darwin') {
    return { ok: true, version: 'n/a' }
  }
  try {
    await execFileAsync('xcode-select', ['-p'])
    return { ok: true }
  } catch {
    return { ok: false, error: 'Xcode Command Line Tools not installed' }
  }
}

export async function cloneProq(targetDir: string, overwrite = false): Promise<{ ok: boolean; error?: string }> {
  if (!overwrite) {
    const pkgPath = path.join(targetDir, 'package.json')
    try {
      const raw = await fs.promises.readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(raw)
      if (pkg.name === 'proq') {
        return { ok: true }
      }
    } catch {
      // Not cloned yet
    }
  }

  try {
    if (overwrite) {
      await fs.promises.rm(targetDir, { recursive: true, force: true })
    }
    const parentDir = path.dirname(targetDir)
    const dirName = path.basename(targetDir)
    await fs.promises.mkdir(parentDir, { recursive: true })
    await execFileAsync('git', ['clone', 'https://github.com/0xc00010ff/proq.git', dirName], {
      cwd: parentDir
    })
    return { ok: true }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Clone failed: ${message}` }
  }
}

export async function validateExistingInstall(dirPath: string): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(path.join(dirPath, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw)
    return pkg.name === 'proq'
  } catch {
    return false
  }
}

export function runNpmInstall(
  proqPath: string,
  onLog: (line: string) => void
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['install'], {
      cwd: proqPath,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stdout?.on('data', (data: Buffer) => onLog(data.toString()))
    child.stderr?.on('data', (data: Buffer) => onLog(data.toString()))

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true })
      } else {
        resolve({ ok: false, error: `npm install exited with code ${code}` })
      }
    })

    child.on('error', (err) => {
      resolve({ ok: false, error: err.message })
    })
  })
}

export function runNpmBuild(
  proqPath: string,
  onLog: (line: string) => void
): Promise<{ ok: boolean; error?: string }> {
  const config = getConfig()
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'build'], {
      cwd: proqPath,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        NEXT_PUBLIC_ELECTRON: '1',
        PROQ_WS_PORT: String(config.wsPort),
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stdout?.on('data', (data: Buffer) => onLog(data.toString()))
    child.stderr?.on('data', (data: Buffer) => onLog(data.toString()))

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true })
      } else {
        resolve({ ok: false, error: `npm run build exited with code ${code}` })
      }
    })

    child.on('error', (err) => {
      resolve({ ok: false, error: err.message })
    })
  })
}

export async function persistClaudePath(
  proqPath: string,
  claudeBinPath: string
): Promise<void> {
  const settingsFile = path.join(proqPath, 'data', 'settings.json')
  await fs.promises.mkdir(path.join(proqPath, 'data'), { recursive: true })

  let settings: Record<string, unknown> = {}
  try {
    const raw = await fs.promises.readFile(settingsFile, 'utf-8')
    settings = JSON.parse(raw)
  } catch {
    // No existing settings
  }

  settings.claudeBin = claudeBinPath
  await fs.promises.writeFile(settingsFile, JSON.stringify(settings, null, 2) + '\n')
  setConfig({ claudeBinPath })
}
