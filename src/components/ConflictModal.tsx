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
        className="relative bg-surface-modal border border-border-default rounded-lg max-w-2xl w-full mx-4 shadow-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border-default shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-semibold text-text-primary">Merge Conflict</h3>
          </div>
          <button onClick={onDismiss} className="p-1 rounded text-text-chrome hover:text-text-chrome-hover hover:bg-surface-hover">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          <div>
            <span className="text-xs text-text-tertiary">Branch</span>
            <p className="text-xs font-mono text-text-secondary mt-0.5">{branch}</p>
          </div>

          {files.length > 0 && (
            <div>
              <span className="text-xs text-text-tertiary">Conflicting files</span>
              <ul className="mt-1 space-y-0.5">
                {files.map((file) => (
                  <li key={file} className="text-xs font-mono text-text-secondary flex items-start">
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
                className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary"
              >
                {diffExpanded ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
                Diff details
              </button>
              {diffExpanded && (
                <pre className="mt-1 text-[11px] font-mono text-text-secondary bg-surface-deep border border-border-default rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                  {diff}
                </pre>
              )}
            </div>
          )}

          <p className="text-xs text-text-tertiary leading-relaxed">
            This task's branch conflicts with main. Clicking <strong className="text-text-secondary">Resolve</strong> will
            re-dispatch the agent on the existing branch to merge main and resolve the conflicts — your previous work and findings are preserved.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-border-default shrink-0">
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
          >
            Dismiss
          </button>
          <button
            onClick={onResolve}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-lazuli border border-lazuli/30 rounded-md hover:bg-lazuli/10"
          >
            <WrenchIcon className="w-3 h-3" />
            Resolve
          </button>
        </div>
      </div>
    </div>
  );
}
