'use client';

import React, { useState, useRef, useEffect } from 'react';
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
  CircleDotIcon,
  RefreshCwIcon,
  SearchCheckIcon,
  CheckCircle2Icon,
  PlusIcon,
  ListOrderedIcon,
  LayersIcon,
  GitBranchIcon,
  ChevronDownIcon,
} from 'lucide-react';
import type { Task, TaskStatus, TaskColumns, ExecutionMode, Agent } from '@/lib/types';
import { TaskCard } from './TaskCard';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

interface KanbanBoardProps {
  tasks: TaskColumns;
  onMoveTask: (taskId: string, toColumn: TaskStatus, toIndex: number) => void;
  onAddTask?: () => void;
  onDeleteTask?: (taskId: string) => void;
  onClickTask?: (task: Task) => void;
  onRefreshTasks?: () => void;
  executionMode?: ExecutionMode;
  onExecutionModeChange?: (mode: ExecutionMode) => void;
  onDragActiveChange?: (active: boolean) => void;
  activeBranch?: string;
  agentMap?: Map<string, Agent>;
}

export const COLUMNS: { id: TaskStatus; label: string; icon: React.ReactNode }[] = [
  { id: 'todo', label: 'To Do', icon: <CircleDotIcon className="w-3.5 h-3.5 text-text-tertiary" /> },
  { id: 'in-progress', label: 'In Progress', icon: <RefreshCwIcon className="w-3.5 h-3.5 text-bronze-500" /> },
  { id: 'verify', label: 'Verify', icon: <SearchCheckIcon className="w-3.5 h-3.5 text-lazuli" /> },
  { id: 'done', label: 'Done', icon: <CheckCircle2Icon className="w-3.5 h-3.5 text-emerald" /> },
];

function deepCopyColumns(cols: TaskColumns): TaskColumns {
  return {
    "todo": cols.todo.map((t) => ({ ...t })),
    "in-progress": cols["in-progress"].map((t) => ({ ...t })),
    "verify": cols.verify.map((t) => ({ ...t })),
    "done": cols.done.map((t) => ({ ...t })),
  };
}

export function AddTaskButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-surface-secondary border border-border-default hover:bg-surface-hover/40 hover:border-border-hover/50 text-text-tertiary dark:text-zinc-500 hover:text-bronze-600 dark:hover:text-bronze-500 text-xs"
    >
      <PlusIcon className="w-3.5 h-3.5" />
      <span>New</span>
    </button>
  );
}

function DroppableColumn({
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
      className={`flex-1 flex flex-col min-w-[240px] rounded-lg ${
        isOver
          ? isInProgress
            ? 'bg-bronze-500/5 ring-2 ring-bronze-500/20'
            : 'bg-surface-hover/30 ring-2 ring-border-hover/30'
          : 'bg-transparent'
      }`}
    >
      {children}
    </div>
  );
}

function SortableTaskCard({
  task,
  isQueued,
  isPreviewActive,
  columnStatus,
  agentMap,
  onDelete,
  onClick,
}: {
  task: Task;
  isQueued?: boolean;
  isPreviewActive?: boolean;
  columnStatus?: string;
  agentMap?: Map<string, Agent>;
  onDelete?: (taskId: string) => void;
  onClick?: (task: Task) => void;
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-30' : ''}`}
    >
      <TaskCard task={task} isQueued={isQueued} isPreviewActive={isPreviewActive} columnStatus={columnStatus} agentMap={agentMap} onDelete={onDelete} onClick={onClick} />
    </div>
  );
}

// Find which column a task is in
function findTaskColumn(columns: TaskColumns, taskId: string): TaskStatus | null {
  for (const status of ["todo", "in-progress", "verify", "done"] as TaskStatus[]) {
    if (columns[status].some((t) => t.id === taskId)) return status;
  }
  return null;
}

