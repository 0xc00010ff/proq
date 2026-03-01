'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  AlertTriangleIcon,
  Trash2Icon,
  Loader2Icon,
  ClockIcon,
  EyeIcon,
} from 'lucide-react';
import type { Task } from '@/lib/types';
import { parseLines } from '@/lib/utils';

interface TaskCardProps {
  task: Task;
  isDragOverlay?: boolean;
  isQueued?: boolean;
  isPreviewActive?: boolean;
  onDelete?: (taskId: string) => void;
  onClick?: (task: Task) => void;
  onUpdateTitle?: (taskId: string, title: string) => void;
}

export function TaskCard({ task, isDragOverlay, isQueued, isPreviewActive, onDelete, onClick, onUpdateTitle }: TaskCardProps) {
  const steps = parseLines(task.humanSteps);
  const isRunning = task.dispatch === 'running';
  const isStarting = task.dispatch === 'starting';
  const isActive = isRunning || isStarting;
  const canEditTitle = (task.status === 'verify' || task.status === 'done') && !!onUpdateTitle;

  // Track findings changes to trigger flash animation
  const [flash, setFlash] = useState(false);
  const prevFindingsRef = useRef(task.findings);
  useEffect(() => {
    if (task.findings && task.findings !== prevFindingsRef.current) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 2000);
      prevFindingsRef.current = task.findings;
      return () => clearTimeout(timer);
    }
    prevFindingsRef.current = task.findings;
  }, [task.findings]);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.title || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Sync editValue when task title changes externally
  useEffect(() => {
    if (!editing) setEditValue(task.title || '');
  }, [task.title, editing]);

  const commitEdit = () => {
    const trimmed = editValue.trim();
    setEditing(false);
    if (trimmed && trimmed !== task.title) {
      onUpdateTitle?.(task.id, trimmed);
    }
  };

  return (
    <div
      className={`
        group relative bg-surface-secondary border rounded-md overflow-hidden
        ${isPreviewActive
          ? 'border-gold/50 shadow-[0_0_12px_rgba(201,168,76,0.15)]'
          : isRunning
          ? 'border-steel/40 shadow-[0_0_12px_rgba(91,131,176,0.15)] animate-pulse-subtle'
          : isQueued || isStarting
          ? 'border-zinc-500/30'
          : 'border-border-default'}
        ${flash ? 'ring-1 ring-gold/50 shadow-[0_0_12px_rgba(200,170,80,0.2)]' : ''}
        ${isDragOverlay ? 'ring-1 ring-steel-dark shadow-lg shadow-black/20 dark:shadow-black/40' : `hover:bg-surface-hover cursor-pointer ${isRunning ? '' : 'hover:border-border-hover'}`}
        transition-shadow duration-700
      `}
      onClick={() => !isDragOverlay && onClick?.(task)}
    >
      {/* Delete button */}
      {onDelete && !isDragOverlay && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(task.id);
          }}
          className="absolute top-2 right-2 p-1 rounded text-text-chrome hover:text-crimson hover:bg-surface-hover opacity-0 group-hover:opacity-100 transition-opacity z-10"
        >
          <Trash2Icon className="w-3.5 h-3.5" />
        </button>
      )}

      <div className="p-3 min-h-[80px]">
        <div className="flex items-start justify-between pr-6">
          {editing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') { setEditValue(task.title || ''); setEditing(false); }
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="text-sm text-zinc-200 leading-snug font-normal bg-transparent border-b border-zinc-500 outline-none w-full"
            />
          ) : task.title ? (
            <h4
              className={`text-sm text-bronze-800 dark:text-zinc-200 leading-snug font-normal ${canEditTitle ? 'cursor-text hover:border-b hover:border-zinc-600' : ''}`}
              onPointerDown={canEditTitle ? (e) => e.stopPropagation() : undefined}
              onClick={canEditTitle ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
            >
              {task.title}
            </h4>
          ) : (
            <p className="text-sm text-bronze-800 dark:text-zinc-200 leading-snug font-normal line-clamp-2">
              {task.description}
            </p>
          )}
        </div>

        {task.title && task.description && (
          <p className="text-xs text-zinc-500 leading-relaxed mt-2 line-clamp-2">
            {task.description}
          </p>
        )}

        {steps.length > 0 && task.status !== 'done' && (
          <div className="mt-2 flex items-center gap-1.5">
            <AlertTriangleIcon className="w-3 h-3 text-gold flex-shrink-0" />
            <span className="text-[10px] text-gold font-medium uppercase tracking-wide">
              {steps.length} step{steps.length !== 1 ? 's' : ''} for you
            </span>
          </div>
        )}

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border-subtle">
          {isPreviewActive && !isActive && !isQueued ? (
            <div className="flex items-center gap-1.5">
              <EyeIcon className="w-3 h-3 text-gold" />
              <span className="text-[10px] text-gold font-medium uppercase tracking-wide">
                Previewing
              </span>
            </div>
          ) : isQueued ? (
            <div className="flex items-center gap-1.5">
              <ClockIcon className="w-3 h-3 text-zinc-400" />
              <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wide">
                Queued
              </span>
            </div>
          ) : isRunning ? (
            <div className="flex items-center gap-1.5">
              <Loader2Icon className="w-3 h-3 text-steel animate-spin" />
              <span className="text-[10px] text-steel font-medium uppercase tracking-wide">
                Agent working
              </span>
            </div>
          ) : isStarting ? (
            <div className="flex items-center gap-1.5">
              <Loader2Icon className="w-3 h-3 text-zinc-400 animate-spin" />
              <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wide">
                Starting...
              </span>
            </div>
          ) : (
            <span />
          )}
          <span className="text-[10px] text-zinc-400 dark:text-zinc-600 font-mono">
            {task.id.slice(0, 8)}
          </span>
        </div>
      </div>
    </div>
  );
}
