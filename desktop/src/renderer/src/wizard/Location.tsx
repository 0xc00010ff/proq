import { useState, useEffect, useRef } from 'react'

interface LocationProps {
  proqPath: string
  setProqPath: (path: string) => void
  onNext: () => void
  onBack: () => void
}

export function Location({ proqPath, setProqPath, onNext, onBack }: LocationProps): React.JSX.Element {
  const [installDir, setInstallDir] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingInstall, setExistingInstall] = useState<boolean | null>(null)
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fullProqPath = installDir ? installDir.replace(/\/+$/, '') + '/proq' : ''

  useEffect(() => {
    if (!installDir) {
      window.proqDesktop.getConfig().then((config) => {
        // Strip /proq from the end to get the parent directory
        const dir = config.proqPath.replace(/\/proq\/?$/, '') || config.proqPath
        setInstallDir(dir)
      })
    }
  }, [])

  // Auto-detect existing install when path changes
  useEffect(() => {
    if (!fullProqPath) {
      setExistingInstall(null)
      return
    }

    if (checkTimer.current) clearTimeout(checkTimer.current)
    checkTimer.current = setTimeout(async () => {
      try {
        const valid = await window.proqDesktop.validateInstall(fullProqPath)
        setExistingInstall(valid)
      } catch {
        setExistingInstall(false)
      }
    }, 300)

    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current)
    }
  }, [fullProqPath])

  const handleBrowse = async (): Promise<void> => {
    const dir = await window.proqDesktop.selectDirectory()
    if (!dir) return

    // If they selected a proq directory itself, use its parent
    if (dir.replace(/\/+$/, '').endsWith('/proq') || dir.replace(/\/+$/, '') === 'proq') {
      const parent = dir.replace(/\/+$/, '').replace(/\/proq$/, '')
      setInstallDir(parent || '/')
    } else {
      setInstallDir(dir)
    }
  }

  const handleNext = async (action: 'use-existing' | 'clone' | 'overwrite'): Promise<void> => {
    setLoading(true)
    setError(null)

    try {
      if (action === 'use-existing') {
        const valid = await window.proqDesktop.validateInstall(fullProqPath)
        if (!valid) {
          setError("Not a valid proq installation. Make sure the directory contains proq's package.json.")
          setLoading(false)
          return
        }
      } else {
        const result = await window.proqDesktop.cloneRepo(fullProqPath, action === 'overwrite')
        if (!result.ok) {
          setError(result.error || 'Failed to clone repository')
          setLoading(false)
          return
        }
      }

      setProqPath(fullProqPath)
      await window.proqDesktop.setConfig({ proqPath: fullProqPath })
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
              value={installDir}
              onChange={(e): void => setInstallDir(e.target.value)}
              placeholder="/Users/you"
            />
            <button className="btn-primary titlebar-no-drag" onClick={handleBrowse}>
              Browse
            </button>
          </div>
          <div className="field-hint">
            {existingInstall
              ? `proq found at ${fullProqPath}`
              : `proq will be cloned to ${fullProqPath || '...'}`}
          </div>
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
          <button className="btn-accent" onClick={() => handleNext('clone')} disabled={loading || !installDir}>
            {loading ? 'Cloning...' : 'Next'}
          </button>
        )}
      </div>
    </>
  )
}
