import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { getConfig, setConfig } from './config'

const execFileAsync = promisify(execFile)

export interface UpdateCheckResult {
  available: boolean
  commits: string[]
  error?: string
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const { proqPath } = getConfig()

  try {
    await execFileAsync('git', ['fetch', 'origin', 'main'], { cwd: proqPath })
    const { stdout } = await execFileAsync(
      'git',
      ['log', 'HEAD..origin/main', '--oneline'],
      { cwd: proqPath }
    )

    const commits = stdout
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)

    return { available: commits.length > 0, commits }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return { available: false, commits: [], error: message }
  }
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  onLog?: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stderrTail: string[] = []
    child.stdout?.on('data', (d: Buffer) => onLog?.(d.toString()))
    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString()
      onLog?.(text)
      stderrTail.push(text)
      if (stderrTail.length > 20) stderrTail.shift()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else {
        const tail = stderrTail.join('').trim().slice(-500)
        reject(new Error(`${cmd} ${args[0]} exited with code ${code}${tail ? `\n${tail}` : ''}`))
      }
    })
  })
}

export async function applyUpdate(
  onLog?: (line: string) => void
): Promise<{ ok: boolean; error?: string }> {
  const { proqPath } = getConfig()

  try {
    // Silently stash any local changes before pulling
    await run('git', ['stash', '--include-untracked'], proqPath).catch(() => {})

    onLog?.('Pulling updates...')
    await run('git', ['pull', 'origin', 'main'], proqPath, onLog)

    onLog?.('Installing dependencies...')
    await run('npm', ['install'], proqPath, onLog)

    onLog?.('Building...')
    await run('npm', ['run', 'build'], proqPath, onLog)

    setConfig({ lastUpdated: new Date().toISOString() })
    return { ok: true }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: message }
  }
}
