import { ChildProcess, spawn, execSync } from 'child_process'
import http from 'http'
import { getConfig, isDevMode } from './config'

let serverProcess: ChildProcess | null = null
let intentionalStop = false
let exitCallback: (() => void) | null = null

function killProcessOnPort(port: number): void {
  try {
    const pids = execSync(`lsof -ti:${port}`, { encoding: 'utf-8' }).trim()
    if (pids) {
      execSync(`kill -9 ${pids.split('\n').join(' ')}`)
    }
  } catch {
    // No process on port, or kill failed — either way, proceed
  }
}

export async function startServer(
  onLog?: (line: string) => void
): Promise<{ ok: boolean; error?: string }> {
  const config = getConfig()
  const { proqPath, port, wsPort } = config
  const command = isDevMode() ? 'dev' : 'start'

  intentionalStop = false

  // Kill anything already on the port for a clean start
  if (serverProcess) {
    serverProcess.kill('SIGKILL')
    serverProcess = null
  }
  killProcessOnPort(port)
  killProcessOnPort(wsPort)
  // Brief pause to let the ports free up
  await new Promise((r) => setTimeout(r, 500))

  return new Promise((resolve) => {

    const child = spawn('npm', ['run', command], {
      cwd: proqPath,
      env: {
        ...process.env,
        PORT: String(port),
        PROQ_WS_PORT: String(wsPort),
        NEXT_PUBLIC_WS_PORT: String(wsPort),
        NEXT_PUBLIC_ELECTRON: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    serverProcess = child
    let earlyError: string | null = null

    const detectPortError = (text: string): void => {
      if (earlyError) return
      if (text.includes('EADDRINUSE') || text.includes('address already in use')) {
        // Try to extract the actual port from the error message
        const portMatch = text.match(/:(\d+)/)
        const failedPort = portMatch ? portMatch[1] : String(port)
        earlyError = `Port ${failedPort} is already in use. Change the port in Settings or stop the other process.`
      }
    }

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      onLog?.(text)
      detectPortError(text)
    })

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      onLog?.(text)
      detectPortError(text)
    })

    child.on('error', (err) => {
      serverProcess = null
      resolve({ ok: false, error: err.message })
    })

    child.on('close', (code) => {
      serverProcess = null
      if (earlyError) {
        resolve({ ok: false, error: earlyError })
      } else if (code !== null && code !== 0) {
        resolve({ ok: false, error: `Server exited with code ${code}` })
      } else if (!intentionalStop && exitCallback) {
        exitCallback()
      }
    })

    pollUntilReady(port, 60_000)
      .then(() => resolve({ ok: true }))
      .catch(() => {
        // If the process already exited with an error, use that message
        if (earlyError) {
          resolve({ ok: false, error: earlyError })
        } else if (!serverProcess || serverProcess.killed) {
          resolve({ ok: false, error: 'Server process exited unexpectedly' })
        } else {
          resolve({ ok: false, error: `Server did not respond on port ${port} within 60s` })
        }
      })
  })
}

export function stopServer(): Promise<void> {
  intentionalStop = true
  return new Promise((resolve) => {
    if (!serverProcess) {
      resolve()
      return
    }

    const child = serverProcess
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
    }, 5000)

    child.on('close', () => {
      clearTimeout(timeout)
      serverProcess = null
      resolve()
    })

    child.kill('SIGTERM')
  })
}

export function isServerRunning(): boolean {
  return serverProcess !== null && !serverProcess.killed
}

export function healthCheck(port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      res.resume()
      resolve(res.statusCode !== undefined && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(false)
    })
  })
}

export async function tryConnectToExisting(port: number): Promise<boolean> {
  return healthCheck(port)
}

export async function restartServer(
  onLog?: (line: string) => void
): Promise<{ ok: boolean; error?: string }> {
  await stopServer()
  return startServer(onLog)
}

export function onServerExit(cb: () => void): void {
  exitCallback = cb
}

function pollUntilReady(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Server did not start within ${timeoutMs / 1000}s`))
        return
      }

      const req = http.get(`http://localhost:${port}`, (res) => {
        if (res.statusCode && res.statusCode < 500) {
          resolve()
        } else {
          setTimeout(check, 500)
        }
      })

      req.on('error', () => {
        setTimeout(check, 500)
      })

      req.setTimeout(2000, () => {
        req.destroy()
        setTimeout(check, 500)
      })
    }

    check()
  })
}
