'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  PlusIcon,
  ListOrderedIcon,
  LayersIcon,
  ChevronDownIcon,
  Loader2Icon,
  ClockIcon,
} from 'lucide-react';
import type { Task, TaskStatus, TaskColumns, ExecutionMode, FollowUpDraft } from '@/lib/types';
import { COLUMNS } from './KanbanBoard';
import { TaskAgentDetail } from './TaskAgentDetail';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

interface ListViewProps {
  tasks: TaskColumns;
  projectId: string;
  onAddTask?: () => void;
  onDeleteTask?: (taskId: string) => void;
  onClickTask?: (task: Task) => void;
  executionMode?: ExecutionMode;
  onExecutionModeChange?: (mode: ExecutionMode) => void;
  // Agent detail props
  cleanupTimes?: Record<string, number>;
  followUpDraftsRef?: React.MutableRefObject<Map<string, FollowUpDraft>>;
  onFollowUpDraftChange?: (taskId: string, draft: FollowUpDraft | null) => void;
  onComplete?: (taskId: string) => void;
  onResumeEditing?: (taskId: string) => void;
  onUpdateTitle?: (taskId: string, title: string) => void;
  parallelMode?: boolean;
  currentBranch?: string;
  onSwitchBranch?: (branch: string) => void;
}

const STATUS_ORDER: TaskStatus[] = ['todo', 'in-progress', 'verify', 'done'];

function flattenTasks(columns: TaskColumns): Task[] {
  const result: Task[] = [];
  for (const status of STATUS_ORDER) {
    result.push(...columns[status]);
  }
  return result;
}

const MASTER_WIDTH_KEY = 'proq-list-master-width';
const DEFAULT_MASTER_WIDTH = 320;
const MIN_MASTER_WIDTH = 200;
const MAX_MASTER_WIDTH = 600;

