import React, { useState, useEffect } from "react";

interface LocationProps {
  proqPath: string;
  setProqPath: (path: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Location({ proqPath, setProqPath, onNext, onBack }: LocationProps) {
  const [mode, setMode] = useState<"clone" | "existing">("clone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!proqPath) {
      window.proqDesktop.getConfig().then((config) => {
        setProqPath(config.proqPath);
      });
    }
  }, []);

  const handleBrowse = async () => {
    const dir = await window.proqDesktop.selectDirectory();
    if (dir) {
      if (mode === "existing") {
        setProqPath(dir);
      } else {
        setProqPath(dir + "/proq");
      }
    }
  };

  const handleNext = async () => {
    setLoading(true);
    setError(null);

    try {
      if (mode === "existing") {
        const valid = await window.proqDesktop.validateInstall(proqPath);
        if (!valid) {
          setError("Not a valid proq installation. Make sure the directory contains proq's package.json.");
          setLoading(false);
          return;
        }
      } else {
        const result = await window.proqDesktop.cloneRepo(proqPath);
        if (!result.ok) {
          setError(result.error || "Failed to clone repository");
          setLoading(false);
          return;
        }
      }

      await window.proqDesktop.setConfig({ proqPath });
      onNext();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="wizard-content">
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Install Location</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 24 }}>
          Choose where to install proq, or point to an existing clone.
        </p>

        <div className="radio-group" style={{ marginBottom: 24 }}>
          <div
            className={`radio-option ${mode === "clone" ? "selected" : ""}`}
            onClick={() => setMode("clone")}
          >
            <div className="label">Fresh Install</div>
            <div className="desc">Clone from GitHub</div>
          </div>
          <div
            className={`radio-option ${mode === "existing" ? "selected" : ""}`}
            onClick={() => setMode("existing")}
          >
            <div className="label">Existing Clone</div>
            <div className="desc">I already have proq</div>
          </div>
        </div>

        <div className="field">
          <label className="field-label">
            {mode === "clone" ? "Install directory" : "proq directory"}
          </label>
          <div className="field-row">
            <input
              type="text"
              value={proqPath}
              onChange={(e) => setProqPath(e.target.value)}
              placeholder={mode === "clone" ? "~/proq" : "/path/to/proq"}
            />
            <button className="btn-secondary titlebar-no-drag" onClick={handleBrowse}>
              Browse
            </button>
          </div>
          {mode === "clone" && (
            <div className="field-hint">
              proq will be cloned into this directory
            </div>
          )}
        </div>

        {error && (
          <p style={{ color: "var(--error)", fontSize: 13, marginTop: 8 }}>{error}</p>
        )}
      </div>

      <div className="wizard-footer">
        <button className="btn-ghost" onClick={onBack}>Back</button>
        <button className="btn-primary" onClick={handleNext} disabled={loading || !proqPath}>
          {loading ? "Working..." : "Next"}
        </button>
      </div>
    </>
  );
}
