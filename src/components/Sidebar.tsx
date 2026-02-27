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
  SquareChevronUpIcon,
  RefreshCwIcon,
  CheckCircle2Icon,
  MoreHorizontalIcon,
  Trash2Icon,
  AlertTriangleIcon,
  PencilIcon,
} from "lucide-react";
import type { Project, Task, TaskStatus, TaskColumns } from "@/lib/types";
import { useProjects } from "./ProjectsProvider";

function folderName(project: Project): string {
  const p = project.path.replace(/\/+$/, "");
  return p.split("/").pop() || project.name;
}

interface SidebarProps {
  onAddProject: () => void;
  onMissingPath?: (project: Project) => void;
}

function TaskStatusSummary({ columns }: { columns: TaskColumns }) {
  const counts: Partial<Record<TaskStatus, number>> = {};
  for (const status of Object.keys(columns) as TaskStatus[]) {
    if (columns[status].length > 0) counts[status] = columns[status].length;
  }

  const segments: React.ReactNode[] = [];
  if (counts["in-progress"]) {
    segments.push(
      <span key="ip" className="flex items-center gap-1">
        <RefreshCwIcon className="w-3 h-3 text-steel animate-[spin_3s_linear_infinite]" />
        <span className="text-zinc-500 dark:text-zinc-400">
          {counts["in-progress"]} in progress
        </span>
      </span>,
    );
  }
  if (counts["verify"]) {
    segments.push(
      <span key="v" className="flex items-center gap-1">
        <CheckCircle2Icon className="w-2.5 h-2.5 text-gold dark:text-gold" />
        <span className="text-zinc-500 dark:text-zinc-400">
          {counts["verify"]} to verify
        </span>
      </span>,
    );
  }

  if (segments.length === 0) {
    return (
      <span className="text-zinc-400 dark:text-zinc-600 text-[11px]">
        No active tasks
      </span>
    );
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
  onRename: (project: Project) => void;
}

function ProjectMenu({ project, onDelete, onRename }: ProjectMenuProps) {
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
        className="p-1 rounded hover:bg-bronze-300 dark:hover:bg-zinc-700 text-bronze-500 hover:text-bronze-700 dark:hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <MoreHorizontalIcon className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-bronze-50 dark:bg-zinc-800 border border-bronze-400 dark:border-zinc-700 rounded-md shadow-lg z-50 py-1">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              onRename(project);
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-bronze-700 dark:text-zinc-300 hover:bg-bronze-200 dark:hover:bg-zinc-700 flex items-center gap-2"
          >
            <PencilIcon className="w-3.5 h-3.5" />
            Rename
          </button>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              onDelete(project);
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-crimson hover:bg-bronze-200 dark:hover:bg-zinc-700 flex items-center gap-2"
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
  columns: TaskColumns;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onDelete: (project: Project) => void;
  onRename: (project: Project) => void;
  onMissingPath?: (project: Project) => void;
}

function SortableProject({
  project,
  index,
  isActive,
  columns,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onDelete,
  onRename,
  onMissingPath,
}: SortableProjectProps) {
  const pathInvalid = project.pathValid === false;
  const renameInputRef = useRef<HTMLInputElement>(null);
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

  // Focus the rename input when entering rename mode
  React.useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const router = useRouter();

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div
        ref={setActivatorNodeRef}
        {...listeners}
        onClick={() => {
          if (isDragging) return;
          if (pathInvalid) {
            onMissingPath?.(project);
            return;
          }
          if (isRenaming) return;
          router.push(`/projects/${project.id}`);
        }}
        className={`w-full text-left py-3 px-4 relative group block cursor-grab active:cursor-grabbing
          ${isActive ? "bg-bronze-300 dark:bg-zinc-800/50" : "hover:bg-bronze-300/60 dark:hover:bg-zinc-800/40"}
          `}
      >
        {isActive && (
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-bronze-600 dark:bg-bronze-500" />
        )}
        {pathInvalid && (
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-crimson" />
        )}

        {/* Top row: name + menu */}
        <div className="flex items-center gap-1">
          <div className="flex-1 min-w-0">
            {isRenaming ? (
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(e) => onRenameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onRenameSubmit();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    onRenameCancel();
                  }
                }}
                onBlur={onRenameCancel}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-full text-sm font-medium leading-tight bg-bronze-100 dark:bg-zinc-900 border border-steel/50 rounded px-1.5 py-0.5 text-bronze-900 dark:text-zinc-100 outline-none focus:border-steel"
              />
            ) : (
              <div
                className={`text-sm font-medium leading-tight truncate ${pathInvalid ? "text-crimson dark:text-crimson" : isActive ? "text-bronze-900 dark:text-zinc-100" : "text-bronze-700 dark:text-zinc-300 group-hover:text-bronze-900 dark:group-hover:text-zinc-100"}`}
              >
                {folderName(project)}
              </div>
            )}
          </div>

          {pathInvalid && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onMissingPath?.(project);
              }}
              className="p-1 text-crimson hover:text-crimson-light transition-colors"
              title="Project folder not found"
            >
              <AlertTriangleIcon className="w-4 h-4" />
            </button>
          )}

          <ProjectMenu
            project={project}
            onDelete={onDelete}
            onRename={onRename}
          />
        </div>

        {/* Path */}
        <div
          className={`text-[11px] font-mono mt-0.5 truncate ${pathInvalid ? "text-crimson/60 dark:text-crimson/50" : "text-zinc-400 dark:text-zinc-600"}`}
        >
          {project.path}
        </div>

        {/* Task Summary */}
        <div className="mt-1.5 text-[11px]">
          {pathInvalid ? (
            <span className="text-crimson dark:text-crimson text-[11px]">
              Folder not found
            </span>
          ) : (
            <TaskStatusSummary columns={columns} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────

export function Sidebar({ onAddProject, onMissingPath }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { projects, tasksByProject, refreshProjects, setProjects } =
    useProjects();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const isChatActive = pathname === "/supervisor";

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = projects.findIndex((p) => p.id === active.id);
      const newIndex = projects.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(projects, oldIndex, newIndex);
      setProjects(reordered);

      const orderedIds = reordered.map((p) => p.id);
      fetch("/api/projects/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
    },
    [projects, setProjects],
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
    [refreshProjects, pathname, router],
  );

  const handleStartRename = useCallback((project: Project) => {
    setRenamingId(project.id);
    setRenameValue(folderName(project));
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    const project = projects.find((p) => p.id === renamingId);
    if (!project) {
      setRenamingId(null);
      return;
    }

    // Don't submit if name hasn't changed
    if (renameValue.trim() === folderName(project)) {
      setRenamingId(null);
      return;
    }

    const res = await fetch(`/api/projects/${project.id}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });

    setRenamingId(null);

    if (res.ok) {
      const updated = await res.json();
      await refreshProjects();
      // If the project id changed (slug update), navigate to the new URL
      if (updated.id !== project.id && pathname === `/projects/${project.id}`) {
        router.push(`/projects/${updated.id}`);
      }
    }
  }, [renamingId, renameValue, projects, refreshProjects, pathname, router]);

  const handleRenameCancel = useCallback(() => {
    setRenamingId(null);
  }, []);

  return (
    <aside className="w-[260px] h-full bg-surface-secondary border-r border-border-default flex flex-col flex-shrink-0">
      {/* Header */}
      <Link
        href="/settings"
        className={`h-16 flex items-center gap-2.5 px-4 pl-[18px] group/logo hover:bg-bronze-100/60 dark:hover:bg-zinc-800/40 transition-colors relative
          ${pathname === "/settings" ? "bg-bronze-300 dark:bg-zinc-800/50" : ""}`}
      >
        {pathname === "/settings" && (
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-bronze-600 dark:bg-bronze-500" />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/proq-logo-vector.svg"
          alt="proq"
          width={13}
          height={13}
          className="translate-y-[4px]"
        />
        <span
          className="text-lg font-[var(--font-gemunu-libre)] text-bronze-900 dark:text-zinc-100 lowercase"
          style={{ fontFamily: "var(--font-gemunu-libre)" }}
        >
          proq
        </span>
      </Link>

      {/* Main Chat Item */}
      <Link
        href="/supervisor"
        className={`w-full text-left p-3 px-4 relative group py-4 block
          ${isChatActive ? "bg-bronze-300 dark:bg-zinc-800" : "hover:bg-bronze-300/60 dark:hover:bg-zinc-800/40"}`}
      >
        {isChatActive && (
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-bronze-600 dark:bg-bronze-500" />
        )}
        <div className="flex items-center gap-2.5">
          <SquareChevronUpIcon
            className={`w-4 h-4 ${isChatActive ? "text-bronze-500" : "text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300"}`}
          />
          <span
            className={`text-sm font-medium ${isChatActive ? "text-bronze-900 dark:text-zinc-100" : "text-bronze-700 dark:text-zinc-300 group-hover:text-bronze-900 dark:group-hover:text-zinc-100"}`}
          >
            Supervisor
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
            className="flex items-center gap-1.5 py-1 px-2.5 rounded border border-border-default hover:bg-surface-hover hover:border-border-hover text-text-chrome hover:text-text-chrome-hover text-xs"
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
              const cols = tasksByProject[project.id] || {
                todo: [],
                "in-progress": [],
                verify: [],
                done: [],
              };
              return (
                <SortableProject
                  key={project.id}
                  project={project}
                  index={index}
                  isActive={isActive}
                  columns={cols}
                  isRenaming={renamingId === project.id}
                  renameValue={renameValue}
                  onRenameChange={setRenameValue}
                  onRenameSubmit={handleRenameSubmit}
                  onRenameCancel={handleRenameCancel}
                  onDelete={handleDelete}
                  onRename={handleStartRename}
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
