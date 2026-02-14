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
} from 'lucide-react';
import type { Task, TaskStatus } from '@/lib/types';
import { TaskCard } from './TaskCard';

interface KanbanBoardProps {
  tasks: Task[];
  onReorderTasks: (reordered: Task[]) => void;
  onAddTask?: () => void;
  onDeleteTask?: (taskId: string) => void;
  onClickTask?: (task: Task) => void;
}

const COLUMNS: { id: TaskStatus; label: string; icon: React.ReactNode }[] = [
  { id: 'todo', label: 'To Do', icon: <CircleDotIcon className="w-3.5 h-3.5 text-zinc-500" /> },
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
        isOver ? 'bg-zinc-900/50 ring-2 ring-blue-500/20' : 'bg-transparent'
      }`}
    >
      {children}
    </div>
  );
}

function SortableTaskCard({
  task,
  onDelete,
  onClick,
}: {
  task: Task;
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
      <TaskCard task={task} onDelete={onDelete} onClick={onClick} />
    </div>
  );
}

export function KanbanBoard({
  tasks,
  onReorderTasks,
  onAddTask,
  onDeleteTask,
  onClickTask,
}: KanbanBoardProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [localTasks, setLocalTasks] = useState<Task[] | null>(null);
  const pendingCommitRef = useRef<Task[] | null>(null);

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
          t.id === activeId ? { ...t, status: targetStatus } : t
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

    // Keep localTasks as optimistic state until parent props catch up
    setLocalTasks(finalTasks);
    pendingCommitRef.current = finalTasks;
    onReorderTasks(finalTasks);
  }

  function handleDragCancel() {
    setActiveDragId(null);
    setOverColumnId(null);
    setLocalTasks(null);
  }

  return (
    <div className="flex-1 h-full overflow-x-auto bg-zinc-950">
      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex h-full min-w-[1000px] p-6 space-x-4">
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
                    <h3 className="text-sm font-medium text-zinc-400">{column.label}</h3>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-500 font-mono">
                    {colTasks.length}
                  </span>
                </div>

                <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
                  <div className="flex-1 space-y-3 overflow-y-auto pb-4 px-1 min-h-[80px]">
                    {colTasks.map((task) => (
                      <SortableTaskCard
                        key={task.id}
                        task={task}
                        onDelete={onDeleteTask}
                        onClick={task.status === 'in-progress' && task.locked ? undefined : onClickTask}
                      />
                    ))}

                    {colTasks.length === 0 && (
                      <div className="h-24 border-2 border-dashed border-zinc-900 rounded-lg flex items-center justify-center">
                        <span className="text-xs text-zinc-700">Empty</span>
                      </div>
                    )}

                    {column.id === 'todo' && onAddTask && (
                      <button
                        onClick={onAddTask}
                        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-zinc-800/30 border border-zinc-800 hover:bg-zinc-900 hover:border-zinc-700 text-zinc-500 hover:text-zinc-300 text-xs"
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
            <div className="w-[240px]">
              <TaskCard task={activeDragTask} isDragOverlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
