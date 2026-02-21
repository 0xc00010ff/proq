'use client';

import React from 'react';
import {
  AlertTriangleIcon,
  Trash2Icon,
  Loader2Icon,
  ClockIcon,
} from 'lucide-react';
import type { Task } from '@/lib/types';
import { parseLines } from '@/lib/utils';

interface TaskCardProps {
  task: Task;
  isDragOverlay?: boolean;
  isQueued?: boolean;
  onDelete?: (taskId: string) => void;
  onClick?: (task: Task) => void;
}

export function TaskCard({ task, isDragOverlay, isQueued, onDelete, onClick }: TaskCardProps) {
  const steps = parseLines(task.humanSteps);
  const isLocked = task.status === 'in-progress' && task.locked;

  return (
    <div
      className={`
        group relative bg-surface-secondary border rounded-md overflow-hidden
        ${isLocked && !isQueued
          ? 'border-steel/40 shadow-[0_0_12px_rgba(91,131,176,0.15)] animate-pulse-subtle'
          : isQueued
          ? 'border-zinc-500/30'
          : 'border-border-default'}
        ${isDragOverlay ? 'ring-1 ring-steel-dark shadow-lg shadow-black/20 dark:shadow-black/40' : `hover:bg-surface-hover cursor-pointer ${isLocked && !isQueued ? '' : 'hover:border-border-hover'}`}
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
          <h4 className="text-sm text-gunmetal-800 dark:text-zinc-200 leading-snug font-normal">
            {task.title}
          </h4>
        </div>

        {task.description && (
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
          {isQueued ? (
            <div className="flex items-center gap-1.5">
              <ClockIcon className="w-3 h-3 text-zinc-400" />
              <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wide">
                Queued
              </span>
            </div>
          ) : isLocked ? (
            <div className="flex items-center gap-1.5">
              <Loader2Icon className="w-3 h-3 text-steel animate-spin" />
              <span className="text-[10px] text-steel font-medium uppercase tracking-wide">
                Agent working
              </span>
            </div>
          ) : task.status === 'in-progress' ? (
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
