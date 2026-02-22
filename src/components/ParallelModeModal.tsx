'use client';

import React from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface ParallelModeModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ParallelModeModal({ isOpen, onConfirm, onCancel }: ParallelModeModalProps) {
  useEscapeKey(onCancel);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-gunmetal-50 dark:bg-[#1a1a1a] border border-gunmetal-300 dark:border-zinc-800 rounded-lg p-6 max-w-md mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-gunmetal-900 dark:text-zinc-100 mb-3">Parallel Mode</h3>
        <p className="text-xs text-gunmetal-700 dark:text-zinc-400 leading-relaxed mb-1">
          Tasks run simultaneously in isolated Git worktrees — each task gets its own copy of the codebase.
        </p>
        <p className="text-xs text-gunmetal-700 dark:text-zinc-400 leading-relaxed mb-5">
          To verify a task, you'll switch into its worktree to review and test the changes before merging back.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button onClick={onConfirm} className="btn-primary">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
