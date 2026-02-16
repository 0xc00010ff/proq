'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
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
  ChevronDownIcon,
} from 'lucide-react';
import type { Task, TaskStatus, ExecutionMode } from '@/lib/types';
import { TaskCard } from './TaskCard';

interface KanbanBoardProps {
  tasks: Task[];
  onReorderTasks: (reordered: Task[]) => void;
  onAddTask?: () => void;
  onDeleteTask?: (taskId: string) => void;
  onClickTask?: (task: Task) => void;
  onRefreshTasks?: () => void;
  executionMode?: ExecutionMode;
  onExecutionModeChange?: (mode: ExecutionMode) => void;
  dispatchedTaskIds?: Set<string>;
}

const COLUMNS: { id: TaskStatus; label: string; icon: React.ReactNode }[] = [
  { id: 'todo', label: 'To Do', icon: <CircleDotIcon className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" /> },
  { id: 'in-progress', label: 'In Progress', icon: <RefreshCwIcon className="w-3.5 h-3.5 text-blue-400" /> },
  { id: 'verify', label: 'Verify', icon: <SearchCheckIcon className="w-3.5 h-3.5 text-amber-400" /> },
  { id: 'done', label: 'Done', icon: <CheckCircle2Icon className="w-3.5 h-3.5 text-green-400" /> },
];

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

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 flex flex-col min-w-[240px] rounded-lg transition-colors ${
        isOver ? 'bg-warm-200/50 dark:bg-zinc-900/50 ring-2 ring-blue-500/20' : 'bg-transparent'
      }`}
    >
      {children}
    </div>
  );
}

function SortableTaskCard({
  task,
  isQueued,
  onDelete,
  onClick,
}: {
  task: Task;
  isQueued?: boolean;
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
      <TaskCard task={task} isQueued={isQueued} onDelete={onDelete} onClick={onClick} />
    </div>
  );
}

export function KanbanBoard({
  tasks,
  onReorderTasks,
  onAddTask,
  onDeleteTask,
  onClickTask,
  onRefreshTasks,
  executionMode = 'sequential',
  onExecutionModeChange,
  dispatchedTaskIds,
}: KanbanBoardProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [localTasks, setLocalTasks] = useState<Task[] | null>(null);
  const pendingCommitRef = useRef<Task[] | null>(null);
  const [pendingRerun, setPendingRerun] = useState<{ finalTasks: Task[]; taskTitle: string } | null>(null);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!modeDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(e.target as Node)) {
        setModeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modeDropdownOpen]);

  // Clear localTasks once the parent props reflect the committed drag result
  useEffect(() => {
    if (pendingCommitRef.current && localTasks) {
      // Parent props updated after our commit — safe to drop local override
      pendingCommitRef.current = null;
      setLocalTasks(null);
    }
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  const workingTasks = localTasks ?? tasks;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const activeDragTask = activeDragId ? workingTasks.find((t) => t.id === activeDragId) : null;

  const columnTasks = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      'todo': [],
      'in-progress': [],
      'verify': [],
      'done': [],
    };
    for (const task of workingTasks) {
      map[task.status]?.push(task);
    }
    return map;
  }, [workingTasks]);

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(event.active.id as string);
    const node = event.active.rect.current.initial;
    if (node) {
      setDragWidth(node.width);
    }
    setLocalTasks([...tasks]);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !localTasks) return;

    const activeId = active.id as string;
    const overId = over.id as string;
    const activeTask = localTasks.find((t) => t.id === activeId);
    if (!activeTask) return;

    // Determine which column is being hovered
    const isOverColumn = COLUMNS.some((c) => c.id === overId);
    let targetStatus: TaskStatus;

    if (isOverColumn) {
      targetStatus = overId as TaskStatus;
    } else {
      const overTask = localTasks.find((t) => t.id === overId);
      if (!overTask) return;
      targetStatus = overTask.status;
    }

    setOverColumnId(targetStatus);

    if (activeTask.status !== targetStatus) {
      // Moving to a different column
      setLocalTasks((prev) => {
        if (!prev) return prev;
        return prev.map((t) =>
          t.id === activeId ? { ...t, status: targetStatus, order: -1 } : t
        );
      });
    } else if (!isOverColumn) {
      // Reordering within same column
      const colTasks = localTasks.filter((t) => t.status === targetStatus);
      const oldIndex = colTasks.findIndex((t) => t.id === activeId);
      const newIndex = colTasks.findIndex((t) => t.id === overId);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const reordered = arrayMove(colTasks, oldIndex, newIndex);
        // Assign new order values
        const orderMap = new Map<string, number>();
        reordered.forEach((t, i) => orderMap.set(t.id, i));

        setLocalTasks((prev) => {
          if (!prev) return prev;
          return prev.map((t) => {
            if (t.status === targetStatus && orderMap.has(t.id)) {
              return { ...t, order: orderMap.get(t.id)! };
            }
            return t;
          });
        });
      }
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active } = event;
    setActiveDragId(null);
    setOverColumnId(null);
    setDragWidth(null);

    if (!localTasks) {
      setLocalTasks(null);
      return;
    }

    const activeId = active.id as string;
    const activeTask = localTasks.find((t) => t.id === activeId);
    if (!activeTask) {
      setLocalTasks(null);
      return;
    }

    // Finalize order for the target column
    const targetStatus = activeTask.status;
    const colTasks = localTasks
      .filter((t) => t.status === targetStatus)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Assign clean sequential orders
    const finalTasks = localTasks.map((t) => {
      if (t.status === targetStatus) {
        const idx = colTasks.findIndex((ct) => ct.id === t.id);
        return { ...t, order: idx };
      }
      return t;
    });

    // Check if a task is being rerun (verify/done → in-progress)
    const rerunTask = finalTasks.find((t) => {
      const original = tasks.find((ot) => ot.id === t.id);
      return original && (original.status === 'verify' || original.status === 'done') && t.status === 'in-progress';
    });

    if (rerunTask) {
      // Snap card back visually and show confirmation dialog
      setLocalTasks(null);
      setPendingRerun({ finalTasks, taskTitle: rerunTask.title });
      return;
    }

    // Check if any task moved into in-progress
    const movedToInProgress = finalTasks.some((t) => {
      const original = tasks.find((ot) => ot.id === t.id);
      return original && original.status !== 'in-progress' && t.status === 'in-progress';
    });

    // Keep localTasks as optimistic state until parent props catch up
    setLocalTasks(finalTasks);
    pendingCommitRef.current = finalTasks;
    onReorderTasks(finalTasks);

    // If a task moved to in-progress, refresh after API settles to pick up locked state
    if (movedToInProgress && onRefreshTasks) {
      setTimeout(onRefreshTasks, 500);
    }
  }

  function handleDragCancel() {
    setActiveDragId(null);
    setOverColumnId(null);
    setDragWidth(null);
    setLocalTasks(null);
  }

  return (
    <div className="flex-1 h-full overflow-x-auto bg-warm-100 dark:bg-zinc-950">
      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex h-full min-w-[1000px] px-6 pt-6 space-x-4">
          {COLUMNS.map((column) => {
            const colTasks = columnTasks[column.id].sort(
              (a, b) => (a.order ?? 0) - (b.order ?? 0)
            );
            const isOver = overColumnId === column.id;
            const taskIds = colTasks.map((t) => t.id);

            return (
              <DroppableColumn key={column.id} id={column.id} isOver={isOver}>
                <div className="flex items-center justify-between mb-4 px-1">
                  <div className="flex items-center gap-2">
                    {column.icon}
                    <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{column.label}</h3>
                    {column.id === 'in-progress' && onExecutionModeChange && (
                      <div className="relative" ref={modeDropdownRef}>
                        <button
                          onClick={() => setModeDropdownOpen(!modeDropdownOpen)}
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
                        {modeDropdownOpen && (
                          <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-xl z-50 min-w-[140px]">
                            <button
                              onClick={() => { onExecutionModeChange('sequential'); setModeDropdownOpen(false); }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-zinc-700 transition-colors ${executionMode === 'sequential' ? 'text-blue-400' : 'text-zinc-300'}`}
                            >
                              <ListOrderedIcon className="w-3.5 h-3.5" />
                              Sequential
                            </button>
                            <button
                              onClick={() => { onExecutionModeChange('parallel'); setModeDropdownOpen(false); }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-zinc-700 transition-colors ${executionMode === 'parallel' ? 'text-blue-400' : 'text-zinc-300'}`}
                            >
                              <LayersIcon className="w-3.5 h-3.5" />
                              Parallel
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-warm-200 dark:bg-zinc-900 border border-warm-300 dark:border-zinc-800 text-xs text-warm-600 font-mono">
                    {colTasks.length}
                  </span>
                </div>

                <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
                  <div className="flex-1 space-y-3 overflow-y-auto pb-4 px-1 min-h-[80px]">
                    {colTasks.map((task) => {
                      const isQueued = column.id === 'in-progress' && task.locked && dispatchedTaskIds != null && !dispatchedTaskIds.has(task.id);
                      return (
                        <SortableTaskCard
                          key={task.id}
                          task={task}
                          isQueued={isQueued}
                          onDelete={onDeleteTask}
                          onClick={onClickTask}
                        />
                      );
                    })}

                    {colTasks.length === 0 && (
                      <div className="h-24 border-2 border-dashed border-warm-300 dark:border-zinc-900 rounded-lg flex items-center justify-center">
                        <span className="text-xs text-warm-500 dark:text-zinc-700">Empty</span>
                      </div>
                    )}

                    {column.id === 'todo' && onAddTask && (
                      <button
                        onClick={onAddTask}
                        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-warm-200 dark:bg-zinc-800/30 border border-warm-300 dark:border-zinc-800 hover:bg-warm-300 dark:hover:bg-zinc-900 hover:border-warm-400 dark:hover:border-zinc-700 text-warm-600 hover:text-warm-700 dark:hover:text-zinc-300 text-xs"
                      >
                        <PlusIcon className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
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
              <TaskCard task={activeDragTask} isDragOverlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {pendingRerun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-sm font-medium text-zinc-100 mb-2">Re-run task?</h3>
            <p className="text-xs text-zinc-400 mb-5">
              This will launch a new Claude Code agent for{' '}
              <span className="text-zinc-200 font-medium">&ldquo;{pendingRerun.taskTitle}&rdquo;</span>.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingRerun(null)}
                className="px-3 py-1.5 text-xs rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const { finalTasks } = pendingRerun;
                  setPendingRerun(null);
                  setLocalTasks(finalTasks);
                  pendingCommitRef.current = finalTasks;
                  onReorderTasks(finalTasks);
                  if (onRefreshTasks) {
                    setTimeout(onRefreshTasks, 500);
                  }
                }}
                className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
