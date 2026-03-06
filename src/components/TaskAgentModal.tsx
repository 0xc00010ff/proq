'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { XIcon } from 'lucide-react';
import type { Task, FollowUpDraft } from '@/lib/types';
import { TaskAgentDetail } from './TaskAgentDetail';

interface TaskAgentModalProps {
  task: Task;
  projectId: string;
  isQueued?: boolean;
  cleanupExpiresAt?: number;
  followUpDraft?: FollowUpDraft;
  onFollowUpDraftChange?: (draft: FollowUpDraft | null) => void;
  onClose: () => void;
  onComplete?: (taskId: string) => void;
  onResumeEditing?: (taskId: string) => void;
  onUpdateTitle?: (taskId: string, title: string) => void;
  parallelMode?: boolean;
  currentBranch?: string;
  onSwitchBranch?: (branch: string) => void;
}

export function TaskAgentModal({ task, projectId, isQueued, cleanupExpiresAt, followUpDraft, onFollowUpDraftChange, onClose, onComplete, onResumeEditing, onUpdateTitle, parallelMode, currentBranch, onSwitchBranch }: TaskAgentModalProps) {
  const [modalSize, setModalSize] = useState<{ width: number; height: number } | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const justDraggedRef = useRef(false);

  const handleModalResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const modal = modalRef.current;
    if (!modal) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = modal.offsetWidth;
    const startH = modal.offsetHeight;
    const minW = 600;
    const minH = 400;
    const maxW = window.innerWidth - 32;
    const maxH = window.innerHeight - 32;

    const onMouseMove = (ev: MouseEvent) => {
      const newW = Math.min(Math.max(startW + (ev.clientX - startX), minW), maxW);
      const newH = Math.min(Math.max(startH + (ev.clientY - startY), minH), maxH);
      setModalSize({ width: newW, height: newH });
    };
    const onMouseUp = () => {
      justDraggedRef.current = true;
      requestAnimationFrame(() => { justDraggedRef.current = false; });
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  useEscapeKey(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={() => { if (!justDraggedRef.current) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-none" />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative flex flex-row rounded-lg border border-bronze-300 dark:border-border-default bg-bronze-50 dark:bg-surface-detail shadow-2xl shadow-black/60 mx-4 overflow-hidden"
        style={modalSize ? { width: modalSize.width, height: modalSize.height } : { width: '100%', maxWidth: '80rem', height: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-md text-text-chrome hover:text-text-chrome-hover hover:bg-surface-hover transition-colors z-10"
        >
          <XIcon className="w-4 h-4" />
        </button>

        <TaskAgentDetail
          task={task}
          projectId={projectId}
          isQueued={isQueued}
          cleanupExpiresAt={cleanupExpiresAt}
          followUpDraft={followUpDraft}
          onFollowUpDraftChange={onFollowUpDraftChange}
          onComplete={onComplete}
          onResumeEditing={onResumeEditing}
          onUpdateTitle={onUpdateTitle}
          parallelMode={parallelMode}
          currentBranch={currentBranch}
          onSwitchBranch={onSwitchBranch}
        />

        {/* Bottom-right corner resize handle */}
        <div
          onMouseDown={handleModalResizeMouseDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-10 group"
        >
          <svg className="w-3 h-3 absolute bottom-0.5 right-0.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" viewBox="0 0 12 12" fill="currentColor">
            <circle cx="10" cy="10" r="1.2" />
            <circle cx="6" cy="10" r="1.2" />
            <circle cx="10" cy="6" r="1.2" />
            <circle cx="2" cy="10" r="1.2" />
            <circle cx="6" cy="6" r="1.2" />
            <circle cx="10" cy="2" r="1.2" />
          </svg>
        </div>
      </div>
    </div>
  );
}
