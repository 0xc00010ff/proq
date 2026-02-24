'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useClickOutside } from '@/hooks/useClickOutside';
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
import type { Task, TaskStatus, TaskColumns, ExecutionMode } from '@/lib/types';
import { TaskCard } from './TaskCard';

interface KanbanBoardProps {
  tasks: TaskColumns;
  onMoveTask: (taskId: string, toColumn: TaskStatus, toIndex: number) => void;
  onAddTask?: () => void;
  onDeleteTask?: (taskId: string) => void;
  onClickTask?: (task: Task) => void;
  onRefreshTasks?: () => void;
  executionMode?: ExecutionMode;
  onExecutionModeChange?: (mode: ExecutionMode) => void;
}

const COLUMNS: { id: TaskStatus; label: string; icon: React.ReactNode }[] = [
  { id: 'todo', label: 'To Do', icon: <CircleDotIcon className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" /> },
  { id: 'in-progress', label: 'In Progress', icon: <RefreshCwIcon className="w-3.5 h-3.5 text-steel" /> },
  { id: 'verify', label: 'Verify', icon: <SearchCheckIcon className="w-3.5 h-3.5 text-gold" /> },
  { id: 'done', label: 'Done', icon: <CheckCircle2Icon className="w-3.5 h-3.5 text-patina" /> },
];

function deepCopyColumns(cols: TaskColumns): TaskColumns {
  return {
    "todo": cols.todo.map((t) => ({ ...t })),
    "in-progress": cols["in-progress"].map((t) => ({ ...t })),
    "verify": cols.verify.map((t) => ({ ...t })),
    "done": cols.done.map((t) => ({ ...t })),
  };
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
      className={`flex-1 flex flex-col min-w-[240px] rounded-lg transition-colors ${
        isOver
          ? isInProgress
            ? 'bg-steel/5 dark:bg-steel/5 ring-2 ring-steel/20'
            : 'bg-gunmetal-200/50 dark:bg-zinc-900/50 ring-2 ring-gunmetal-400/30 dark:ring-gunmetal-700/30'
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
}: KanbanBoardProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [localColumns, setLocalColumns] = useState<TaskColumns | null>(null);
  const pendingCommitRef = useRef<boolean>(false);
  const lastOverIdRef = useRef<string | null>(null);
  const [pendingRerun, setPendingRerun] = useState<{ taskId: string; toColumn: TaskStatus; toIndex: number; taskTitle: string } | null>(null);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef<HTMLDivElement>(null);

  useClickOutside(modeDropdownRef, () => setModeDropdownOpen(false), modeDropdownOpen);

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
        // Insert at position of the over item, or end if dropping on column itself
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
    setDragWidth(null);
    lastOverIdRef.current = null;

    if (!localColumns) {
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
        col[idx] = { ...col[idx], dispatch: 'starting' };
        return { ...prev, [toColumn]: col };
      });
    }

    // Commit
    pendingCommitRef.current = true;
    onMoveTask(activeId, toColumn, toIndex);

    // If moved to in-progress, refresh after API settles
    if (fromColumn !== toColumn && toColumn === 'in-progress' && onRefreshTasks) {
      setTimeout(onRefreshTasks, 500);
    }
  }

  function handleDragCancel() {
    setActiveDragId(null);
    setOverColumnId(null);
    setDragWidth(null);
    lastOverIdRef.current = null;
    setLocalColumns(null);
  }

  return (
    <div className="flex-1 h-full overflow-x-auto bg-surface-base">
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
            const colTasks = columns[column.id];
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
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-zinc-700 transition-colors ${executionMode === 'sequential' ? 'text-steel' : 'text-zinc-300'}`}
                            >
                              <ListOrderedIcon className="w-3.5 h-3.5" />
                              Sequential
                            </button>
                            <button
                              onClick={() => { onExecutionModeChange('parallel'); setModeDropdownOpen(false); }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-zinc-700 transition-colors ${executionMode === 'parallel' ? 'text-steel' : 'text-zinc-300'}`}
                            >
                              <LayersIcon className="w-3.5 h-3.5" />
                              Parallel
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-surface-secondary border border-border-default text-xs text-text-chrome font-mono">
                    {colTasks.length}
                  </span>
                </div>

                <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
                  <div className="flex-1 space-y-3 overflow-y-auto pb-4 px-1 min-h-[80px]">
                    {column.id === 'todo' && onAddTask && (
                      <button
                        onClick={onAddTask}
                        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-surface-secondary border border-border-default hover:bg-surface-hover hover:border-border-hover text-text-chrome hover:text-text-chrome-hover text-xs"
                      >
                        <PlusIcon className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    )}
                    {colTasks.map((task) => {
                      const isQueued = task.dispatch === 'queued';
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
                      <div className="h-24 border border-dashed border-border-default rounded-lg flex items-center justify-center">
                        <span className="text-xs text-gunmetal-500 dark:text-zinc-700">Empty</span>
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
              <TaskCard task={activeDragTask} isDragOverlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {pendingRerun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-sm font-medium text-zinc-100 mb-2">Move back to In Progress?</h3>
            <p className="text-xs text-zinc-400 mb-5">
              <span className="text-zinc-200 font-medium">&ldquo;{pendingRerun.taskTitle}&rdquo;</span>{' '}
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
                  if (onRefreshTasks) {
                    setTimeout(onRefreshTasks, 500);
                  }
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
