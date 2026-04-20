'use client';

import { useEffect, useState } from 'react';

type State = { kind: string; reason?: string };

const isElectron = typeof window !== 'undefined' && !!window.proqDesktop;

function overlayCopy(state: State): { title: string; subtitle?: string } | null {
  if (state.kind === 'exiting') {
    if (state.reason === 'install-shell-update') {
      return { title: 'Installing update…', subtitle: 'proq will reopen in a moment.' };
    }
    if (state.reason === 'relaunch') {
      return { title: 'Restarting…' };
    }
    return { title: 'Quitting…' };
  }
  if (state.kind === 'recovering') {
    return { title: 'Reconnecting…', subtitle: 'The local server stopped responding. Restarting it.' };
  }
  return null;
}

export function AppStateOverlay() {
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    if (!isElectron || !window.proqDesktop?.onAppStateChanged) return;
    return window.proqDesktop.onAppStateChanged((_e, next) => {
      setState(next);
    });
  }, []);

  if (!state) return null;
  const copy = overlayCopy(state);
  if (!copy) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto"
      role="status"
      aria-live="polite"
    >
      <div className="rounded-lg bg-surface-modal border border-border-default px-6 py-5 shadow-xl text-center min-w-[260px]">
        <div className="flex justify-center mb-3">
          <div className="h-5 w-5 rounded-full border-2 border-bronze-600 border-t-transparent animate-spin" />
        </div>
        <div className="text-sm font-medium text-text-primary">{copy.title}</div>
        {copy.subtitle && (
          <div className="mt-1 text-xs text-text-tertiary">{copy.subtitle}</div>
        )}
      </div>
    </div>
  );
}
