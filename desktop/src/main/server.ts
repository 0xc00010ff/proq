import { ChildProcess, spawn } from 'child_process'
import http from 'http'
import { getConfig } from './config'

let serverProcess: ChildProcess | null = null

export function startServer(
  onLog?: (line: string) => void
): Promise<{ ok: boolean; error?: string }> {
  const config = getConfig()
  const { proqPath, port, devMode } = config
  const command = devMode ? 'dev' : 'start'

  return new Promise((resolve, reject) => {
    if (serverProcess) {
      resolve({ ok: true })
      return
    }

    const child = spawn('npm', ['run', command], {
      cwd: proqPath,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    serverProcess = child

    child.stdout?.on('data', (data: Buffer) => {
      onLog?.(data.toString())
    })

    child.stderr?.on('data', (data: Buffer) => {
      onLog?.(data.toString())
    })

    child.on('error', (err) => {
      serverProcess = null
      reject({ ok: false, error: err.message })
    })

    child.on('close', (code) => {
      serverProcess = null
      onLog?.(`Server process exited with code ${code}`)
    })

    pollUntilReady(port, 60_000)
      .then(() => resolve({ ok: true }))
      .catch((err) => resolve({ ok: false, error: err.message }))
  })
}

export function stopServer(): Promise<void> {
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
