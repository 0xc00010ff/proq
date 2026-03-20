'use client';

import { Suspense } from 'react';

function ErrorContent({ reset }: { reset: () => void }) {
  return (
    <div style={{ padding: '2rem', minHeight: '100vh' }}>
      <h1>Something went wrong</h1>
      <button
        onClick={reset}
        style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}
      >
        Try again
      </button>
    </div>
  );
}

export default function GlobalError(props: { error: Error; reset: () => void }) {
  return (
    <html lang="en" className="dark">
      <body style={{ background: '#09090b', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <Suspense fallback={<div style={{ padding: '2rem' }}>Loading...</div>}>
          <ErrorContent reset={props.reset} />
        </Suspense>
      </body>
    </html>
  );
}
