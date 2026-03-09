import { useState, useEffect } from 'react'

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
  node: CheckResult | null
  tmux: CheckResult | null
  claude: CheckResult | null
  xcode: CheckResult | null
}

export function Dependencies({
  claudePath,
  setClaudePath,
  onNext,
  onBack
}: DependenciesProps): React.JSX.Element {
  const [deps, setDeps] = useState<DepState>({
    node: null,
    tmux: null,
    claude: null,
    xcode: null
  })
  const [installingTmux, setInstallingTmux] = useState(false)

  useEffect(() => {
    runChecks()
  }, [])

  const runChecks = async (): Promise<void> => {
    const [node, tmux, claude, xcode] = await Promise.all([
      window.proqDesktop.checkNode(),
      window.proqDesktop.checkTmux(),
      window.proqDesktop.checkClaude(),
      window.proqDesktop.checkXcode()
    ])

    setDeps({ node, tmux, claude, xcode })
    if (claude.ok && claude.path) {
      setClaudePath(claude.path)
    }
  }

  const handleInstallTmux = async (): Promise<void> => {
    setInstallingTmux(true)
    const result = await window.proqDesktop.installTmux()
    setDeps((prev) => ({ ...prev, tmux: result }))
    setInstallingTmux(false)
  }

  const isMac = navigator.platform.toLowerCase().includes('mac')
  const canProceed = deps.node?.ok && deps.tmux?.ok

  return (
    <>
      <div className="wizard-content">
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Dependencies</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
          Checking required tools are installed.
        </p>

        <div className="check-item">
          <div
            className={`check-icon ${deps.node === null ? 'loading' : deps.node.ok ? 'success' : 'error'}`}
          >
            {deps.node === null ? '...' : deps.node.ok ? '\u2713' : '\u2717'}
          </div>
          <div className="check-label">
            Node.js {deps.node?.version ? `v${deps.node.version}` : ''}
            {deps.node && !deps.node.ok && (
              <div className="check-detail">{deps.node.error}</div>
            )}
          </div>
        </div>

        <div className="check-item">
          <div
            className={`check-icon ${deps.tmux === null ? 'loading' : deps.tmux.ok ? 'success' : 'error'}`}
          >
            {deps.tmux === null ? '...' : deps.tmux.ok ? '\u2713' : '\u2717'}
          </div>
          <div className="check-label">
            tmux {deps.tmux?.version || ''}
            {deps.tmux && !deps.tmux.ok && (
              <div className="check-detail">{deps.tmux.error}</div>
            )}
          </div>
          {deps.tmux && !deps.tmux.ok && (
            <div className="check-action">
              <button
                className="btn-secondary"
                onClick={handleInstallTmux}
                disabled={installingTmux}
                style={{ padding: '6px 14px', fontSize: 12 }}
              >
                {installingTmux ? 'Installing...' : 'Install'}
              </button>
            </div>
          )}
        </div>

        {isMac && (
          <div className="check-item">
            <div
              className={`check-icon ${deps.xcode === null ? 'loading' : deps.xcode.ok ? 'success' : 'error'}`}
            >
              {deps.xcode === null ? '...' : deps.xcode.ok ? '\u2713' : '\u2717'}
            </div>
            <div className="check-label">
              Xcode Command Line Tools
              {deps.xcode && !deps.xcode.ok && (
                <div className="check-detail">Run: xcode-select --install</div>
              )}
            </div>
          </div>
        )}

        <div className="check-item">
          <div
            className={`check-icon ${deps.claude === null ? 'loading' : deps.claude.ok ? 'success' : 'error'}`}
          >
            {deps.claude === null ? '...' : deps.claude.ok ? '\u2713' : '\u2717'}
          </div>
          <div className="check-label">
            Claude Code CLI
            {deps.claude?.ok && deps.claude.path && (
              <div className="check-detail">{deps.claude.path}</div>
            )}
            {deps.claude && !deps.claude.ok && (
              <div className="check-detail">
                Optional — install with: npm i -g @anthropic-ai/claude-code
              </div>
            )}
          </div>
        </div>

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
      </div>

      <div className="wizard-footer">
        <button className="btn-ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn-accent" onClick={onNext} disabled={!canProceed}>
          {canProceed ? 'Next' : 'Waiting...'}
        </button>
      </div>
    </>
  )
}
