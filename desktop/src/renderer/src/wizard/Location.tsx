import { useState, useEffect, useRef } from 'react'

interface LocationProps {
  proqPath: string
  setProqPath: (path: string) => void
  onNext: () => void
  onBack: () => void
}

export function Location({ proqPath, setProqPath, onNext, onBack }: LocationProps): React.JSX.Element {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingInstall, setExistingInstall] = useState<boolean | null>(null)
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!proqPath) {
      window.proqDesktop.getConfig().then((config) => {
        setProqPath(config.proqPath)
      })
    }
  }, [])

  // Auto-detect existing install when path changes
  useEffect(() => {
    if (!proqPath) {
      setExistingInstall(null)
      return
    }

    if (checkTimer.current) clearTimeout(checkTimer.current)
    checkTimer.current = setTimeout(async () => {
      try {
        const valid = await window.proqDesktop.validateInstall(proqPath)
        setExistingInstall(valid)
      } catch {
        setExistingInstall(false)
      }
    }, 300)

    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current)
    }
  }, [proqPath])

  const handleBrowse = async (): Promise<void> => {
    const dir = await window.proqDesktop.selectDirectory()
    if (dir) setProqPath(dir)
  }

  const handleNext = async (action: 'use-existing' | 'clone' | 'overwrite'): Promise<void> => {
    setLoading(true)
    setError(null)

    try {
      if (action === 'use-existing') {
        const valid = await window.proqDesktop.validateInstall(proqPath)
        if (!valid) {
          setError("Not a valid proq installation. Make sure the directory contains proq's package.json.")
          setLoading(false)
          return
        }
      } else {
        const result = await window.proqDesktop.cloneRepo(proqPath, action === 'overwrite')
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
          {!existingInstall && (
            <div className="field-hint">proq will be cloned into this directory</div>
          )}
        </div>

        {existingInstall && (
          <div
            style={{
              marginTop: 24,
              padding: '14px 16px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'rgba(255,255,255,0.03)'
            }}
          >
            <p style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, marginBottom: 6 }}>
              proq is already installed here
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Use the existing installation or overwrite with a fresh clone.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn-accent"
                onClick={() => handleNext('use-existing')}
                disabled={loading}
                style={{ flex: 1 }}
              >
                {loading ? 'Setting up...' : 'Use existing'}
              </button>
              <button
                className="btn-overwrite"
                onClick={() => handleNext('overwrite')}
                disabled={loading}
                style={{ flex: 1 }}
              >
                {loading ? 'Cloning...' : 'Overwrite'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 12 }}>{error}</p>
        )}
      </div>

      <div className="wizard-footer">
        <button className="btn-ghost" onClick={onBack}>
          Back
        </button>
        {!existingInstall && (
          <button className="btn-accent" onClick={() => handleNext('clone')} disabled={loading || !proqPath}>
            {loading ? 'Cloning...' : 'Next'}
          </button>
        )}
      </div>
    </>
  )
}
