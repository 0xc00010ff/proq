'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { XIcon, Maximize2Icon, Minimize2Icon } from 'lucide-react';
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
} from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
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
  defaultBranch?: string;
}

export function TaskAgentModal({ task, projectId, isQueued, cleanupExpiresAt, followUpDraft, onFollowUpDraftChange, onClose, onComplete, onResumeEditing, onUpdateTitle, parallelMode, currentBranch, onSwitchBranch, defaultBranch }: TaskAgentModalProps) {
  const [modalSize, setModalSize] = useState<{ width: number; height: number } | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

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
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={modalRef}
          className="fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] flex flex-col rounded-lg border border-border-default bg-surface-detail shadow-2xl shadow-black/60 mx-4 overflow-hidden animate-fade-in"
          style={modalSize ? { width: modalSize.width, height: modalSize.height } : { width: 'calc(100% - 2rem)', maxWidth: '80rem', height: '90vh' }}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {/* Modal header bar */}
          <div className="shrink-0 flex items-center justify-between px-4 py-1.5 border-b border-border-default bg-surface-topbar">
            <DialogPrimitive.Title className="text-xs font-medium text-text-primary truncate mr-2">
              {task.title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="shrink-0 p-1 rounded-md text-text-chrome hover:text-text-chrome-hover hover:bg-surface-hover"
            >
              <XIcon className="w-4 h-4" />
            </DialogPrimitive.Close>
          </div>

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
            defaultBranch={defaultBranch}
            className="flex-1 min-h-0"
          />

          {/* Bottom-right corner resize handle */}
          <div
            onMouseDown={handleModalResizeMouseDown}
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-10 group"
          >
            <svg className="w-3 h-3 absolute bottom-0.5 right-0.5 text-zinc-600 group-hover:text-zinc-400" viewBox="0 0 12 12" fill="currentColor">
              <circle cx="10" cy="10" r="1.2" />
              <circle cx="6" cy="10" r="1.2" />
              <circle cx="10" cy="6" r="1.2" />
              <circle cx="2" cy="10" r="1.2" />
              <circle cx="6" cy="6" r="1.2" />
              <circle cx="10" cy="2" r="1.2" />
            </svg>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
