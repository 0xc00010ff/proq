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
      <p className="mb-1">
        Tasks run simultaneously in isolated Git worktrees — each task gets its own copy of the codebase.
      </p>
      <p>
        To verify a task, you&#39;ll switch into its worktree to review and test the changes before merging back.
      </p>
    </ConfirmModal>
  );
}
