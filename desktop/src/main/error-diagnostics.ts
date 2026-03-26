const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g

function strip(s: string): string {
  return s.replace(ANSI_RE, '')
}

/**
 * Parse raw stderr from a failed build or server process into a short,
 * human-readable summary suitable for the splash screen.
 */
export function parseErrorSummary(raw: string, phase: 'build' | 'server'): string {
  const text = strip(raw)

  // TypeScript type error (Next.js build)
  const typeErr = text.match(/Type error:\s*(.+)/)
  if (typeErr) {
    const fileMatch = text.match(/\.\/([^\s:]+):(\d+)/)
    const loc = fileMatch ? ` in ${fileMatch[1]}:${fileMatch[2]}` : ''
    return `Build failed: ${typeErr[1].slice(0, 80)}${loc}`
  }

  // Module not found
  const modErr = text.match(/Module not found.*?['"]([^'"]+)['"]/)
  if (modErr) return `Build failed: module not found '${modErr[1]}'`

  // No production build (.next missing)
  if (text.includes('Could not find a production build')) {
    return 'No production build found. The app needs to be rebuilt.'
  }

  // Syntax error
  const syntaxErr = text.match(/SyntaxError:\s*(.+)/)
  if (syntaxErr) return `Build failed: ${syntaxErr[1].slice(0, 100)}`

  // npm error
  const npmErr = text.match(/npm ERR!\s*(.+)/)
  if (npmErr) return `npm error: ${npmErr[1].slice(0, 100)}`

  // Fallback: last non-empty line
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (lines.length > 0) {
    const last = lines[lines.length - 1].trim().slice(0, 120)
    const prefix = phase === 'build' ? 'Build failed' : 'Server error'
    return `${prefix}: ${last}`
  }

  return phase === 'build' ? 'Build failed (unknown error)' : 'Server failed to start'
}
