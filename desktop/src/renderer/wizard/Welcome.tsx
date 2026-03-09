import React from "react";

interface WelcomeProps {
  onNext: () => void;
}

export function Welcome({ onNext }: WelcomeProps) {
  return (
    <>
      <div className="wizard-content" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <svg
          viewBox="0 0 256 256"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: 80, height: 80, marginBottom: 28 }}
        >
          <path
            d="M36.3813 253V16H219.618V173.41H89.6223V69.6509H165.507V121.235H128.533"
            stroke="#E4BD89"
            strokeWidth="27"
          />
        </svg>

        <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 16, fontFamily: "var(--font-display)", textTransform: "lowercase" }}>
          proq
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 15, textAlign: "center", maxWidth: 380, lineHeight: 1.6 }}>
          proq is a vibe coding IDE built for precision.
          Your job is to define what you want. proq orchestrates coding agents to make it real. And good.
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
