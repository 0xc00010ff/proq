import React, { useState, useEffect, useRef } from "react";

interface InstallingProps {
  proqPath: string;
  claudePath: string;
  onComplete: () => void;
  onBack: () => void;
}

type Phase = "npm-install" | "build" | "done" | "error";

export function Installing({ proqPath, claudePath, onComplete, onBack }: InstallingProps) {
  const [phase, setPhase] = useState<Phase>("npm-install");
  const [logs, setLogs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const appendLog = (line: string) => {
    setLogs((prev) => prev + line);
    // Auto-scroll
    requestAnimationFrame(() => {
      if (logRef.current) {
        logRef.current.scrollTop = logRef.current.scrollHeight;
      }
    });
  };

  useEffect(() => {
    const cleanup = window.proqDesktop.onSetupLog((_e, line) => {
      appendLog(line);
    });

    runInstall();
    return cleanup;
  }, []);

  const runInstall = async () => {
    try {
      // Phase 1: npm install
      setPhase("npm-install");
      appendLog("$ npm install\n");
      const installResult = await window.proqDesktop.npmInstall();
      if (!installResult.ok) {
        setError(installResult.error || "npm install failed");
        setPhase("error");
        return;
      }

      // Phase 2: build (only in production mode)
      const config = await window.proqDesktop.getConfig();
      if (!config.devMode) {
        setPhase("build");
        appendLog("\n$ npm run build\n");
        const buildResult = await window.proqDesktop.buildProq();
        if (!buildResult.ok) {
          setError(buildResult.error || "Build failed");
          setPhase("error");
          return;
        }
      }

      // Persist Claude path if found
      if (claudePath) {
        await window.proqDesktop.persistClaude(claudePath);
      }

      // Mark setup complete
      await window.proqDesktop.setConfig({ setupComplete: true });
      setPhase("done");
      appendLog("\nSetup complete!\n");
    } catch (e: any) {
      setError(e.message);
      setPhase("error");
    }
  };

  const handleRetry = () => {
    setLogs("");
    setError(null);
    runInstall();
  };

  const progressPercent =
    phase === "npm-install" ? 33 : phase === "build" ? 66 : phase === "done" ? 100 : 0;

  const statusText =
    phase === "npm-install"
      ? "Installing dependencies..."
      : phase === "build"
        ? "Building for production..."
        : phase === "done"
          ? "Ready!"
          : "Error";

  return (
    <>
      <div className="wizard-content">
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
          {phase === "done" ? "All Set!" : phase === "error" ? "Something went wrong" : "Installing"}
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 16 }}>
          {statusText}
        </p>

        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>

        <div className="log-viewer" ref={logRef}>
          {logs || "Preparing..."}
        </div>

        {error && (
          <p style={{ color: "var(--error)", fontSize: 13, marginTop: 12 }}>{error}</p>
        )}
      </div>

      <div className="wizard-footer">
        {phase === "error" ? (
          <>
            <button className="btn-ghost" onClick={onBack}>Back</button>
            <button className="btn-primary" onClick={handleRetry}>
              Retry
            </button>
          </>
        ) : phase === "done" ? (
          <>
            <div />
            <button className="btn-primary" onClick={onComplete} style={{ minWidth: 160 }}>
              Launch proq
            </button>
          </>
        ) : (
          <>
            <div />
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="spinner" style={{ width: 18, height: 18 }} />
              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>This may take a minute</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}
