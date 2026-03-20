import { useState, useEffect, useCallback } from 'react'

interface CheckResult {
  ok: boolean
  version?: string
  path?: string
  error?: string
}

interface DependenciesProps {
  claudePath: string
  setClaudePath: (path: string) => void
  onNext: () => void
  onBack: () => void
}

interface DepState {
  xcode: CheckResult | null
  node: CheckResult | null
  claude: CheckResult | null
}

type DepKey = keyof DepState

type InstallingState = Partial<Record<DepKey, boolean>>

// Dependencies that open external dialogs — user must re-check manually
const INTERACTIVE_DEPS = new Set<DepKey>(['xcode'])

export function Dependencies({
  claudePath,
  setClaudePath,
  onNext,
  onBack
}: DependenciesProps): React.JSX.Element {
  const [deps, setDeps] = useState<DepState>({
    xcode: null,
    node: null,
    claude: null
  })
  const [installing, setInstalling] = useState<InstallingState>({})
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState(false)

  const isMac = navigator.platform.toLowerCase().includes('mac')

  const runChecks = useCallback(async (isRecheck = false): Promise<DepState> => {
    if (isRecheck) setRechecking(true)
    const [results] = await Promise.all([
      Promise.all([
        window.proqDesktop.checkNode(),
        window.proqDesktop.checkClaude(),
        window.proqDesktop.checkXcode()
      ]),
      // Minimum visible duration for rechecks
      isRecheck ? new Promise((r) => setTimeout(r, 500)) : Promise.resolve()
    ])
    const [node, claude, xcode] = results
    const state: DepState = { xcode, node, claude }
    setDeps(state)
    if (claude.ok && claude.path) {
      setClaudePath(claude.path)
    }
    setPendingMessage(null)
    setRechecking(false)
    return state
  }, [setClaudePath])

  useEffect(() => {
    runChecks()
  }, [runChecks])

  const setDep = (key: DepKey, result: CheckResult): void => {
    setDeps((prev) => ({ ...prev, [key]: result }))
  }

  const setIsInstalling = (key: DepKey, value: boolean): void => {
    setInstalling((prev) => ({ ...prev, [key]: value }))
  }

  // Individual install handlers
  const handleInstallXcode = async (): Promise<void> => {
    setIsInstalling('xcode', true)
    await window.proqDesktop.installXcode()
    setIsInstalling('xcode', false)
    setPendingMessage('Complete the Xcode dialog, then click Re-check All')
  }

  const handleInstallClaude = async (): Promise<void> => {
    setIsInstalling('claude', true)
    const result = await window.proqDesktop.installClaude()
    setDep('claude', result)
    if (result.ok && result.path) setClaudePath(result.path)
    setIsInstalling('claude', false)
  }

  const canProceed = deps.node?.ok
  const allChecked = deps.node !== null && deps.claude !== null && deps.xcode !== null
  const anyMissing =
    allChecked &&
    (!deps.node?.ok || (isMac && !deps.xcode?.ok) || !deps.claude?.ok)
  const anyInstalling = Object.values(installing).some(Boolean)

  // Dependency row renderer
  const depRow = (
    key: DepKey,
    label: string,
    result: CheckResult | null,
    onInstall?: () => Promise<void>,
    detail?: string
  ): React.JSX.Element => {
    const detailText = result === null
      ? 'Checking...'
      : result.ok
        ? (result.path || '')
        : (result.error !== 'pending' ? (detail || result.error || '') : '')

    const showSpinner = result === null || rechecking

    return (
      <div className="check-item" key={key} style={{ minHeight: 56 }}>
        <div
          className={`check-icon ${showSpinner ? 'loading' : result.ok ? 'success' : 'error'}`}
        >
          {showSpinner
            ? <div style={{
                width: 14, height: 14,
                border: '2px solid var(--border)',
                borderTopColor: 'var(--text-muted)',
                borderRadius: '50%',
                animation: 'spin 1.5s linear infinite'
              }} />
            : result.ok ? '\u2713' : '\u2717'
          }
        </div>
        <div className="check-label">
          {label} {result?.version ? `v${result.version}` : ''}
          {detailText && <div className="check-detail">{detailText}</div>}
        </div>
        {result && !result.ok && onInstall && (
          <div className="check-action">
            <button
              className="btn-secondary"
              onClick={onInstall}
              disabled={installing[key]}
              style={{ padding: '6px 14px', fontSize: 12 }}
            >
              {installing[key] ? 'Installing...' : 'Install'}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="wizard-content">
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Dependencies</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
          Checking required tools are installed.
        </p>

        {isMac &&
          depRow('xcode', 'Xcode Command Line Tools (git)', deps.xcode, handleInstallXcode)}

        {depRow('node', 'Node.js', deps.node, undefined,
          deps.node?.error
        )}

        {depRow('claude', 'Claude Code CLI', deps.claude, handleInstallClaude,
          deps.claude && !deps.claude.ok && !deps.node?.ok
            ? 'Install Node.js first'
            : 'Optional — needed for agent dispatch'
        )}

        {deps.claude && !deps.claude.ok && (
          <div className="field" style={{ marginTop: 16 }}>
            <label className="field-label">Or specify Claude CLI path manually</label>
            <input
              type="text"
              value={claudePath}
              onChange={(e): void => setClaudePath(e.target.value)}
              placeholder="/path/to/claude"
            />
          </div>
        )}

        {pendingMessage && (
          <div
            style={{
              marginTop: 16,
              padding: '10px 14px',
              background: 'var(--bg-secondary, #1a1a2e)',
              borderRadius: 8,
              fontSize: 13,
              color: 'var(--text-secondary, #a1a1aa)'
            }}
          >
            {pendingMessage}
          </div>
        )}

        {allChecked && (
          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <button
              className="btn-secondary"
              onClick={() => runChecks(true)}
              disabled={anyInstalling || rechecking}
              style={{ padding: '6px 14px', fontSize: 12 }}
            >
              {rechecking ? 'Checking...' : 'Re-check All'}
            </button>
          </div>
        )}
      </div>

      <div className="wizard-footer">
        <button className="btn-ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn-accent" onClick={onNext} disabled={!canProceed}>
          {canProceed ? 'Next' : 'Installing...'}
        </button>
      </div>
    </>
  )
}
