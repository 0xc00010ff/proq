import { useState, useEffect } from 'react'

interface PreferencesProps {
  onNext: () => void
  onBack: () => void
}

export function Preferences({ onNext, onBack }: PreferencesProps): React.JSX.Element {
  const [port, setPort] = useState(1337)
  const [devMode, setDevMode] = useState(false)

  useEffect(() => {
    window.proqDesktop.getConfig().then((config) => {
      setPort(config.port)
      setDevMode(config.devMode)
    })
  }, [])

  const handleNext = async (): Promise<void> => {
    await window.proqDesktop.setConfig({ port, devMode })
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
          <label className="field-label">Port</label>
          <input
            type="number"
            value={port}
            onChange={(e): void => setPort(parseInt(e.target.value, 10) || 1337)}
            min={1024}
            max={65535}
          />
          <div className="field-hint">The port proq's server listens on (default 1337)</div>
        </div>

        <div className="field">
          <label className="field-label">Run Mode</label>
          <div className="radio-group">
            <div
              className={`radio-option ${!devMode ? 'selected' : ''}`}
              onClick={(): void => setDevMode(false)}
            >
              <div className="label">Production</div>
              <div className="desc">Pre-built, faster startup</div>
            </div>
            <div
              className={`radio-option ${devMode ? 'selected' : ''}`}
              onClick={(): void => setDevMode(true)}
            >
              <div className="label">Development</div>
              <div className="desc">Hot reload, for hacking on proq</div>
            </div>
          </div>
          <div className="field-hint" style={{ marginTop: 8 }}>
            {devMode
              ? 'Uses npm run dev — changes to proq source reload instantly'
              : 'Uses npm run start — requires npm run build after updates'}
          </div>
        </div>
      </div>

      <div className="wizard-footer">
        <button className="btn-ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn-primary" onClick={handleNext}>
          Finish Setup
        </button>
      </div>
    </>
  )
}
