'use client';

import React, { useState } from 'react';
import { XIcon, AlertTriangleIcon, WrenchIcon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface ConflictModalProps {
  branch: string;
  files: string[];
  diff?: string;
  onResolve: () => void;
  onDismiss: () => void;
}

export function ConflictModal({ branch, files, diff, onResolve, onDismiss }: ConflictModalProps) {
  useEscapeKey(onDismiss);
  const [diffExpanded, setDiffExpanded] = useState(true);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onDismiss}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-bronze-50 dark:bg-[#1a1a1a] border border-bronze-300 dark:border-zinc-800 rounded-lg max-w-2xl w-full mx-4 shadow-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-bronze-300 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-semibold text-bronze-900 dark:text-zinc-100">Merge Conflict</h3>
          </div>
          <button onClick={onDismiss} className="p-1 rounded text-text-chrome hover:text-text-chrome-hover hover:bg-surface-hover transition-colors">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
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

          {diff && (
            <div>
              <button
                onClick={() => setDiffExpanded(!diffExpanded)}
                className="flex items-center gap-1 text-xs text-bronze-500 dark:text-zinc-500 hover:text-bronze-700 dark:hover:text-zinc-300 transition-colors"
              >
                {diffExpanded ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
                Diff details
              </button>
              {diffExpanded && (
                <pre className="mt-1 text-[11px] font-mono text-bronze-700 dark:text-zinc-400 bg-bronze-100 dark:bg-zinc-950 border border-bronze-300 dark:border-zinc-800 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                  {diff}
                </pre>
              )}
            </div>
          )}

          <p className="text-xs text-bronze-600 dark:text-zinc-500 leading-relaxed">
            This task's branch conflicts with main. Clicking <strong className="text-bronze-700 dark:text-zinc-400">Resolve</strong> will
            re-dispatch the agent on the existing branch to merge main and resolve the conflicts — your previous work and findings are preserved.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-bronze-300 dark:border-zinc-800 shrink-0">
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 text-xs font-medium text-bronze-600 dark:text-zinc-400 hover:text-bronze-800 dark:hover:text-zinc-200 transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={onResolve}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-steel border border-steel/30 rounded-md hover:bg-steel/10 transition-colors"
          >
            <WrenchIcon className="w-3 h-3" />
            Resolve
          </button>
        </div>
      </div>
    </div>
  );
}
