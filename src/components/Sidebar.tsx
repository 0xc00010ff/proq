"use client";

import React, { Fragment, useState, useRef, useCallback } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  PlusIcon,
  LayoutGridIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  CheckCircle2Icon,
  MoreHorizontalIcon,
  GripVerticalIcon,
  Trash2Icon,
  AlertTriangleIcon,
} from "lucide-react";
import type { Project, Task, TaskStatus } from "@/lib/types";
import { useProjects } from "./ProjectsProvider";

function folderName(project: Project): string {
  const p = project.path.replace(/\/+$/, "");
  return p.split("/").pop() || project.name;
}

interface SidebarProps {
  onAddProject: () => void;
  onMissingPath?: (project: Project) => void;
}

function TaskStatusSummary({ tasks }: { tasks: Task[] }) {
  const counts: Partial<Record<TaskStatus, number>> = {};
  for (const task of tasks) {
    counts[task.status] = (counts[task.status] || 0) + 1;
  }

  const segments: React.ReactNode[] = [];
  if (counts["in-progress"]) {
    segments.push(
      <span key="ip" className="flex items-center gap-1">
        <RefreshCwIcon className="w-3 h-3 text-blue-400 animate-[spin_3s_linear_infinite]" />
        <span className="text-zinc-500 dark:text-zinc-400">{counts["in-progress"]} in progress</span>
      </span>
    );
  }
  if (counts["verify"]) {
    segments.push(
      <span key="v" className="flex items-center gap-1">
        <CheckCircle2Icon className="w-2.5 h-2.5 text-amber-500 dark:text-yellow-400" />
        <span className="text-zinc-500 dark:text-zinc-400">{counts["verify"]} to verify</span>
      </span>
    );
  }
  if (counts["todo"]) {
    segments.push(
      <span key="t" className="flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full bg-warm-500 dark:bg-zinc-500 flex-shrink-0" />
        <span className="text-zinc-500 dark:text-zinc-400">{counts["todo"]} todo</span>
      </span>
    );
  }

  if (segments.length === 0) {
    return <span className="text-zinc-400 dark:text-zinc-600 text-[11px]">No active tasks</span>;
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-zinc-300 dark:text-zinc-700">·</span>}
          {seg}
        </Fragment>
      ))}
    </div>
  );
}

// ── Context Menu ─────────────────────────────────────────

interface ProjectMenuProps {
  project: Project;
  onDelete: (project: Project) => void;
}

function ProjectMenu({ project, onDelete }: ProjectMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useClickOutside(menuRef, () => setOpen(false), open);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(!open);
        }}
        className="p-1 rounded hover:bg-warm-300 dark:hover:bg-zinc-700 text-warm-500 hover:text-warm-700 dark:hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <MoreHorizontalIcon className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-warm-50 dark:bg-zinc-800 border border-warm-400 dark:border-zinc-700 rounded-md shadow-lg z-50 py-1">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              onDelete(project);
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-warm-200 dark:hover:bg-zinc-700 flex items-center gap-2"
          >
            <Trash2Icon className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sortable Project Item ────────────────────────────────

interface SortableProjectProps {
  project: Project;
  index: number;
  isActive: boolean;
  tasks: Task[];
  onDelete: (project: Project) => void;
  onMissingPath?: (project: Project) => void;
}

