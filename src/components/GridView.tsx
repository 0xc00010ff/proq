'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  PlusIcon,
  ListOrderedIcon,
  LayersIcon,
  ChevronDownIcon,
  Maximize2Icon,
  RefreshCwIcon,
  SearchCheckIcon,
  GitBranchIcon,
} from 'lucide-react';
import type { Task, TaskColumns, ExecutionMode, FollowUpDraft } from '@/lib/types';
import { StructuredPane } from './StructuredPane';
import { TerminalPane } from './TerminalPane';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

interface GridViewProps {
  tasks: TaskColumns;
  projectId: string;
  executionMode?: ExecutionMode;
  onExecutionModeChange?: (mode: ExecutionMode) => void;
  onAddTask?: () => void;
  onClickTask?: (task: Task) => void;
  followUpDraftsRef?: React.MutableRefObject<Map<string, FollowUpDraft>>;
  onFollowUpDraftChange?: (taskId: string, draft: FollowUpDraft | null) => void;
  parallelMode?: boolean;
  currentBranch?: string;
  onSwitchBranch?: (branch: string) => void;
  defaultBranch?: string;
}

// Compute grid layout based on task count and container width
function getGridLayout(count: number, containerWidth: number): { cols: number; rows: number; spans?: number[] } {
  if (count <= 0) return { cols: 1, rows: 1 };
  if (count === 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count === 3) {
    // If too narrow, use 2 cols top + 1 spanning bottom
    if (containerWidth < 600) return { cols: 2, rows: 2, spans: [1, 1, 2] };
    return { cols: 3, rows: 1 };
  }
  if (count === 4) return { cols: 2, rows: 2 };
  if (count === 5) return { cols: 3, rows: 2, spans: [1, 1, 1, 1, 2] };
  // 6+
  return { cols: 3, rows: 2 };
}

function StatusDot({ status }: { status: string }) {
  if (status === 'in-progress') {
    return <RefreshCwIcon className="w-3 h-3 text-bronze-500 animate-[spin_3s_linear_infinite]" />;
  }
  if (status === 'verify') {
    return <SearchCheckIcon className="w-3 h-3 text-lazuli" />;
  }
  return null;
}

function GridCell({
  task,
  projectId,
  onExpand,
  followUpDraft,
  onFollowUpDraftChange,
  parallelMode,
  currentBranch,
  onSwitchBranch,
  defaultBranch,
}: {
  task: Task;
  projectId: string;
  onExpand: () => void;
  followUpDraft?: FollowUpDraft;
  onFollowUpDraftChange?: (draft: FollowUpDraft | null) => void;
  parallelMode?: boolean;
  currentBranch?: string;
  onSwitchBranch?: (branch: string) => void;
  defaultBranch?: string;
}) {
  const isStructured = task.renderMode !== 'cli';
  const terminalTabId = `task-${task.id.slice(0, 8)}`;
  const isPreviewActive = task.branch && currentBranch === task.branch;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-surface-deep">
      {/* Top nav bar */}
      <div className="shrink-0 h-9 flex items-center gap-2 px-3 border-b border-border-default bg-surface-topbar">
        <StatusDot status={task.status} />
        <span className="flex-1 text-xs font-medium text-text-secondary truncate">
          {task.title}
        </span>
        {/* Branch indicator */}
        {task.branch ? (
          isPreviewActive ? (
            <>
              <span className="shrink-0 text-[10px] font-medium text-lazuli">viewing</span>
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border border-lazuli/30 bg-lazuli/10 text-lazuli">
                <GitBranchIcon className="w-2.5 h-2.5" />
                {task.branch}
              </span>
            </>
          ) : onSwitchBranch ? (
            <button
              onClick={() => onSwitchBranch(task.branch!)}
              title={`Preview branch ${task.branch}`}
              className="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border border-border-hover/40 bg-surface-hover/60 text-text-chrome hover:border-lazuli/30 hover:text-lazuli"
            >
              <GitBranchIcon className="w-2.5 h-2.5" />
              {task.branch}
            </button>
          ) : (
            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border border-border-hover/40 bg-surface-hover/60 text-text-tertiary">
              <GitBranchIcon className="w-2.5 h-2.5" />
              {task.branch}
            </span>
          )
        ) : (
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border border-border-hover/40 bg-surface-hover/60 text-text-tertiary">
            <GitBranchIcon className="w-2.5 h-2.5" />
            {defaultBranch || 'main'}
          </span>
        )}
        <button
          onClick={onExpand}
          className="shrink-0 p-1 rounded hover:bg-surface-hover text-text-tertiary hover:text-text-secondary"
          title={`Open full details for ${task.title || 'task'}`}
        >
          <Maximize2Icon className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* Agent output area */}
      <div className="flex-1 min-h-0 flex flex-col">
        {isStructured ? (
          <StructuredPane
            taskId={task.id}
            projectId={projectId}
            visible={true}
            taskStatus={task.status}
            followUpDraft={followUpDraft}
            onFollowUpDraftChange={onFollowUpDraftChange}
          />
        ) : (
          <TerminalPane tabId={terminalTabId} visible={true} enableDrop />
        )}
      </div>
    </div>
  );
}

