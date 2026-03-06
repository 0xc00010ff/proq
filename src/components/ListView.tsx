'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  rectIntersection,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ListOrderedIcon,
  LayersIcon,
  ChevronDownIcon,
  Loader2Icon,
  ClockIcon,
  Trash2Icon,
} from 'lucide-react';
import type { Task, TaskStatus, TaskColumns, ExecutionMode, FollowUpDraft } from '@/lib/types';
import { COLUMNS, AddTaskButton } from './KanbanBoard';
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
  onMoveTask?: (taskId: string, toColumn: TaskStatus, toIndex: number) => void;
  onDragActiveChange?: (active: boolean) => void;
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

const MASTER_WIDTH_KEY = 'proq-list-master-width';
const DEFAULT_MASTER_WIDTH = 400;
const MIN_MASTER_WIDTH = 200;
const MAX_MASTER_WIDTH = 600;

function deepCopyColumns(cols: TaskColumns): TaskColumns {
  return {
    "todo": cols.todo.map((t) => ({ ...t })),
    "in-progress": cols["in-progress"].map((t) => ({ ...t })),
    "verify": cols.verify.map((t) => ({ ...t })),
    "done": cols.done.map((t) => ({ ...t })),
  };
}

function findTaskColumn(columns: TaskColumns, taskId: string): TaskStatus | null {
  for (const status of ["todo", "in-progress", "verify", "done"] as TaskStatus[]) {
    if (columns[status].some((t) => t.id === taskId)) return status;
  }
  return null;
}

function DroppableSection({
  id,
  isOver,
  children,
}: {
  id: string;
  isOver: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id });
  const isInProgress = id === 'in-progress';

  return (
    <div
      ref={setNodeRef}
      className={`rounded-md ${
        isOver
          ? isInProgress
            ? 'bg-steel/5 ring-1 ring-steel/20'
            : 'bg-surface-hover/40 ring-1 ring-zinc-600/30'
          : ''
      }`}
    >
      {children}
    </div>
  );
}

function SortableListRow({
  task,
  isSelected,
  col,
  onClick,
  onDelete,
}: {
  task: Task;
  isSelected: boolean;
  col: typeof COLUMNS[number] | undefined;
  onClick: (task: Task) => void;
  onDelete?: (taskId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isRunning = task.agentStatus === 'running';
  const isStarting = task.agentStatus === 'starting';
  const isQueued = task.agentStatus === 'queued';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`group cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-30' : ''}`}
    >
      <button
        onClick={() => onClick(task)}
        className={`relative w-full text-left px-6 py-2.5 ${
          isSelected
            ? 'bg-surface-selected'
            : 'hover:bg-surface-hover/40'
        }`}
      >
        {onDelete && (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(task.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                onDelete(task.id);
              }
            }}
            className="absolute top-2 right-2 p-1 rounded text-text-chrome hover:text-crimson hover:bg-surface-hover opacity-0 group-hover:opacity-100 transition-opacity z-10"
          >
            <Trash2Icon className="w-3.5 h-3.5" />
          </div>
        )}

        {/* Title */}
        <div className={`text-sm leading-snug truncate ${
          task.title
            ? 'text-text-primary'
            : 'text-text-tertiary italic'
        }`}>
          {task.title || task.description.slice(0, 60) || 'Untitled'}
        </div>

        {/* Description snippet */}
        {task.title && task.description && (
          <p className="text-xs text-text-tertiary leading-relaxed mt-1 line-clamp-2">
            {task.description}
          </p>
        )}

        {/* Footer: status + agent indicator + task ID */}
        <div className="flex items-center mt-2">
          {isQueued ? (
            <div className="flex items-center gap-1.5">
              <ClockIcon className="w-3 h-3 text-text-secondary" />
              <span className="text-[10px] text-text-secondary font-medium uppercase tracking-wide">Queued</span>
            </div>
          ) : isRunning ? (
            <div className="flex items-center gap-1.5">
              <Loader2Icon className="w-3 h-3 text-steel animate-spin" />
              <span className="text-[10px] text-steel font-medium uppercase tracking-wide">Agent working</span>
            </div>
          ) : isStarting ? (
            <div className="flex items-center gap-1.5">
              <Loader2Icon className="w-3 h-3 text-text-secondary animate-spin" />
              <span className="text-[10px] text-text-secondary font-medium uppercase tracking-wide">Starting...</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              {col?.icon}
              <span className="text-[10px] text-text-tertiary font-medium uppercase tracking-wide">
                {col?.label}
              </span>
            </div>
          )}
          <span className="ml-auto text-[10px] text-text-tertiary font-mono">
            {task.id.slice(0, 8)}
          </span>
        </div>
      </button>
    </div>
  );
}