function SortableProject({
  project,
  index,
  isActive,
  tasks,
  onDelete,
  onMissingPath,
}: SortableProjectProps) {
  const pathInvalid = project.pathValid === false;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <Link
        href={`/projects/${project.id}`}
        onClick={pathInvalid ? (e) => { e.preventDefault(); onMissingPath?.(project); } : undefined}
        className={`w-full text-left p-3 px-4 relative group block
          ${isActive ? "bg-warm-300 dark:bg-zinc-800" : "hover:bg-warm-300/60 dark:hover:bg-zinc-800/40"}
          ${index > 0 ? "border-t border-warm-300/60 dark:border-zinc-800/60" : ""}
          py-4`}
      >
        {isActive && (
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-blue-500" />
        )}
        {pathInvalid && (
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-red-500" />
        )}

        {/* Top row: drag handle + name + menu */}
        <div className="flex items-center gap-1">
          <button
            ref={setActivatorNodeRef}
            {...listeners}
            className="p-0.5 -ml-1 cursor-grab active:cursor-grabbing text-warm-400 dark:text-zinc-600 hover:text-warm-600 dark:hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            onClick={(e) => e.preventDefault()}
          >
            <GripVerticalIcon className="w-3.5 h-3.5" />
          </button>

          <div className="flex-1 min-w-0">
            <div
              className={`text-sm font-medium leading-tight truncate ${pathInvalid ? "text-red-500 dark:text-red-400" : isActive ? "text-warm-900 dark:text-zinc-100" : "text-warm-700 dark:text-zinc-300 group-hover:text-warm-900 dark:group-hover:text-zinc-100"}`}
            >
              {folderName(project)}
            </div>
          </div>

          {pathInvalid && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMissingPath?.(project); }}
              className="p-1 text-red-400 hover:text-red-300 transition-colors"
              title="Project folder not found"
            >
              <AlertTriangleIcon className="w-4 h-4" />
            </button>
          )}

          <ProjectMenu
            project={project}
            onDelete={onDelete}
          />
        </div>

        {/* Path */}
        <div className={`text-[11px] font-mono mt-1 truncate pl-4 ${pathInvalid ? "text-red-400/60 dark:text-red-500/50" : "text-zinc-400 dark:text-zinc-600"}`}>
          {project.path}
        </div>

        {/* Task Summary */}
        <div className="mt-2.5 text-[11px] pl-4">
          {pathInvalid ? (
            <span className="text-red-400 dark:text-red-500 text-[11px]">Folder not found</span>
          ) : (
            <TaskStatusSummary tasks={tasks} />
          )}
        </div>
      </Link>
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────

export function Sidebar({ onAddProject, onMissingPath }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { projects, tasksByProject, refreshProjects } = useProjects();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const isChatActive = pathname === "/chat";

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = projects.findIndex((p) => p.id === active.id);
      const newIndex = projects.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(projects, oldIndex, newIndex);
      const orderedIds = reordered.map((p) => p.id);

      await fetch("/api/projects/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
      await refreshProjects();
    },
    [projects, refreshProjects]
  );

  const handleDelete = useCallback(
    async (project: Project) => {
      await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      await refreshProjects();

      // Navigate away if we deleted the active project
      if (pathname === `/projects/${project.id}`) {
        router.push("/");
      }
    },
    [refreshProjects, pathname, router]
  );

  return (
    <aside className="w-[260px] h-full bg-warm-200/50 dark:bg-zinc-800/30 border-r border-warm-300 dark:border-zinc-800 flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="h-16 flex items-center px-4 border-b border-warm-300/50 dark:border-zinc-800/50">
        <LayoutGridIcon className="w-5 h-5 text-zinc-400 mr-3" />
        <span className="text-sm font-bold tracking-wide text-warm-900 dark:text-zinc-100 uppercase">
          Last Q
        </span>
      </div>

      {/* Main Chat Item */}
      <Link
        href="/chat"
        className={`w-full text-left p-3 px-4 relative group py-4 border-b border-warm-300/60 dark:border-zinc-800/60 block
          ${isChatActive ? "bg-warm-300 dark:bg-zinc-800" : "hover:bg-warm-300/60 dark:hover:bg-zinc-800/40"}`}
      >
        {isChatActive && (
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-blue-500" />
        )}
        <div className="flex items-center gap-2.5">
          <MessageSquareIcon
            className={`w-4 h-4 ${isChatActive ? "text-blue-400" : "text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300"}`}
          />
          <span
            className={`text-sm font-medium ${isChatActive ? "text-warm-900 dark:text-zinc-100" : "text-warm-700 dark:text-zinc-300 group-hover:text-warm-900 dark:group-hover:text-zinc-100"}`}
          >
            Big Q
          </span>
        </div>
      </Link>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest">
            Projects
          </span>
          <button
            onClick={onAddProject}
            className="flex items-center gap-1 py-0.5 px-2 rounded border border-zinc-500 hover:bg-warm-300 dark:hover:bg-zinc-800 hover:border-warm-500 dark:hover:border-zinc-600 text-zinc-500 hover:text-warm-700 dark:hover:text-zinc-200 text-xs"
          >
            <PlusIcon className="w-3 h-3" />
            <span>Add</span>
          </button>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={projects.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            {projects.map((project, index) => {
              const isActive = pathname === `/projects/${project.id}`;
              const tasks = tasksByProject[project.id] || [];
              return (
                <SortableProject
                  key={project.id}
                  project={project}
                  index={index}
                  isActive={isActive}
                  tasks={tasks}
                  onDelete={handleDelete}
                  onMissingPath={onMissingPath}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </div>

    </aside>
  );
}
