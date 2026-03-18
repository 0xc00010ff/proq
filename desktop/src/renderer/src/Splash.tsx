import { useEffect, useState } from 'react'
import logoAnimationRepeat from './assets/LogoAnimationRepeat.svg'

function friendlyStatus(line: string, port: number, wsPort: number): string | null {
  // Strip ANSI escape sequences
  const t = line.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim()
  if (!t) return null
  if (t.includes('WS server')) return `WebSocket on port ${wsPort}`
  if (t.includes('Ready in') || t.includes('ready started')) return 'Ready'
  if (t.includes('Listening') || t.includes('started server')) return `Server on port ${port}`
  if (t.includes('Pulling') || t.includes('git pull')) return 'Pulling updates'
  if (t.includes('Installing dependencies') || t.includes('npm install')) return 'Installing dependencies'
  if (t.includes('Building') || t.includes('npm run build')) return 'Building'
  if (t.includes('Compiling') || t.includes('compiling')) return 'Compiling'
  if (t.includes('Loading')) return 'Loading modules'
  if (t.includes('next dev') || t.includes('next start')) return 'Starting Next.js'
  return null
}

export function Splash(): React.JSX.Element {
  const [status, setStatus] = useState('Initializing')
  const [phases, setPhases] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let port = 1337
    let wsPort = 42069

    window.proqDesktop.getConfig().then((config) => {
      port = config.port
      wsPort = config.wsPort
    })

    const cleanupLog = window.proqDesktop.onServerLog((_e, line) => {
      const friendly = friendlyStatus(line, port, wsPort)
      if (friendly) {
        setStatus(friendly)
        setPhases((prev) => prev.includes(friendly) ? prev : [...prev.slice(-3), friendly])
      }
    })

    const cleanupError = window.proqDesktop.onServerError((_e, err) => {
      setError(err)
    })

    return (): void => {
      cleanupLog()
      cleanupError()
    }
  }, [])

  return (
    <div className="splash-container titlebar-drag">
      <img
        className="splash-logo"
        src={logoAnimationRepeat}
        alt="proq"
      />

      {error ? (
        <>
          <p style={{ color: 'var(--error)', fontSize: 14, marginBottom: 16, textAlign: 'center', padding: '0 24px' }}>
            {error}
          </p>
          <button
            className="btn-primary titlebar-no-drag"
            onClick={(): void => {
              setError(null)
              setStatus('Restarting...')
              window.proqDesktop.startServer()
            }}
          >
            Retry
          </button>
        </>
      ) : (
        <div style={{ textAlign: 'center' }}>
          {phases.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {phases.slice(0, -1).map((p, i) => (
                <p key={i} style={{ color: 'var(--text-muted)', fontSize: 11, opacity: 0.4, lineHeight: 1.8 }}>
                  {p}
                </p>
              ))}
            </div>
          )}
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{status}</p>
        </div>
      )}
    </div>
  )
}
