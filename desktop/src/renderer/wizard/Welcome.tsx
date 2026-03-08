import React from "react";

interface WelcomeProps {
  onNext: () => void;
}

export function Welcome({ onNext }: WelcomeProps) {
  return (
    <>
      <div className="wizard-content" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <svg
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: 80, height: 80, marginBottom: 28 }}
        >
          <rect width="100" height="100" rx="20" fill="#18181b" />
          <text
            x="50"
            y="62"
            textAnchor="middle"
            fill="#60a5fa"
            fontSize="36"
            fontWeight="700"
            fontFamily="-apple-system, sans-serif"
          >
            pq
          </text>
        </svg>

        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Welcome to proq</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 15, textAlign: "center", maxWidth: 380, lineHeight: 1.6 }}>
          The command center for AI-assisted development. Create tasks, let agents code autonomously, review and approve.
        </p>
      </div>

      <div className="wizard-footer" style={{ justifyContent: "center", borderTop: "none" }}>
        <button className="btn-primary" onClick={onNext} style={{ minWidth: 160 }}>
          Get Started
        </button>
      </div>
    </>
  );
}
