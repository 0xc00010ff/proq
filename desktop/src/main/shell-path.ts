/**
 * macOS GUI apps don't inherit the user's shell PATH.
 * Prepend common binary directories so spawn('npm', ...) etc. work.
 */

import fs from 'fs'

const COMMON_DIRS = [
  '/opt/homebrew/bin',       // Homebrew (Apple Silicon)
  '/usr/local/bin',          // Homebrew (Intel)
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin'
]

export function ensurePath(): void {
  const dirs = [...COMMON_DIRS]

  // Check for nvm as a fallback (after Homebrew dirs)
  const nvmDir = process.env.NVM_DIR || `${process.env.HOME}/.nvm`
  try {
    const versions = fs.readdirSync(`${nvmDir}/versions/node`)
      .filter((v) => v.startsWith('v'))
      .sort((a, b) => {
        const pa = a.replace('v', '').split('.').map(Number)
        const pb = b.replace('v', '').split('.').map(Number)
        return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2]
      })
    if (versions.length) dirs.push(`${nvmDir}/versions/node/${versions[0]}/bin`)
  } catch {
    // no nvm
  }

  const current = process.env.PATH || ''
  const currentSet = new Set(current.split(':'))
  const missing = dirs.filter((d) => !currentSet.has(d))

  if (missing.length) {
    process.env.PATH = [...missing, current].join(':')
  }
}
