/**
 * macOS GUI apps don't inherit the user's shell PATH.
 * Spawn the user's login shell once to get their real PATH,
 * same approach as VS Code and fix-path.
 */

import { execFileSync } from 'child_process'

export function ensurePath(): void {
  if (process.platform === 'win32') return

  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const path = execFileSync(shell, ['-ilc', 'echo -n "$PATH"'], {
      timeout: 5000,
      encoding: 'utf-8',
      env: { ...process.env, TERM: 'dumb' } // suppress prompt theming noise
    }).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim() // strip any ANSI escapes

    if (path) {
      process.env.PATH = path
    }
  } catch {
    // Shell timed out or failed — keep existing PATH as-is
  }
}
