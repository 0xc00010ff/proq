'use client';

import React from 'react';
import { XIcon, AlertTriangleIcon, PlayIcon } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface ConflictModalProps {
  branch: string;
  files: string[];
  onRedispatch: () => void;
  onDismiss: () => void;
}

export function ConflictModal({ branch, files, onRedispatch, onDismiss }: ConflictModalProps) {
  useEscapeKey(onDismiss);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onDismiss}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-bronze-50 dark:bg-[#1a1a1a] border border-bronze-300 dark:border-zinc-800 rounded-lg max-w-md w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-bronze-300 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-semibold text-bronze-900 dark:text-zinc-100">Merge Conflict</h3>
          </div>
          <button onClick={onDismiss} className="p-1 rounded text-text-chrome hover:text-text-chrome-hover hover:bg-surface-hover transition-colors">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <span className="text-xs text-bronze-500 dark:text-zinc-500">Branch</span>
            <p className="text-xs font-mono text-bronze-800 dark:text-zinc-300 mt-0.5">{branch}</p>
          </div>

          {files.length > 0 && (
            <div>
              <span className="text-xs text-bronze-500 dark:text-zinc-500">Conflicting files</span>
              <ul className="mt-1 space-y-0.5">
                {files.map((file) => (
                  <li key={file} className="text-xs font-mono text-bronze-700 dark:text-zinc-400 flex items-start">
                    <span className="mr-2 text-red-400 shrink-0">-</span>
                    <span>{file}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-bronze-600 dark:text-zinc-500 leading-relaxed">
            This task's changes conflict with code merged from another task. You can re-dispatch this task to have the agent resolve the conflicts on the current codebase, or resolve manually from a terminal.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-bronze-300 dark:border-zinc-800">
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 text-xs font-medium text-bronze-600 dark:text-zinc-400 hover:text-bronze-800 dark:hover:text-zinc-200 transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={onRedispatch}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-steel border border-steel/30 rounded-md hover:bg-steel/10 transition-colors"
          >
            <PlayIcon className="w-3 h-3" />
            Re-dispatch
          </button>
        </div>
      </div>
    </div>
  );
}
