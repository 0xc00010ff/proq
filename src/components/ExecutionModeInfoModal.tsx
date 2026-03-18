'use client';

import React from 'react';
import { ConfirmModal } from '@/components/Modal';

interface ExecutionModeInfoModalProps {
  isOpen: boolean;
  mode: 'parallel' | 'worktrees';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ExecutionModeInfoModal({ isOpen, mode, onConfirm, onCancel }: ExecutionModeInfoModalProps) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      onConfirm={onConfirm}
      onCancel={onCancel}
      title={mode === 'worktrees' ? 'Worktrees Mode' : 'Parallel Mode'}
      confirmLabel="Got it"
    >
      {mode === 'worktrees' ? (
        <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
          <p>
            Each task runs on its <strong className="text-zinc-900 dark:text-zinc-100">own isolated git worktree</strong> — a separate copy of the codebase so tasks never conflict while in progress.
          </p>
          <p>
            To preview changes before marking a task complete, click the <strong className="text-zinc-900 dark:text-zinc-100">Preview</strong> button in the task detail. This switches your dev server to that task&apos;s branch so you can test it live.
          </p>
          <p>
            When a task is moved to <strong className="text-zinc-900 dark:text-zinc-100">Done</strong>, its branch is automatically merged into main and the worktree is cleaned up.
          </p>
        </div>
      ) : (
        <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
          <p>
            All tasks launch <strong className="text-zinc-900 dark:text-zinc-100">immediately</strong> without waiting in a queue — multiple agents work at the same time on the same branch.
          </p>
          <p>
            This works best when tasks <strong className="text-zinc-900 dark:text-zinc-100">touch different files</strong> and are unlikely to conflict with each other.
          </p>
          <p>
            Unlike Worktrees mode, there are no isolated branches — all changes go directly to the <strong className="text-zinc-900 dark:text-zinc-100">current branch</strong>.
          </p>
        </div>
      )}
    </ConfirmModal>
  );
}
