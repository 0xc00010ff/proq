'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import type { Task } from '@/lib/types';
import { TaskDraft } from './TaskDraft';

interface TaskModalProps {
  task: Task;
  isOpen: boolean;
  onClose: (isEmpty: boolean) => void;
  onSave: (taskId: string, updates: Partial<Task>) => void;
  onMoveToInProgress?: (taskId: string, currentData: Partial<Task>) => Promise<void>;
}

const MIN_MODAL_HEIGHT = 420;
const MAX_MODAL_VH = 0.8;

export function TaskModal({ task, isOpen, onClose, onSave, onMoveToInProgress }: TaskModalProps) {
  const [modalHeight, setModalHeight] = useState(MIN_MODAL_HEIGHT);

  const handleClose = useCallback((isEmpty: boolean) => {
    onClose(isEmpty);
  }, [onClose]);

  useEscapeKey(() => handleClose(false), isOpen);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleHeightChange = (ideal: number) => {
    const maxH = window.innerHeight * MAX_MODAL_VH;
    setModalHeight(Math.max(MIN_MODAL_HEIGHT, Math.min(Math.ceil(ideal), maxH)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-none"
        onClick={() => handleClose(false)}
      />

      <div
        className="relative w-full max-w-2xl bg-bronze-50 dark:bg-zinc-900 border border-bronze-300 dark:border-zinc-800 rounded-lg shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
        style={{ height: modalHeight }}
      >
        <TaskDraft
          task={task}
          onClose={handleClose}
          onSave={onSave}
          onMoveToInProgress={onMoveToInProgress}
          onHeightChange={handleHeightChange}
          autoFocus={isOpen}
        />
      </div>
    </div>
  );
}
