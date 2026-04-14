import { ChildProcess, spawn, execSync } from 'child_process'
import fs from 'fs'
import http from 'http'
import { getConfig, isDevMode } from './config'

const SERVER_LOG = '/tmp/proq-server.log'
const SERVER_LOG_DEV = '/tmp/proq-server-dev.log'

export function getServerLogPath(): string {
  return isDevMode() ? SERVER_LOG_DEV : SERVER_LOG
}

let serverProcess: ChildProcess | null = null
let intentionalStop = false
let exitCallback: (() => void) | null = null

export function killProcessOnPort(port: number): void {
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

  // Truncate log file on each start
  const logPath = isDevMode() ? SERVER_LOG_DEV : SERVER_LOG
  const logStream = fs.createWriteStream(logPath, { flags: 'w' })

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
    const stderrTail: string[] = []

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
      logStream.write(text)
      onLog?.(text)
      detectPortError(text)
    })

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      logStream.write(text)
      onLog?.(text)
      detectPortError(text)
      stderrTail.push(text)
      if (stderrTail.length > 20) stderrTail.shift()
    })

    child.on('error', (err) => {
      serverProcess = null
      resolve({ ok: false, error: err.message })
    })

    child.on('close', (code) => {
      logStream.end()
      serverProcess = null
      if (earlyError) {
        resolve({ ok: false, error: earlyError })
      } else if (code !== null && code !== 0) {
        const tail = stderrTail.join('').trim().slice(-500)
        resolve({ ok: false, error: tail || `Server exited with code ${code}` })
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
    let resolved = false
    const done = (): void => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      serverProcess = null
      resolve()
    }

    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      // If SIGKILL doesn't trigger close (e.g. grandchild holds pipes open),
      // resolve after a short grace period so callers aren't stuck forever.
      setTimeout(done, 500)
    }, 5000)

    // Use 'exit' instead of 'close' — 'close' waits for stdio streams to end,
    // which can hang if a grandchild process (e.g. `next start` spawned by npm)
    // inherits the pipes and stays alive after npm is killed.
    child.on('exit', done)

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
