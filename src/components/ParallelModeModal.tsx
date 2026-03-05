'use client';

import React from 'react';
import { ConfirmModal } from '@/components/Modal';

interface ParallelModeModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ParallelModeModal({ isOpen, onConfirm, onCancel }: ParallelModeModalProps) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      onConfirm={onConfirm}
      onCancel={onCancel}
      title="Parallel Mode"
      confirmLabel="Got it"
    >
      <div className="space-y-2 text-sm text-zinc-300">
        <p>
          Each task runs on its <strong className="text-zinc-100">own isolated git worktree</strong> — a separate copy of the codebase so tasks never conflict while in progress.
        </p>
        <p>
          To preview changes before marking a task complete, click the <strong className="text-zinc-100">Preview</strong> button in the task detail. This switches your dev server to that task&apos;s branch so you can test it live.
        </p>
        <p>
          When a task is moved to <strong className="text-zinc-100">Done</strong>, its branch is automatically merged into main and the worktree is cleaned up.
        </p>
      </div>
    </ConfirmModal>
  );
}
