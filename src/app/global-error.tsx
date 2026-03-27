'use client';

import { Suspense } from 'react';

function ErrorContent({ reset }: { reset: () => void }) {
  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', textAlign: 'center' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 500 }}>Something went wrong</h2>
        <p style={{ fontSize: '0.875rem', opacity: 0.6, maxWidth: '28rem' }}>
          A critical error occurred.
        </p>
        <button
          onClick={reset}
          style={{
            borderRadius: '0.375rem',
            backgroundColor: '#8B6D3E',
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            color: '#fff',
            cursor: 'pointer',
            border: 'none',
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export default function GlobalError(props: { error: Error; reset: () => void }) {
  const themeScript = `
    (function() {
      try {
        var theme = JSON.parse(localStorage.getItem('proq-settings') || '{}').theme || 'system';
        if (theme === 'system') theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        document.documentElement.className = theme;
      } catch(e) { document.documentElement.className = 'dark'; }
    })();
  `;

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <style dangerouslySetInnerHTML={{ __html: `
          html.dark body { background: #09090b; color: #e4e4e7; }
          html.light body { background: #f4f4f5; color: #27272a; }
          html.dark button:hover { background-color: #C49A5E !important; }
          html.light button:hover { background-color: #C49A5E !important; }
        `}} />
      </head>
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <Suspense fallback={<div style={{ padding: '2rem' }}>Loading...</div>}>
          <ErrorContent reset={props.reset} />
        </Suspense>
      </body>
    </html>
  );
}