export function KanbanBoard({
  tasks,
  onMoveTask,
  onAddTask,
  onDeleteTask,
  onClickTask,
  onRefreshTasks,
  executionMode = 'sequential',
  onExecutionModeChange,
  onDragActiveChange,
  activeBranch,
  agentMap,
}: KanbanBoardProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
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

  // Find the active drag task across all columns
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
    const node = event.active.rect.current.initial;
    if (node) setDragWidth(node.width);
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

    // Determine target column
    const isOverColumn = COLUMNS.some((c) => c.id === overId);
    let targetStatus: TaskStatus;

    if (isOverColumn) {
      targetStatus = overId as TaskStatus;
    } else {
      const overCol = findTaskColumn(localColumns, overId);
      if (!overCol) return;
      targetStatus = overCol;
    }

    setOverColumnId(targetStatus);

    // Only reorder within same column during drag.
    // Cross-column moves happen once in handleDragEnd to avoid @dnd-kit
    // collision-detection oscillation that causes infinite render loops.
    const activeColumn = findTaskColumn(localColumns, activeId);
    if (activeColumn && activeColumn === targetStatus && !isOverColumn) {
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
    const { active, over } = event;
    const targetColumn = overColumnId; // save before clearing
    setActiveDragId(null);
    setOverColumnId(null);
    setDragWidth(null);
    lastOverIdRef.current = null;
    onDragActiveChange?.(false);

    if (!localColumns) {
      setLocalColumns(null);
      return;
    }

    const activeId = active.id as string;
    const fromColumn = findTaskColumn(localColumns, activeId);
    if (!fromColumn) {
      setLocalColumns(null);
      return;
    }

    // Determine target column and index
    const toColumn: TaskStatus = (targetColumn && targetColumn !== fromColumn) ? targetColumn as TaskStatus : fromColumn;
    let toIndex: number;

    if (toColumn === fromColumn) {
      // Same column — localColumns has the reordered position from handleDragOver
      toIndex = localColumns[toColumn].findIndex((t) => t.id === activeId);
    } else {
      // Cross-column — determine insertion index from drop target
      const overId = over?.id as string | undefined;
      const isOverColumn = overId ? COLUMNS.some((c) => c.id === overId) : true;
      if (!isOverColumn && overId) {
        const destCol = localColumns[toColumn as TaskStatus];
        const idx = destCol?.findIndex((t) => t.id === overId) ?? -1;
        toIndex = idx >= 0 ? idx : 0;
      } else {
        toIndex = 0;
      }
    }

    // Find the task for rerun check
    const task = localColumns[fromColumn].find((t) => t.id === activeId);

    // Check if task is being rerun (verify/done → in-progress)
    if ((fromColumn === 'verify' || fromColumn === 'done') && toColumn === 'in-progress') {
      setLocalColumns(null);
      setPendingRerun({ taskId: activeId, toColumn, toIndex, taskTitle: task?.title || task?.description.slice(0, 40) || '' });
      return;
    }

    // Apply cross-column move to localColumns for instant visual feedback
    if (toColumn !== fromColumn) {
      setLocalColumns((prev) => {
        if (!prev) return prev;
        const srcCol = [...prev[fromColumn]];
        const srcIdx = srcCol.findIndex((t) => t.id === activeId);
        if (srcIdx === -1) return prev;
        const [removed] = srcCol.splice(srcIdx, 1);
        const optimisticAgentStatus: 'starting' | 'queued' =
          toColumn === 'in-progress' && executionMode === 'sequential' &&
          prev['in-progress'].some(t => t.id !== removed.id && (t.agentStatus === 'starting' || t.agentStatus === 'running'))
            ? 'queued' : 'starting';
        const moved = { ...removed, status: toColumn, ...(toColumn === 'in-progress' ? { agentStatus: optimisticAgentStatus } : {}) };
        const destCol = [...prev[toColumn]];
        destCol.splice(toIndex, 0, moved);
        return { ...prev, [fromColumn]: srcCol, [toColumn]: destCol };
      });
    }

    // Commit
    pendingCommitRef.current = true;
    onMoveTask(activeId, toColumn, toIndex);
  }

  function handleDragCancel() {
    setActiveDragId(null);
    setOverColumnId(null);
    setDragWidth(null);
    lastOverIdRef.current = null;
    setLocalColumns(null);
    onDragActiveChange?.(false);
  }

  return (
    <div className="flex-1 h-full overflow-x-auto bg-surface-topbar">
      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex h-full min-w-[1200px] px-4 pt-6 space-x-4">
          {COLUMNS.map((column) => {
            const colTasks = columns[column.id];
            const isOver = overColumnId === column.id;
            const taskIds = colTasks.map((t) => t.id);

            return (
              <DroppableColumn key={column.id} id={column.id} isOver={isOver}>
                <div className="flex items-center justify-between mb-4 px-1">
                  <div className="flex items-center gap-2">
                    {column.id === 'in-progress' && colTasks.length > 0
                      ? <RefreshCwIcon className="w-3.5 h-3.5 text-bronze-500 animate-[spin_3s_linear_infinite]" />
                      : column.icon}
                    <h3 className="text-sm font-medium text-text-secondary">{column.label}</h3>
                    {column.id === 'in-progress' && onExecutionModeChange && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium text-text-tertiary hover:text-text-secondary hover:bg-surface-hover"
                          >
                            {executionMode === 'sequential' && <ListOrderedIcon className="w-3 h-3" />}
                            {executionMode === 'parallel' && <LayersIcon className="w-3 h-3" />}
                            {executionMode === 'worktrees' && <GitBranchIcon className="w-3 h-3" />}
                            <span>{executionMode === 'sequential' ? 'Sequential' : executionMode === 'parallel' ? 'Parallel' : 'Worktrees'}</span>
                            <ChevronDownIcon className="w-3 h-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="exec-mode-dropdown min-w-[200px]">
                          <DropdownMenuItem
                            onSelect={() => onExecutionModeChange('sequential')}
                            className={`gap-2 text-xs ${executionMode === 'sequential' ? 'exec-mode-selected' : ''}`}
                          >
                            <ListOrderedIcon className="w-3.5 h-3.5 shrink-0" />
                            <div>
                              <div>Sequential</div>
                              <div className="text-[10px] text-text-tertiary font-normal">One task at a time, queued in order</div>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => onExecutionModeChange('parallel')}
                            className={`gap-2 text-xs ${executionMode === 'parallel' ? 'exec-mode-selected' : ''}`}
                          >
                            <LayersIcon className="w-3.5 h-3.5 shrink-0" />
                            <div>
                              <div>Parallel</div>
                              <div className="text-[10px] text-text-tertiary font-normal">Multiple tasks at once on the same branch</div>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => onExecutionModeChange('worktrees')}
                            className={`gap-2 text-xs ${executionMode === 'worktrees' ? 'exec-mode-selected' : ''}`}
                          >
                            <GitBranchIcon className="w-3.5 h-3.5 shrink-0" />
                            <div>
                              <div>Worktrees</div>
                              <div className="text-[10px] text-text-tertiary font-normal">Each task gets its own branch to preview before merge</div>
                            </div>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-surface-secondary border border-border-default text-xs text-text-tertiary dark:text-zinc-500">
                    {colTasks.length}
                  </span>
                </div>

                <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
                  <div className="flex-1 space-y-3 overflow-y-auto pb-4 px-1 min-h-[80px]">
                    {column.id === 'todo' && onAddTask && (
                      <AddTaskButton onClick={onAddTask} />
                    )}
                    {colTasks.map((task) => {
                      const isQueued = task.agentStatus === 'queued';
                      const isPreviewActive = !!(activeBranch && task.branch && task.branch === activeBranch && activeBranch !== 'main' && activeBranch !== 'master');
                      return (
                        <SortableTaskCard
                          key={task.id}
                          task={task}
                          isQueued={isQueued}
                          isPreviewActive={isPreviewActive}
                          columnStatus={column.id}
                          agentMap={agentMap}
                          onDelete={onDeleteTask}
                          onClick={onClickTask}
                        />
                      );
                    })}

                    {colTasks.length === 0 && (
                      <div className="h-24 border border-dashed border-border-default rounded-lg flex items-center justify-center">
                        <span className="text-xs text-text-placeholder">Empty</span>
                      </div>
                    )}

                  </div>
                </SortableContext>
              </DroppableColumn>
            );
          })}
        </div>

        <DragOverlay>
          {activeDragTask ? (
            <div style={dragWidth ? { width: dragWidth } : undefined}>
              <TaskCard task={activeDragTask} isDragOverlay agentMap={agentMap} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

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