export function GridView({
  tasks,
  projectId,
  executionMode = 'sequential',
  onExecutionModeChange,
  onAddTask,
  onClickTask,
  followUpDraftsRef,
  onFollowUpDraftChange,
  parallelMode,
  currentBranch,
  onSwitchBranch,
  defaultBranch,
}: GridViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // Observe container width for responsive layout
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Filter to active tasks (in-progress + verify), sorted by createdAt descending (newest first = top-left)
  const activeTasks = useMemo(() => {
    return [
      ...tasks['in-progress'],
      ...tasks.verify,
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [tasks]);

  const layout = getGridLayout(activeTasks.length, containerWidth);
  // Limit to 6 (2 rows x 3 cols max)
  const visibleTasks = activeTasks.slice(0, 6);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top toolbar */}
      <div className="shrink-0 h-10 flex items-center gap-3 px-4 border-b border-border-default bg-surface-topbar">
        {onAddTask && (
          <button
            onClick={onAddTask}
            title="Create a new task"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-tertiary hover:text-text-secondary hover:bg-surface-hover border border-border-default"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        )}

        {onExecutionModeChange && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button title="Switch execution mode" className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium text-text-tertiary hover:text-text-secondary hover:bg-surface-hover">
                {executionMode === 'sequential' ? (
                  <ListOrderedIcon className="w-3 h-3" />
                ) : (
                  <LayersIcon className="w-3 h-3" />
                )}
                <span>{executionMode === 'sequential' ? 'Sequential' : 'Parallel'}</span>
                <ChevronDownIcon className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="exec-mode-dropdown min-w-[140px]">
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

        <span className="text-[10px] text-text-tertiary font-mono">
          {activeTasks.length} active
        </span>
      </div>

      {/* Grid area */}
      <div ref={containerRef} className="flex-1 min-h-0">
        {visibleTasks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
            No active tasks. Move a task to In Progress to see it here.
          </div>
        ) : (
          <div
            className="grid h-full gap-px bg-border-default"
            style={{
              gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
              gridTemplateRows: layout.rows > 1 ? `repeat(${layout.rows}, 1fr)` : '1fr',
            }}
          >
            {visibleTasks.map((task, i) => {
              // Handle spanning for odd layouts
              const span = layout.spans?.[i];
              const style: React.CSSProperties = {};
              if (span && span > 1) {
                style.gridColumn = `span ${span}`;
              }
              return (
                <div key={task.id} style={style} className="min-h-0 h-full">
                  <GridCell
                    task={task}
                    projectId={projectId}
                    onExpand={() => onClickTask?.(task)}
                    followUpDraft={followUpDraftsRef?.current.get(task.id)}
                    onFollowUpDraftChange={onFollowUpDraftChange ? (draft) => onFollowUpDraftChange(task.id, draft) : undefined}
                    parallelMode={parallelMode}
                    currentBranch={currentBranch}
                    onSwitchBranch={onSwitchBranch}
                    defaultBranch={defaultBranch}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