export function ListView({
  tasks,
  projectId,
  onAddTask,
  onDeleteTask,
  onClickTask,
  onMoveTask,
  onDragActiveChange,
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

  // Drag-and-drop state
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [localColumns, setLocalColumns] = useState<TaskColumns | null>(null);
  const pendingCommitRef = useRef<boolean>(false);
  const lastOverIdRef = useRef<string | null>(null);
  const [pendingRerun, setPendingRerun] = useState<{ taskId: string; toColumn: TaskStatus; toIndex: number; taskTitle: string } | null>(null);

  // Clear localColumns once parent props reflect the committed drag result
  useEffect(() => {
    if (pendingCommitRef.current && localColumns) {
      pendingCommitRef.current = false;
      setLocalColumns(null);
    }
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = localColumns ?? tasks;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const allTasks = STATUS_ORDER.flatMap((s) => columns[s]);
  const selectedTask = selectedTaskId ? allTasks.find((t) => t.id === selectedTaskId) : null;

  // Keep selection in sync when tasks update via SSE
  useEffect(() => {
    if (selectedTaskId && !allTasks.find((t) => t.id === selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [allTasks, selectedTaskId]);

  // Find the active drag task
  const activeDragTask = activeDragId
    ? (() => {
        for (const col of Object.values(columns)) {
          const t = col.find((t) => t.id === activeDragId);
          if (t) return t;
        }
        return null;
      })()
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(event.active.id as string);
    setLocalColumns(deepCopyColumns(tasks));
    onDragActiveChange?.(true);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !localColumns) return;
    if (over.id === lastOverIdRef.current) return;
    lastOverIdRef.current = over.id as string;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeColumn = findTaskColumn(localColumns, activeId);
    if (!activeColumn) return;

    // Determine target column
    const isOverColumn = STATUS_ORDER.includes(overId as TaskStatus);
    let targetStatus: TaskStatus;

    if (isOverColumn) {
      targetStatus = overId as TaskStatus;
    } else {
      const overCol = findTaskColumn(localColumns, overId);
      if (!overCol) return;
      targetStatus = overCol;
    }

    setOverColumnId(targetStatus);

    if (activeColumn !== targetStatus) {
      // Moving to a different column
      setLocalColumns((prev) => {
        if (!prev) return prev;
        const srcCol = [...prev[activeColumn]];
        const srcIdx = srcCol.findIndex((t) => t.id === activeId);
        if (srcIdx === -1) return prev;

        const [task] = srcCol.splice(srcIdx, 1);
        task.status = targetStatus;

        const destCol = [...prev[targetStatus]];
        if (!isOverColumn) {
          const overIdx = destCol.findIndex((t) => t.id === overId);
          destCol.splice(overIdx >= 0 ? overIdx : destCol.length, 0, task);
        } else {
          destCol.push(task);
        }

        return { ...prev, [activeColumn]: srcCol, [targetStatus]: destCol };
      });
    } else if (!isOverColumn) {
      // Reordering within same column
      setLocalColumns((prev) => {
        if (!prev) return prev;
        const colTasks = [...prev[targetStatus]];
        const oldIndex = colTasks.findIndex((t) => t.id === activeId);
        const newIndex = colTasks.findIndex((t) => t.id === overId);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return prev;

        return { ...prev, [targetStatus]: arrayMove(colTasks, oldIndex, newIndex) };
      });
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active } = event;
    setActiveDragId(null);
    setOverColumnId(null);
    lastOverIdRef.current = null;
    onDragActiveChange?.(false);

    if (!localColumns || !onMoveTask) {
      setLocalColumns(null);
      return;
    }

    const activeId = active.id as string;
    const toColumn = findTaskColumn(localColumns, activeId);
    if (!toColumn) {
      setLocalColumns(null);
      return;
    }

    const toIndex = localColumns[toColumn].findIndex((t) => t.id === activeId);
    const fromColumn = findTaskColumn(tasks, activeId);

    // Check if task is being rerun (verify/done → in-progress)
    if (fromColumn && (fromColumn === 'verify' || fromColumn === 'done') && toColumn === 'in-progress') {
      const task = localColumns[toColumn][toIndex];
      setLocalColumns(null);
      setPendingRerun({ taskId: activeId, toColumn, toIndex, taskTitle: task.title || task.description.slice(0, 40) });
      return;
    }

    // Set "Starting..." on the task before committing so it shows immediately
    if (fromColumn !== toColumn && toColumn === 'in-progress') {
      setLocalColumns((prev) => {
        if (!prev) return prev;
        const col = [...prev[toColumn]];
        const idx = col.findIndex((t) => t.id === activeId);
        if (idx === -1) return prev;
        col[idx] = { ...col[idx], agentStatus: 'starting' };
        return { ...prev, [toColumn]: col };
      });
    }

    // Commit
    pendingCommitRef.current = true;
    onMoveTask(activeId, toColumn, toIndex);
  }

  function handleDragCancel() {
    setActiveDragId(null);
    setOverColumnId(null);
    lastOverIdRef.current = null;
    setLocalColumns(null);
    onDragActiveChange?.(false);
  }

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
    <div className="flex-1 h-full flex overflow-hidden bg-surface-topbar">
      {/* Master panel */}
      <div data-master-panel className="shrink-0 flex flex-col border-r border-border-default bg-surface-topbar" style={{ width: masterWidth }}>
        {/* Master header */}
        <div className="shrink-0 h-10 flex items-center gap-2 px-6 border-b border-border-default bg-surface-topbar">
          {onExecutionModeChange && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium text-text-tertiary hover:text-text-secondary hover:bg-surface-hover"
                >
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
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={rectIntersection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {STATUS_ORDER.map((status) => {
              const col = COLUMNS.find((c) => c.id === status);
              const statusTasks = columns[status];
              const taskIds = statusTasks.map((t) => t.id);
              const isOver = overColumnId === status;

              return (
                <React.Fragment key={status}>
                  {status === 'todo' && onAddTask && (
                    <div className="px-6 mt-4 mb-2">
                      <AddTaskButton onClick={onAddTask} />
                    </div>
                  )}

                <DroppableSection id={status} isOver={isOver}>
                  {/* Section header — always shown */}
                  <div className="flex items-center gap-2 mx-6 my-2 py-1">
                    <div className="flex-1 h-px bg-border-default/60" />
                    <div className="flex items-center gap-1.5">
                      {col?.icon}
                      <span className="text-[10px] text-text-tertiary font-medium uppercase tracking-wide">
                        {col?.label}
                      </span>
                      <span className="text-[10px] text-text-placeholder font-mono">
                        {statusTasks.length}
                      </span>
                    </div>
                    <div className="flex-1 h-px bg-border-default/60" />
                  </div>

                  <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
                    {statusTasks.length === 0 && (
                      <div className="mx-6 my-2 h-14 border border-dashed border-border-default rounded-md flex items-center justify-center">
                        <span className="text-[10px] text-text-placeholder">Empty</span>
                      </div>
                    )}

                    {statusTasks.map((task) => (
                      <SortableListRow
                        key={task.id}
                        task={task}
                        isSelected={task.id === selectedTaskId}
                        col={col}
                        onClick={handleRowClick}
                        onDelete={onDeleteTask}
                      />
                    ))}
                  </SortableContext>
                </DroppableSection>
                </React.Fragment>
              );
            })}

            <DragOverlay>
              {activeDragTask ? (
                <div className="bg-surface-modal border border-border-default rounded-md px-3 py-2 shadow-xl max-w-[350px]">
                  <div className="text-sm text-text-primary truncate">
                    {activeDragTask.title || activeDragTask.description.slice(0, 60) || 'Untitled'}
                  </div>
                  {activeDragTask.title && activeDragTask.description && (
                    <p className="text-xs text-text-tertiary mt-1 truncate">
                      {activeDragTask.description.slice(0, 80)}
                    </p>
                  )}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        className="shrink-0 w-px cursor-col-resize bg-border-default hover:bg-border-hover transition-colors relative"
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      </div>

      {/* Detail panel */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {!selectedTask ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-sm text-text-tertiary">Select a task</span>
          </div>
        ) : (
          <div className="flex-1 relative bg-surface-topbar">
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

      {pendingRerun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-modal border border-border-default rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-sm font-medium text-text-primary mb-2">Move back to In Progress?</h3>
            <p className="text-xs text-text-secondary mb-5">
              <span className="text-text-primary font-medium">&ldquo;{pendingRerun.taskTitle}&rdquo;</span>{' '}
              will return to In Progress without changes. The current agent session will continue as-is.
              To reset and start fresh, move the task to Todo first.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingRerun(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!onMoveTask) return;
                  const { taskId, toColumn, toIndex } = pendingRerun;
                  setPendingRerun(null);
                  pendingCommitRef.current = true;
                  onMoveTask(taskId, toColumn, toIndex);
                }}
                className="btn-primary"
              >
                Move to In Progress
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
