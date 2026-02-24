'use client';

import React from 'react';
import { ConfirmModal } from '@/components/Modal';
import type { Task, TaskStatus } from '@/lib/types';

interface UndoModalProps {
  task: Task;
  column: TaskStatus;
  isOpen: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}

export function UndoModal({ task, column, isOpen, onRestore, onDiscard }: UndoModalProps) {
  const label = task.title || task.description.slice(0, 50) || 'Untitled';

  return (
    <ConfirmModal
      isOpen={isOpen}
      onConfirm={onRestore}
      onCancel={onDiscard}
      title="Restore task"
      confirmLabel="Restore"
      cancelLabel="Discard"
    >
      <p className="text-sm text-gunmetal-800 dark:text-zinc-200">
        Restore &ldquo;<span className="font-medium">{label}</span>&rdquo; to <span className="font-medium">{column}</span>?
      </p>
    </ConfirmModal>
  );
}
