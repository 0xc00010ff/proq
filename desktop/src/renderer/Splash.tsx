import React, { useEffect, useState } from "react";

export function Splash() {
  const [status, setStatus] = useState("Starting server...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cleanupLog = window.proqDesktop.onServerLog((_e, line) => {
      // Show last meaningful line
      const trimmed = line.trim();
      if (trimmed) setStatus(trimmed.slice(0, 60));
    });

    const cleanupError = window.proqDesktop.onServerError((_e, err) => {
      setError(err);
    });

    window.proqDesktop.startServer().then((result) => {
      if (!result.ok) {
        setError(result.error || "Failed to start server");
      }
      // On success, main process replaces this window with the app
    });

    return () => {
      cleanupLog();
      cleanupError();
    };
  }, []);

  return (
    <div className="splash-container titlebar-drag">
      <svg
        className="splash-logo"
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
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

      {error ? (
        <>
          <p style={{ color: "var(--error)", fontSize: 14, marginBottom: 16 }}>{error}</p>
          <button
            className="btn-primary"
            onClick={() => {
              setError(null);
              setStatus("Restarting...");
              window.proqDesktop.startServer();
            }}
          >
            Retry
          </button>
        </>
      ) : (
        <>
          <div className="spinner" style={{ marginBottom: 20 }} />
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{status}</p>
        </>
      )}
    </div>
  );
}
