'use client';

import React from 'react';
import { AlertCircleIcon, BanIcon, PauseIcon, PlayIcon } from 'lucide-react';

interface StatusBlockProps {
  subtype: 'init' | 'complete' | 'error' | 'abort' | 'interrupted';
  sessionId?: string;
  model?: string;
  costUsd?: number;
  durationMs?: number;
  turns?: number;
  error?: string;
  timestamp?: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function formatInitTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  if (isToday) return `Today ${time}`;
  const day = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day} ${time}`;
}

export function StatusBlock({ subtype, model, costUsd, durationMs, turns, error, timestamp }: StatusBlockProps) {
  if (subtype === 'init') {
    const label = model ? `Claude Code (${model})` : 'Claude Code';
    const timeLabel = timestamp ? formatInitTimestamp(timestamp) : null;
    return (
      <div className="flex flex-col gap-1 py-3">
        {timeLabel && (
          <div className="flex items-center gap-2 text-[11px] text-text-placeholder font-mono">
            <div className="flex-1 border-t border-border-default" />
            <span>{timeLabel}</span>
            <div className="flex-1 border-t border-border-default" />
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <PlayIcon className="w-3.5 h-3.5 text-bronze-500" />
          <span>{label}</span>
        </div>
      </div>
    );
  }

  if (subtype === 'complete') {
    const parts: string[] = [];
    if (durationMs != null) parts.push(formatDuration(durationMs));
    if (costUsd != null) parts.push(`$${costUsd.toFixed(4)}`);
    if (turns != null) parts.push(`${turns} turn${turns !== 1 ? 's' : ''}`);
    return (
      <div className="flex items-center gap-2 py-1.5 text-[11px] text-text-placeholder font-mono">
        <div className="flex-1 border-t border-border-default" />
        {parts.length > 0 && (
          <>
            <span>{parts.join(' · ')}</span>
            <div className="flex-1 border-t border-border-default" />
          </>
        )}
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
        <div className="flex items-center gap-3 text-[11px] text-text-tertiary font-mono mt-1">
          {durationMs != null && <span>{formatDuration(durationMs)}</span>}
          {turns != null && <span>{turns} turn{turns !== 1 ? 's' : ''}</span>}
        </div>
      </div>
    );
  }

  if (subtype === 'interrupted') {
    return (
      <div className="flex items-center gap-2 py-1.5 text-[11px] text-text-placeholder font-mono">
        <div className="flex-1 border-t border-border-default" />
        <PauseIcon className="w-3 h-3" />
        <span>Agent stopped</span>
        <div className="flex-1 border-t border-border-default" />
      </div>
    );
  }

  // abort
  return (
    <div className="my-2 py-2.5">
      <div className="flex items-center gap-2 text-xs font-medium text-red-400">
        <BanIcon className="w-3.5 h-3.5" />
        Session aborted
      </div>
      <div className="flex items-center gap-3 text-[11px] text-red-400/60 font-mono mt-1">
        {durationMs != null && <span>{formatDuration(durationMs)}</span>}
        {turns != null && <span>{turns} turn{turns !== 1 ? 's' : ''}</span>}
      </div>
    </div>
  );
}
