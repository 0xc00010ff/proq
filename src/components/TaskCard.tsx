'use client';

import React from 'react';
import {
  AlertTriangleIcon,
  Trash2Icon,
  Loader2Icon,
} from 'lucide-react';
import type { Task } from '@/lib/types';

interface TaskCardProps {
  task: Task;
  isDragOverlay?: boolean;
  onDelete?: (taskId: string) => void;
  onClick?: (task: Task) => void;
}

export function TaskCard({ task, isDragOverlay, onDelete, onClick }: TaskCardProps) {
  const steps = task.humanSteps?.split('\n').filter(Boolean) || [];
  const isLocked = task.status === 'in-progress' && task.locked;

  return (
    <div
      className={`
        group relative bg-white dark:bg-zinc-800/30 border rounded-md overflow-hidden
        ${isLocked
          ? 'border-blue-500/40 shadow-[0_0_12px_rgba(59,130,246,0.15)] animate-pulse-subtle'
          : 'border-zinc-200 dark:border-zinc-800'}
        ${isDragOverlay ? 'ring-1 ring-blue-500 shadow-lg shadow-black/20 dark:shadow-black/40' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 cursor-pointer'}
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
          className="absolute top-2 right-2 p-1 rounded text-zinc-400 dark:text-zinc-600 hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition-opacity z-10"
        >
          <Trash2Icon className="w-3.5 h-3.5" />
        </button>
      )}

      <div className="p-3 min-h-[80px]">
        <div className="flex items-start justify-between pr-6">
          <h4 className="text-sm text-zinc-800 dark:text-zinc-200 leading-snug font-normal">
            {task.title}
          </h4>
        </div>

        {task.description && (
          <p className="text-xs text-zinc-500 leading-relaxed mt-2 line-clamp-2">
            {task.description}
          </p>
        )}

        {steps.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5">
            <AlertTriangleIcon className="w-3 h-3 text-amber-500 flex-shrink-0" />
            <span className="text-[10px] text-amber-500 font-medium uppercase tracking-wide">
              {steps.length} step{steps.length !== 1 ? 's' : ''} for you
            </span>
          </div>
        )}

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-zinc-100 dark:border-zinc-800/50">
          {isLocked ? (
            <div className="flex items-center gap-1.5">
              <Loader2Icon className="w-3 h-3 text-blue-400 animate-spin" />
              <span className="text-[10px] text-blue-400 font-medium uppercase tracking-wide">
                Agent working
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
