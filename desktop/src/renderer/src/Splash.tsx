import { useEffect, useState, useRef } from 'react'
import logoAnimationRepeat from './assets/LogoAnimationRepeat.svg'

function friendlyStatus(line: string): string | null {
  const t = line.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim()
  if (!t) return null
  if (t.includes('next dev') || t.includes('next start')) return 'Starting server...'
  if (t.includes('Compiling') || t.includes('compiling') || t.includes('Loading')) return 'Loading modules...'
  if (t.includes('WS server')) return 'Attaching socket...'
  if (t.includes('Ready in') || t.includes('ready started')) return 'Almost there...'
  if (t.includes('Listening') || t.includes('started server')) return 'Almost there...'
  if (t.includes('Pulling') || t.includes('git pull')) return 'Pulling updates...'
  if (t.includes('Installing dependencies') || t.includes('npm install')) return 'Installing dependencies...'
  if (t.includes('Building') || t.includes('npm run build')) return 'Building...'
  return null
}

export function Splash(): React.JSX.Element {
  const [status, setStatus] = useState('Initializing...')
  const [fading, setFading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      setError(err)
    })

    return (): void => {
      cleanupLog()
      cleanupError()
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
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