export function ListView({
  tasks,
  projectId,
  onAddTask,
  onDeleteTask,
  onClickTask,
  executionMode = 'sequential',
  onExecutionModeChange,
  cleanupTimes = {},
  followUpDraftsRef,
  onFollowUpDraftChange,
  onComplete,
  onResumeEditing,
  onUpdateTitle,
  parallelMode,
  currentBranch,
  onSwitchBranch,
}: ListViewProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [masterWidth, setMasterWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_MASTER_WIDTH;
    const stored = localStorage.getItem(MASTER_WIDTH_KEY);
    return stored ? Math.min(Math.max(parseInt(stored, 10), MIN_MASTER_WIDTH), MAX_MASTER_WIDTH) : DEFAULT_MASTER_WIDTH;
  });

  const allTasks = flattenTasks(tasks);
  const selectedTask = selectedTaskId ? allTasks.find((t) => t.id === selectedTaskId) : null;

  // Keep selection in sync when tasks update via SSE
  useEffect(() => {
    if (selectedTaskId && !allTasks.find((t) => t.id === selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [allTasks, selectedTaskId]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = masterWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.min(Math.max(startWidth + (ev.clientX - startX), MIN_MASTER_WIDTH), MAX_MASTER_WIDTH);
      setMasterWidth(newWidth);
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem(MASTER_WIDTH_KEY, String(masterWidth));
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [masterWidth]);

  const getStatusIcon = (status: TaskStatus) => {
    const col = COLUMNS.find((c) => c.id === status);
    return col?.icon ?? null;
  };

  const handleRowClick = (task: Task) => {
    // For todo tasks, open the modal via onClickTask (same as kanban)
    if (task.status === 'todo') {
      onClickTask?.(task);
      return;
    }
    // For non-todo tasks, select inline
    setSelectedTaskId(selectedTaskId === task.id ? null : task.id);
  };

  return (
    <div className="flex-1 h-full flex overflow-hidden bg-surface-base">
      {/* Master panel */}
      <div data-master-panel className="shrink-0 flex flex-col border-r border-bronze-300 dark:border-zinc-800 bg-surface-base" style={{ width: masterWidth }}>
        {/* Master header */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-3 border-b border-bronze-300 dark:border-zinc-800">
          {onAddTask && (
            <button
              onClick={onAddTask}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-text-chrome hover:text-text-chrome-hover hover:bg-surface-hover transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          )}
          <div className="flex-1" />
          {onExecutionModeChange && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  {executionMode === 'sequential' ? (
                    <ListOrderedIcon className="w-3 h-3" />
                  ) : (
                    <LayersIcon className="w-3 h-3" />
                  )}
                  <span>{executionMode === 'sequential' ? 'Seq' : 'Par'}</span>
                  <ChevronDownIcon className="w-3 h-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="exec-mode-dropdown min-w-[140px]">
                <DropdownMenuItem
                  onSelect={() => onExecutionModeChange('sequential')}
                  className={`gap-2 text-xs ${executionMode === 'sequential' ? 'exec-mode-selected' : ''}`}
                >
                  <ListOrderedIcon className="w-3.5 h-3.5" />
                  Sequential
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onExecutionModeChange('parallel')}
                  className={`gap-2 text-xs ${executionMode === 'parallel' ? 'exec-mode-selected' : ''}`}
                >
                  <LayersIcon className="w-3.5 h-3.5" />
                  Parallel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto">
          {allTasks.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <span className="text-xs text-bronze-500 dark:text-zinc-700">No tasks</span>
            </div>
          ) : (
            allTasks.map((task, idx) => {
              const isSelected = task.id === selectedTaskId;
              const prevTask = idx > 0 ? allTasks[idx - 1] : null;
              const showStatusDivider = prevTask && prevTask.status !== task.status;
              const isRunning = task.agentStatus === 'running';
              const isStarting = task.agentStatus === 'starting';
              const isQueued = task.agentStatus === 'queued';

              return (
                <React.Fragment key={task.id}>
                  {showStatusDivider && (
                    <div className="flex items-center gap-2 mx-3 my-1 py-1">
                      <div className="flex-1 h-px bg-bronze-300/40 dark:bg-zinc-800/60" />
                      <div className="flex items-center gap-1.5">
                        {getStatusIcon(task.status)}
                        <span className="text-[10px] text-bronze-500 dark:text-zinc-600 font-medium uppercase tracking-wide">
                          {COLUMNS.find((c) => c.id === task.status)?.label}
                        </span>
                      </div>
                      <div className="flex-1 h-px bg-bronze-300/40 dark:bg-zinc-800/60" />
                    </div>
                  )}
                  <button
                    onClick={() => handleRowClick(task)}
                    className={`w-full text-left px-3 py-2.5 transition-colors ${
                      isSelected
                        ? 'bg-bronze-200/60 dark:bg-zinc-800'
                        : 'hover:bg-bronze-100/60 dark:hover:bg-zinc-900/60'
                    }`}
                  >
                    {/* Title */}
                    <div className={`text-sm leading-snug truncate ${
                      task.title
                        ? 'text-bronze-800 dark:text-zinc-200'
                        : 'text-bronze-500 dark:text-zinc-500 italic'
                    }`}>
                      {task.title || task.description.slice(0, 60) || 'Untitled'}
                    </div>

                    {/* Description snippet */}
                    {task.description && (
                      <p className="text-xs text-bronze-600 dark:text-zinc-500 leading-relaxed mt-1 line-clamp-2">
                        {task.title ? task.description : ''}
                      </p>
                    )}

                    {/* Footer: status + agent indicator */}
                    <div className="flex items-center gap-1.5 mt-2">
                      {isQueued ? (
                        <>
                          <ClockIcon className="w-3 h-3 text-zinc-400" />
                          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wide">Queued</span>
                        </>
                      ) : isRunning ? (
                        <>
                          <Loader2Icon className="w-3 h-3 text-steel animate-spin" />
                          <span className="text-[10px] text-steel font-medium uppercase tracking-wide">Agent working</span>
                        </>
                      ) : isStarting ? (
                        <>
                          <Loader2Icon className="w-3 h-3 text-zinc-400 animate-spin" />
                          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wide">Starting...</span>
                        </>
                      ) : (
                        <>
                          <span className="shrink-0">{getStatusIcon(task.status)}</span>
                          <span className="text-[10px] text-bronze-500 dark:text-zinc-500 font-medium uppercase tracking-wide">
                            {COLUMNS.find((c) => c.id === task.status)?.label}
                          </span>
                        </>
                      )}
                    </div>
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        className="shrink-0 w-px cursor-col-resize bg-bronze-300 dark:bg-zinc-800 hover:bg-bronze-400 dark:hover:bg-bronze-600 transition-colors relative"
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      </div>

      {/* Detail panel */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {!selectedTask ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-sm text-bronze-500 dark:text-zinc-600">Select a task</span>
          </div>
        ) : (
          <div className="flex-1 relative bg-bronze-50 dark:bg-[#141414]">
            <TaskAgentDetail
              task={selectedTask}
              projectId={projectId}
              isQueued={selectedTask.agentStatus === 'queued'}
              cleanupExpiresAt={cleanupTimes[selectedTask.id]}
              followUpDraft={followUpDraftsRef?.current.get(selectedTask.id)}
              onFollowUpDraftChange={onFollowUpDraftChange ? (draft) => onFollowUpDraftChange(selectedTask.id, draft) : undefined}
              onComplete={onComplete}
              onResumeEditing={onResumeEditing}
              onUpdateTitle={onUpdateTitle}
              parallelMode={parallelMode}
              currentBranch={currentBranch}
              onSwitchBranch={onSwitchBranch}
            />
          </div>
        )}
      </div>
    </div>
  );
}
