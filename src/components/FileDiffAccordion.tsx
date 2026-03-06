'use client';

import React from 'react';
import { ChevronRightIcon } from 'lucide-react';
import type { FileDiff } from '@/lib/diff-parser';
import { colorDiffLine } from '@/lib/diff-parser';

const STATUS_BADGE: Record<FileDiff['status'], { label: string; color: string }> = {
  modified: { label: 'M', color: 'text-zinc-400' },
  added: { label: 'A', color: 'text-green-400' },
  deleted: { label: 'D', color: 'text-red-400' },
  renamed: { label: 'R', color: 'text-blue-400' },
};

interface FileDiffAccordionProps {
  file: FileDiff;
  isOpen: boolean;
  onToggle: () => void;
}

export function FileDiffAccordion({ file, isOpen, onToggle }: FileDiffAccordionProps) {
  const badge = STATUS_BADGE[file.status];

  // Count added/removed lines from hunks
  let additions = 0;
  let deletions = 0;
  for (const line of file.hunks.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }

  return (
    <div className="border-b border-zinc-800/50">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-zinc-800/30 group"
      >
        <ChevronRightIcon
          className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
        <span className={`font-mono text-[10px] w-4 text-center shrink-0 ${badge.color}`}>
          {badge.label}
        </span>
        <span className="text-xs text-zinc-200 font-mono truncate">{file.fileName}</span>
        {(additions > 0 || deletions > 0) && (
          <span className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
            {additions > 0 && <span className="text-green-400">+{additions}</span>}
            {deletions > 0 && <span className="text-red-400">-{deletions}</span>}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="px-4 pb-3">
          <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words bg-zinc-950/50 rounded p-3 overflow-x-auto">
            {file.hunks.split('\n').map((line, i) => {
              const color = colorDiffLine(line);
              return (
                <div key={i} className={color || 'text-zinc-400'}>
                  {line || '\u00A0'}
                </div>
              );
            })}
          </pre>
        </div>
      )}
    </div>
  );
}
