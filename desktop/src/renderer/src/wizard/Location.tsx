import { useState, useEffect } from 'react'

interface LocationProps {
  proqPath: string
  setProqPath: (path: string) => void
  onNext: () => void
  onBack: () => void
}

export function Location({ proqPath, setProqPath, onNext, onBack }: LocationProps): React.JSX.Element {
  const [mode, setMode] = useState<'clone' | 'existing'>('clone')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!proqPath) {
      window.proqDesktop.getConfig().then((config) => {
        setProqPath(config.proqPath)
      })
    }
  }, [])

  const handleBrowse = async (): Promise<void> => {
    const dir = await window.proqDesktop.selectDirectory()
    if (dir) {
      if (mode === 'existing') {
        setProqPath(dir)
      } else {
        setProqPath(dir + '/proq')
      }
    }
  }

  const handleNext = async (): Promise<void> => {
    setLoading(true)
    setError(null)

    try {
      if (mode === 'existing') {
        const valid = await window.proqDesktop.validateInstall(proqPath)
        if (!valid) {
          setError(
            "Not a valid proq installation. Make sure the directory contains proq's package.json."
          )
          setLoading(false)
          return
        }
      } else {
        const result = await window.proqDesktop.cloneRepo(proqPath)
        if (!result.ok) {
          setError(result.error || 'Failed to clone repository')
          setLoading(false)
          return
        }
      }

      await window.proqDesktop.setConfig({ proqPath })
      onNext()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="wizard-content">
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Install Location</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
          Choose where to install proq.
        </p>

        {mode === 'clone' ? (
          <>
            <div className="field">
              <label className="field-label">Install directory</label>
              <div className="field-row">
                <input
                  type="text"
                  value={proqPath}
                  onChange={(e): void => setProqPath(e.target.value)}
                  placeholder="~/proq"
                />
                <button className="btn-primary titlebar-no-drag" onClick={handleBrowse}>
                  Browse
                </button>
              </div>
              <div className="field-hint">proq will be cloned into this directory</div>
            </div>

            {error && (
              <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 8 }}>{error}</p>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                margin: '28px 0 16px'
              }}
            >
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            <button
              className="btn-secondary"
              onClick={(): void => {
                setMode('existing')
                setError(null)
              }}
              style={{ padding: '6px 0' }}
            >
              I already have proq installed &rarr;
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label className="field-label">proq directory</label>
              <div className="field-row">
                <input
                  type="text"
                  value={proqPath}
                  onChange={(e): void => setProqPath(e.target.value)}
                  placeholder="/path/to/proq"
                />
                <button className="btn-primary titlebar-no-drag" onClick={handleBrowse}>
                  Browse
                </button>
              </div>
              <div className="field-hint">Point to your existing proq clone</div>
            </div>

            {error && (
              <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 8 }}>{error}</p>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                margin: '28px 0 16px'
              }}
            >
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            <button
              className="btn-secondary"
              onClick={(): void => {
                setMode('clone')
                setError(null)
              }}
              style={{ padding: '6px 0' }}
            >
              &larr; Back to fresh install
            </button>
          </>
        )}
      </div>

      <div className="wizard-footer">
        <button className="btn-ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn-accent" onClick={handleNext} disabled={loading || !proqPath}>
          {loading ? 'Working...' : 'Next'}
        </button>
      </div>
    </>
  )
}
