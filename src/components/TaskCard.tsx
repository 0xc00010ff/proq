'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Trash2Icon,
  Loader2Icon,
  ClockIcon,
  EyeIcon,
  AlertTriangleIcon,
  TimerIcon,
} from 'lucide-react';
import type { Task, Agent } from '@/lib/types';

interface TaskCardProps {
  task: Task;
  isDragOverlay?: boolean;
  isQueued?: boolean;
  isPreviewActive?: boolean;
  columnStatus?: string;
  agentMap?: Map<string, Agent>;
  onDelete?: (taskId: string) => void;
  onClick?: (task: Task) => void;
  onUpdateTitle?: (taskId: string, title: string) => void;
}

export function TaskCard({ task, isDragOverlay, isQueued, isPreviewActive, columnStatus, agentMap, onDelete, onClick, onUpdateTitle }: TaskCardProps) {
  const isRunning = task.agentStatus === 'running';
  const isStarting = task.agentStatus === 'starting';
  const isActive = isRunning || isStarting;
  const isCron = !!task.cronJobId;
  const isCronError = isCron && task.status === 'verify' && task.summary?.startsWith('Error:');
  const showAgentNames = agentMap && agentMap.size > 1;
  const agentName = showAgentNames && task.agentId ? agentMap.get(task.agentId)?.name : undefined;
  const canEditTitle = !!onUpdateTitle;

  // Track summary changes to trigger flash animation
  const [flash, setFlash] = useState(false);
  const prevSummaryRef = useRef(task.summary);
  useEffect(() => {
    if (task.summary && task.summary !== prevSummaryRef.current) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 2000);
      prevSummaryRef.current = task.summary;
      return () => clearTimeout(timer);
    }
    prevSummaryRef.current = task.summary;
  }, [task.summary]);

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
          ? 'border-lazuli/50 shadow-[0_0_12px_rgba(91,131,176,0.15)]'
          : isRunning
          ? 'border-bronze-500/40 shadow-[0_0_12px_rgba(228,189,137,0.15)] animate-pulse-subtle'
          : isQueued || isStarting
          ? 'border-zinc-500/30'
          : 'border-border-default'}
        ${flash ? 'ring-1 ring-lazuli/50 shadow-[0_0_12px_rgba(91,131,176,0.2)]' : ''}
        ${isDragOverlay ? 'ring-1 ring-bronze-600 shadow-lg shadow-black/30' : `hover:bg-surface-hover/40 cursor-pointer ${isRunning ? '' : columnStatus === 'in-progress' ? 'hover:border-bronze-500/30' : columnStatus === 'verify' ? 'hover:border-lazuli/30' : columnStatus === 'done' ? 'hover:border-emerald/30' : 'hover:border-border-hover/50'}`}
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
        <div className="flex items-start gap-2 pr-6">
          {task.needsAttention && (
            <span className="w-1.5 h-1.5 rounded-full bg-lazuli shrink-0 mt-[7px]" />
          )}
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
              className={`text-sm text-text-primary leading-snug font-normal ${canEditTitle ? 'cursor-text hover:border-b hover:border-zinc-600' : ''}`}
              onPointerDown={canEditTitle ? (e) => e.stopPropagation() : undefined}
              onClick={canEditTitle ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
            >
              {task.title}
            </h4>
          ) : (
            <p className="text-sm text-text-primary leading-snug font-normal line-clamp-2">
              {task.description}
            </p>
          )}
        </div>

        {task.title && task.description && (
          <p className="text-xs text-text-tertiary leading-relaxed mt-2 line-clamp-2">
            {task.description}
          </p>
        )}

        {task.mergeConflict && (
          <div className="mt-2 flex items-center gap-1.5">
            <AlertTriangleIcon className="w-3 h-3 text-red-400 flex-shrink-0" />
            <span className="text-[10px] text-red-400 font-medium uppercase tracking-wide">
              Merge conflict
            </span>
          </div>
        )}

        {isCronError && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
            <span className="text-[10px] text-red-400 font-medium uppercase tracking-wide">
              Error
            </span>
          </div>
        )}

        {(isActive || isQueued || isPreviewActive || agentName || isCron) && (
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-border-subtle/60">
            {isPreviewActive && !isActive && !isQueued ? (
              <div className="flex items-center gap-1.5">
                <EyeIcon className="w-3 h-3 text-lazuli" />
                <span className="text-[10px] text-lazuli font-medium uppercase tracking-wide">
                  Previewing
                </span>
              </div>
            ) : isQueued ? (
              <div className="flex items-center gap-1.5">
                <ClockIcon className="w-3 h-3 text-text-secondary" />
                <span className={`text-[10px] text-text-secondary font-medium tracking-wide truncate max-w-[160px] ${agentName ? '' : 'uppercase'}`}>
                  {agentName || 'Queued'}
                </span>
              </div>
            ) : isRunning ? (
              <div className="flex items-center gap-1.5">
                <Loader2Icon className="w-3 h-3 text-bronze-500 animate-spin" />
                <span className={`text-[10px] text-bronze-500 font-medium tracking-wide truncate max-w-[160px] ${agentName ? '' : 'uppercase'}`}>
                  {agentName || 'Agent working'}
                </span>
              </div>
            ) : isStarting ? (
              <div className="flex items-center gap-1.5">
                <Loader2Icon className="w-3 h-3 text-text-secondary animate-spin" />
                <span className={`text-[10px] text-text-secondary font-medium tracking-wide truncate max-w-[160px] ${agentName ? '' : 'uppercase'}`}>
                  {agentName || 'Starting...'}
                </span>
              </div>
            ) : agentName ? (
              <span className="text-[10px] text-text-chrome font-medium tracking-wide truncate max-w-[160px]" title={agentName}>
                {agentName}
              </span>
            ) : (
              <span />
            )}
            {isCron && (
              <span className="flex items-center">
                <TimerIcon className="w-3 h-3 text-text-chrome" />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
