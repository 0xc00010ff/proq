import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'

interface PreferencesProps {
  onNext: () => void
  onBack: () => void
}

export function Preferences({ onNext, onBack }: PreferencesProps): React.JSX.Element {
  const [port, setPort] = useState(7331)
  const [wsPort, setWsPort] = useState(42067)
  const [devMode, setDevMode] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    window.proqDesktop.getConfig().then((config) => {
      setPort(config.port)
      setWsPort(config.wsPort)
      setDevMode(config.devMode)
    })
  }, [])

  const handleModeChange = (dev: boolean): void => {
    setDevMode(dev)
    setPort(dev ? 1337 : 7331)
    setWsPort(dev ? 42069 : 42067)
  }

  const handleNext = async (): Promise<void> => {
    await window.proqDesktop.setConfig({ port, wsPort, devMode })
    onNext()
  }

  return (
    <>
      <div className="wizard-content">
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Preferences</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
          Configure how proq runs. You can change these later in Settings.
        </p>

        <div className="field">
          <label className="field-label">Run Mode</label>
          <div className="radio-group">
            <div
              className={`radio-option ${!devMode ? 'selected' : ''}`}
              onClick={(): void => handleModeChange(false)}
            >
              <div className="label">Production</div>
              <div className="desc">Official proq, fast and reliable</div>
            </div>
            <div
              className={`radio-option ${devMode ? 'selected' : ''}`}
              onClick={(): void => handleModeChange(true)}
            >
              <div className="label">Development</div>
              <div className="desc">Hot reload, to edit proq itself</div>
            </div>
          </div>
          <div className="field-hint" style={{ marginTop: 8 }}>
            {devMode
              ? 'Uses npm run dev — changes to proq live-reload. Live-compile will make the app slower though.'
              : 'Uses the pre-compiled proq server'}
          </div>
        </div>

        <button
          onClick={(): void => setShowAdvanced(!showAdvanced)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: 12,
            cursor: 'pointer',
            padding: '4px 0',
            marginBottom: showAdvanced ? 16 : 0,
            textAlign: 'left'
          }}
        >
          Advanced options{' '}
          {showAdvanced ? <ChevronDown size={14} style={{ verticalAlign: 'middle' }} /> : <ChevronRight size={14} style={{ verticalAlign: 'middle' }} />}
        </button>

        {showAdvanced && (
          <>
            <div className="field">
              <label className="field-label">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e): void => setPort(parseInt(e.target.value, 10) || (devMode ? 1337 : 7331))}
                min={1024}
                max={65535}
              />
              <div className="field-hint">The port proq's server listens on ({devMode ? 'default: 1337' : 'default: 7331'})</div>
            </div>

            <div className="field">
              <label className="field-label">WebSocket Port</label>
              <input
                type="number"
                value={wsPort}
                onChange={(e): void => setWsPort(parseInt(e.target.value, 10) || (devMode ? 42069 : 42067))}
                min={1024}
                max={65535}
              />
              <div className="field-hint">
                The port for agent WebSocket connections ({devMode ? 'default: 42069' : 'default: 42067'})
              </div>
            </div>
          </>
        )}
      </div>

      <div className="wizard-footer">
        <button className="btn-ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn-accent" onClick={handleNext}>
          Finish Setup
        </button>
      </div>
    </>
  )
}
