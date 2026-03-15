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
  homebrew: CheckResult | null
  node: CheckResult | null
  tmux: CheckResult | null
  claude: CheckResult | null
}

type DepKey = keyof DepState

type InstallingState = Partial<Record<DepKey, boolean>>

// Dependencies that open external dialogs — user must re-check manually
const INTERACTIVE_DEPS = new Set<DepKey>(['xcode', 'homebrew'])

export function Dependencies({
  claudePath,
  setClaudePath,
  onNext,
  onBack
}: DependenciesProps): React.JSX.Element {
  const [deps, setDeps] = useState<DepState>({
    xcode: null,
    homebrew: null,
    node: null,
    tmux: null,
    claude: null
  })
  const [installing, setInstalling] = useState<InstallingState>({})
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [installAllActive, setInstallAllActive] = useState(false)

  const isMac = navigator.platform.toLowerCase().includes('mac')

  const runChecks = useCallback(async (): Promise<DepState> => {
    const [node, tmux, claude, xcode, homebrew] = await Promise.all([
      window.proqDesktop.checkNode(),
      window.proqDesktop.checkTmux(),
      window.proqDesktop.checkClaude(),
      window.proqDesktop.checkXcode(),
      window.proqDesktop.checkHomebrew()
    ])
    const state: DepState = { xcode, homebrew, node, tmux, claude }
    setDeps(state)
    if (claude.ok && claude.path) {
      setClaudePath(claude.path)
    }
    setPendingMessage(null)
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

  const handleInstallHomebrew = async (): Promise<void> => {
    setIsInstalling('homebrew', true)
    await window.proqDesktop.installHomebrew()
    setIsInstalling('homebrew', false)
    setPendingMessage('Complete the Homebrew install in Terminal, then click Re-check All')
  }

  const handleInstallNode = async (): Promise<void> => {
    setIsInstalling('node', true)
    const result = await window.proqDesktop.installNode()
    setDep('node', result)
    setIsInstalling('node', false)
  }

  const handleInstallTmux = async (): Promise<void> => {
    setIsInstalling('tmux', true)
    const result = await window.proqDesktop.installTmux()
    setDep('tmux', result)
    setIsInstalling('tmux', false)
  }

  const handleInstallClaude = async (): Promise<void> => {
    setIsInstalling('claude', true)
    const result = await window.proqDesktop.installClaude()
    setDep('claude', result)
    if (result.ok && result.path) setClaudePath(result.path)
    setIsInstalling('claude', false)
  }

  // Install All — chains installs in dependency order, pausing for interactive ones
  const handleInstallAll = async (): Promise<void> => {
    setInstallAllActive(true)

    // 1. Xcode CLT
    if (isMac && deps.xcode && !deps.xcode.ok) {
      await handleInstallXcode()
      // Wait for user to re-check before continuing
      setInstallAllActive(false)
      setPendingMessage(
        'Complete the Xcode install dialog, then click Re-check All to continue installing remaining dependencies'
      )
      return
    }

    // 2. Homebrew
    if (deps.homebrew && !deps.homebrew.ok) {
      await handleInstallHomebrew()
      setInstallAllActive(false)
      setPendingMessage(
        'Complete the Homebrew install in Terminal, then click Re-check All to continue installing remaining dependencies'
      )
      return
    }

    // 3. Node.js (needs Homebrew)
    if (deps.node && !deps.node.ok && deps.homebrew?.ok) {
      await handleInstallNode()
    }

    // 4. tmux (needs Homebrew)
    if (deps.tmux && !deps.tmux.ok && deps.homebrew?.ok) {
      await handleInstallTmux()
    }

    // 5. Claude CLI (needs Node/npm)
    const currentNode = deps.node
    if (deps.claude && !deps.claude.ok && currentNode?.ok) {
      await handleInstallClaude()
    }

    setInstallAllActive(false)
  }

  const canProceed = deps.node?.ok && deps.tmux?.ok
  const allChecked = deps.node !== null && deps.tmux !== null && deps.claude !== null && deps.xcode !== null && deps.homebrew !== null
  const anyMissing =
    allChecked &&
    (!deps.node?.ok || !deps.tmux?.ok || (isMac && !deps.xcode?.ok) || !deps.homebrew?.ok || !deps.claude?.ok)
  const anyInstalling = Object.values(installing).some(Boolean)

  // Dependency row renderer
  const depRow = (
    key: DepKey,
    label: string,
    result: CheckResult | null,
    onInstall?: () => Promise<void>,
    detail?: string
  ): React.JSX.Element => (
    <div className="check-item" key={key}>
      <div
        className={`check-icon ${result === null ? 'loading' : result.ok ? 'success' : 'error'}`}
      >
        {result === null ? '...' : result.ok ? '\u2713' : '\u2717'}
      </div>
      <div className="check-label">
        {label} {result?.version ? `v${result.version}` : ''}
        {result && !result.ok && result.error !== 'pending' && (
          <div className="check-detail">{detail || result.error}</div>
        )}
        {result?.ok && result.path && (
          <div className="check-detail">{result.path}</div>
        )}
      </div>
      {result && !result.ok && onInstall && (
        <div className="check-action">
          <button
            className="btn-secondary"
            onClick={onInstall}
            disabled={installing[key] || installAllActive}
            style={{ padding: '6px 14px', fontSize: 12 }}
          >
            {installing[key] ? 'Installing...' : 'Install'}
          </button>
        </div>
      )}
    </div>
  )

  return (
    <>
      <div className="wizard-content">
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Dependencies</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
          Checking required tools are installed.
        </p>

        {isMac &&
          depRow('xcode', 'Xcode Command Line Tools', deps.xcode, handleInstallXcode)}

        {depRow('homebrew', 'Homebrew', deps.homebrew, handleInstallHomebrew)}

        {depRow('node', 'Node.js', deps.node, handleInstallNode,
          deps.node && !deps.node.ok && !deps.homebrew?.ok
            ? 'Install Homebrew first'
            : deps.node?.error
        )}

        {depRow('tmux', 'tmux', deps.tmux, handleInstallTmux,
          deps.tmux && !deps.tmux.ok && !deps.homebrew?.ok
            ? 'Install Homebrew first'
            : deps.tmux?.error
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
              onClick={runChecks}
              disabled={anyInstalling}
              style={{ padding: '6px 14px', fontSize: 12 }}
            >
              Re-check All
            </button>
            {anyMissing && (
              <button
                className="btn-secondary"
                onClick={handleInstallAll}
                disabled={anyInstalling || installAllActive}
                style={{ padding: '6px 14px', fontSize: 12 }}
              >
                {installAllActive ? 'Installing...' : 'Install All'}
              </button>
            )}
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
