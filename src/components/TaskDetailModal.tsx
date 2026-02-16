'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  XIcon,
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardCopyIcon,
  CheckIcon,
} from 'lucide-react';
import type { Task, TaskStatus } from '@/lib/types';

interface TaskDetailModalProps {
  task: Task;
  onClose: () => void;
  onUpdate: (taskId: string, data: Partial<Task>) => void;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string; color: string }[] = [
  { value: 'todo', label: 'To Do', color: 'bg-zinc-600' },
  { value: 'in-progress', label: 'In Progress', color: 'bg-blue-500' },
  { value: 'verify', label: 'Verify', color: 'bg-amber-500' },
  { value: 'done', label: 'Done', color: 'bg-green-500' },
];

export function TaskDetailModal({ task, onClose, onUpdate }: TaskDetailModalProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [isFindingsOpen, setIsFindingsOpen] = useState(true);
  const [copiedFindings, setCopiedFindings] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);

  // Sync state when task prop changes
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setStatus(task.status);
  }, [task]);

  // Auto-grow textarea
  useEffect(() => {
    if (descRef.current) {
      descRef.current.style.height = 'auto';
      descRef.current.style.height = descRef.current.scrollHeight + 'px';
    }
  }, [description]);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleTitleBlur = useCallback(() => {
    if (title !== task.title && title.trim()) {
      onUpdate(task.id, { title: title.trim() });
    }
  }, [title, task.title, task.id, onUpdate]);

  const handleDescriptionBlur = useCallback(() => {
    if (description !== task.description) {
      onUpdate(task.id, { description });
    }
  }, [description, task.description, task.id, onUpdate]);

  const handleStatusChange = useCallback(
    (newStatus: TaskStatus) => {
      setStatus(newStatus);
      onUpdate(task.id, { status: newStatus });
    },
    [task.id, onUpdate]
  );

  const steps = task.humanSteps?.split('\n').filter(Boolean) || [];
  const findings = task.findings?.split('\n').filter(Boolean) || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg border border-[#222] bg-[#141414] shadow-2xl shadow-black/60 mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors z-10"
        >
          <XIcon className="w-4 h-4" />
        </button>

        <div className="p-6 space-y-5">
          {/* Human steps banner */}
          {steps.length > 0 && (
            <div className="bg-amber-500/8 border border-amber-500/20 rounded-md p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangleIcon className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-medium text-amber-500 uppercase tracking-wide">
                  Steps for you
                </span>
              </div>
              <ul className="space-y-1">
                {steps.map((step, idx) => (
                  <li key={idx} className="text-xs text-zinc-300 flex items-start">
                    <span className="mr-2 text-zinc-600">&bull;</span>
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Title */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className="w-full bg-transparent text-lg font-semibold text-zinc-100 border-none outline-none placeholder-zinc-600 pr-8 focus:ring-0"
            placeholder="Task title..."
          />

          {/* Status pills */}
          <div className="flex items-center gap-2">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleStatusChange(opt.value)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  status === opt.value
                    ? 'bg-zinc-800 text-zinc-100 ring-1 ring-zinc-600'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${opt.color}`} />
                {opt.label}
              </button>
            ))}
          </div>

          {/* Description */}
          <textarea
            ref={descRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={handleDescriptionBlur}
            className="w-full bg-zinc-900/50 border border-zinc-800 rounded-md p-3 text-sm text-zinc-300 font-mono leading-relaxed resize-none outline-none focus:border-zinc-700 placeholder-zinc-600 min-h-[80px]"
            placeholder="Description..."
          />

          {/* Findings */}
          {findings.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setIsFindingsOpen(!isFindingsOpen)}
                  className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {isFindingsOpen ? (
                    <ChevronDownIcon className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRightIcon className="w-3.5 h-3.5" />
                  )}
                  <span className="font-mono uppercase tracking-wider text-[10px]">
                    Findings ({findings.length})
                  </span>
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(task.findings || '');
                    setCopiedFindings(true);
                    setTimeout(() => setCopiedFindings(false), 2000);
                  }}
                  className="text-zinc-600 hover:text-zinc-300 transition-colors p-0.5"
                  title="Copy findings to clipboard"
                >
                  {copiedFindings ? (
                    <CheckIcon className="w-3.5 h-3.5 text-green-400" />
                  ) : (
                    <ClipboardCopyIcon className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {isFindingsOpen && (
                <ul className="space-y-1.5 pl-1">
                  {findings.map((finding, idx) => (
                    <li key={idx} className="text-xs text-zinc-400 flex items-start font-mono">
                      <span className="mr-2 text-zinc-700">-</span>
                      {finding}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Agent log */}
          {task.agentLog && (
            <div>
              <span className="font-mono uppercase tracking-wider text-[10px] text-zinc-500 block mb-2">
                Agent Log
              </span>
              <pre className="text-[11px] text-zinc-500 font-mono bg-zinc-950 border border-zinc-800 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                {task.agentLog}
              </pre>
            </div>
          )}

          {/* Timestamps */}
          <div className="flex items-center gap-4 pt-3 border-t border-zinc-800/50">
            <span className="text-[10px] text-zinc-600 font-mono">
              Created {new Date(task.createdAt).toLocaleDateString()} {new Date(task.createdAt).toLocaleTimeString()}
            </span>
            <span className="text-[10px] text-zinc-600 font-mono">
              Updated {new Date(task.updatedAt).toLocaleDateString()} {new Date(task.updatedAt).toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
