import { useEffect, useState, useRef } from 'react'
import logoAnimationRepeat from './assets/LogoAnimationRepeat.svg'

interface StartupError {
  message: string
  phase: 'build' | 'server'
  logPath?: string
}

function friendlyStatus(line: string): string | null {
  const t = line.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim()
  if (!t) return null
  if (t.includes('next dev') || t.includes('next start')) return 'Starting server...'
  if (t.includes('Compiling') || t.includes('compiling') || t.includes('Loading')) return 'Loading modules...'
  if (t.includes('WS server')) return 'Attaching socket...'
  if (t.includes('Ready in') || t.includes('ready started')) return 'System test...'
  if (t.includes('Listening') || t.includes('started server')) return 'System test...'
  if (t.includes('Pulling') || t.includes('git pull')) return 'Pulling updates...'
  if (t.includes('Installing dependencies') || t.includes('npm install')) return 'Installing dependencies...'
  if (t.includes('Building') || t.includes('Rebuilding') || t.includes('npm run build')) return 'Building...'
  return null
}

export function Splash(): React.JSX.Element {
  const [status, setStatus] = useState('Initializing...')
  const [fading, setFading] = useState(false)
  const [error, setError] = useState<StartupError | null>(null)
  const [retrying, setRetrying] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const cleanupLog = window.proqDesktop.onServerLog((_e, line) => {
      const friendly = friendlyStatus(line)
      if (friendly && friendly !== status) {
        setFading(true)
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => {
          setStatus(friendly)
          setFading(false)
        }, 200)
      }
    })

    const cleanupError = window.proqDesktop.onServerError((_e, err) => {
      setRetrying(false)
      try {
        setError(JSON.parse(err))
      } catch {
        setError({ message: err, phase: 'server' })
      }
    })

    return (): void => {
      cleanupLog()
      cleanupError()
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const handleRetry = (): void => {
    setError(null)
    setRetrying(true)
    if (error?.phase === 'build') {
      setStatus('Rebuilding...')
      window.proqDesktop.rebuildAndStart()
    } else {
      setStatus('Restarting...')
      window.proqDesktop.startServer()
    }
  }

  return (
    <div className="splash-container titlebar-drag">
      <img
        className="splash-logo"
        src={logoAnimationRepeat}
        alt="proq"
      />

      {error ? (
        <>
          <p style={{ color: 'var(--error)', fontSize: 13, marginBottom: 8, textAlign: 'center', padding: '0 24px', lineHeight: 1.5 }}>
            {error.message}
          </p>
          {error.logPath && (
            <button
              className="titlebar-no-drag"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: 11,
                cursor: 'pointer',
                marginBottom: 16,
                textDecoration: 'underline',
                opacity: 0.7,
              }}
              onClick={(): void => {
                window.proqDesktop.openLogFile(error.logPath!)
              }}
            >
              View full log
            </button>
          )}
          <button
            className="btn-primary titlebar-no-drag"
            onClick={handleRetry}
          >
            Retry
          </button>
        </>
      ) : (
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: 13,
            opacity: fading ? 0 : 1,
            transform: fading ? 'translateY(4px)' : 'translateY(0)',
            transition: 'opacity 0.2s ease, transform 0.2s ease'
          }}
        >
          {status}
        </p>
      )}
    </div>
  )
}
