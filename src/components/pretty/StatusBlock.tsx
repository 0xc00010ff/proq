'use client';

import React from 'react';
import { CheckCircle2Icon, AlertCircleIcon, BanIcon, PlayIcon } from 'lucide-react';

interface StatusBlockProps {
  subtype: 'init' | 'complete' | 'error' | 'abort';
  sessionId?: string;
  model?: string;
  costUsd?: number;
  durationMs?: number;
  turns?: number;
  error?: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

export function StatusBlock({ subtype, model, costUsd, durationMs, turns, error }: StatusBlockProps) {
  if (subtype === 'init') {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-bronze-500 dark:text-zinc-500">
        <PlayIcon className="w-3.5 h-3.5 text-steel" />
        <span>Session started{model ? ` (${model})` : ''}</span>
      </div>
    );
  }

  if (subtype === 'complete') {
    return (
      <div className="my-2 rounded-md border border-patina/20 bg-patina/5 px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs font-medium text-patina-dark dark:text-patina mb-1">
          <CheckCircle2Icon className="w-3.5 h-3.5" />
          Session complete
        </div>
        <div className="flex items-center gap-3 text-[11px] text-bronze-500 dark:text-zinc-500 font-mono">
          {durationMs != null && <span>{formatDuration(durationMs)}</span>}
          {costUsd != null && <span>${costUsd.toFixed(4)}</span>}
          {turns != null && <span>{turns} turn{turns !== 1 ? 's' : ''}</span>}
        </div>
      </div>
    );
  }

  if (subtype === 'error') {
    return (
      <div className="my-2 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs font-medium text-red-400 mb-1">
          <AlertCircleIcon className="w-3.5 h-3.5" />
          Session error
        </div>
        {error && (
          <p className="text-[11px] text-red-400/80 font-mono">{error}</p>
        )}
        <div className="flex items-center gap-3 text-[11px] text-bronze-500 dark:text-zinc-500 font-mono mt-1">
          {durationMs != null && <span>{formatDuration(durationMs)}</span>}
          {turns != null && <span>{turns} turn{turns !== 1 ? 's' : ''}</span>}
        </div>
      </div>
    );
  }

  // abort
  return (
    <div className="my-2 rounded-md border border-bronze-400 dark:border-zinc-700 bg-bronze-100/50 dark:bg-zinc-900/30 px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs font-medium text-bronze-600 dark:text-zinc-400">
        <BanIcon className="w-3.5 h-3.5" />
        Session aborted
      </div>
      <div className="flex items-center gap-3 text-[11px] text-bronze-500 dark:text-zinc-500 font-mono mt-1">
        {durationMs != null && <span>{formatDuration(durationMs)}</span>}
        {turns != null && <span>{turns} turn{turns !== 1 ? 's' : ''}</span>}
      </div>
    </div>
  );
}
