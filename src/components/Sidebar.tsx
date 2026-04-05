"use client";

import React, { Fragment, useState, useRef, useCallback, useEffect } from "react";
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
import { isElectron } from "@/lib/utils";
import {
  PlusIcon,
  RefreshCwIcon,
  CheckCircle2Icon,
  MoreHorizontalIcon,
  Trash2Icon,
  AlertTriangleIcon,
  PencilIcon,
  PanelLeftCloseIcon,
  SettingsIcon,
  FolderOpenIcon,
} from "lucide-react";
import type { Project, TaskStatus, TaskColumns } from "@/lib/types";
import { useProjects } from "./ProjectsProvider";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

function folderName(project: Project): string {
  const p = project.path.replace(/\/+$/, "");
  return p.split("/").pop() || project.name;
}

function displayPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

interface SidebarProps {
  onAddProject: () => void;
  onMissingPath?: (project: Project) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
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
        <RefreshCwIcon className="w-3 h-3 text-bronze-500 animate-[spin_3s_linear_infinite]" />
        <span className="text-text-secondary">
          {counts["in-progress"]} in progress
        </span>
      </span>,
    );
  }
  if (counts["verify"]) {
    segments.push(
      <span key="v" className="flex items-center gap-1">
        <CheckCircle2Icon className="w-2.5 h-2.5 text-lazuli" />
        <span className="text-text-secondary">
          {counts["verify"]} to verify
        </span>
      </span>,
    );
  }

  if (segments.length === 0) {
    return (
      <span className="text-text-tertiary text-[11px]">
        No active tasks
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-text-placeholder">·</span>}
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="p-1 rounded hover:bg-surface-hover text-text-chrome hover:text-text-chrome-hover opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <MoreHorizontalIcon className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onSelect={() => {
            setTimeout(() => onRename(project), 0);
          }}
          className="gap-2"
        >
          <PencilIcon className="w-3.5 h-3.5" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            fetch(`/api/projects/${project.id}/reveal`, { method: 'POST' });
          }}
          className="gap-2"
        >
          <FolderOpenIcon className="w-3.5 h-3.5" />
          Show in Finder
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onDelete(project);
          }}
          className="gap-2 text-crimson focus:text-crimson"
        >
          <Trash2Icon className="w-3.5 h-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  // Use a timeout so the dropdown fully unmounts before we focus
  const focusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => {
    if (isRenaming) {
      focusTimer.current = setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 150);
    }
    return () => clearTimeout(focusTimer.current);
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
        className={`w-full text-left py-2.5 px-4 relative group block cursor-pointer
          ${isActive ? "bg-surface-selected/50" : "hover:bg-surface-hover/40"}
          `}
      >
        {isActive && (
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-bronze-700 dark:bg-bronze-600" />
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
                className="w-full text-sm font-medium leading-tight bg-surface-inset border border-border-default rounded px-1.5 py-0.5 text-text-primary outline-none"
              />
            ) : (
              <div
                className={`text-sm font-medium leading-tight truncate ${pathInvalid ? "text-crimson" : isActive ? "text-text-primary" : "text-text-secondary group-hover:text-text-primary"}`}
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
              className="p-1 text-crimson hover:text-crimson-light"
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
          title={project.path}
          className={`text-[11px] mt-0.5 truncate ${pathInvalid ? "text-crimson/60 dark:text-crimson/50" : "text-text-placeholder"}`}
        >
          {displayPath(project.path)}
        </div>

        {/* Task Summary */}
        <div className="mt-1.5 text-[11px]">
          {pathInvalid ? (
            <span className="text-crimson text-[11px]">
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

export function Sidebar({ onAddProject, onMissingPath, collapsed, onToggleCollapsed }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { projects, tasksByProject, refreshProjects, setProjects } =
    useProjects();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // Listen for update notifications from Electron
  useEffect(() => {
    if (!isElectron || typeof window === "undefined" || !window.proqDesktop?.onUpdateAvailable) return;
    const cleanup = window.proqDesktop.onUpdateAvailable(() => {
      setUpdateAvailable(true);
    });
    return cleanup;
  }, []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const isChatActive = pathname === "/supervisor";
  const isSettingsActive = pathname === "/settings";

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

  if (collapsed) {
    return null;
  }

  return (
    <aside className="w-[260px] h-full bg-surface-secondary border-r border-border-default flex flex-col flex-shrink-0 relative" style={isElectron ? { paddingTop: 48 } : undefined}>
      {isElectron && <div className="absolute top-0 left-0 right-0 h-[48px] electron-drag" />}
      {/* Collapse button — top right, vertically centered with traffic lights */}
      <button
        onClick={onToggleCollapsed}
        className="absolute top-0 right-2 h-[48px] flex items-center z-10"
        title="Collapse sidebar"
      >
        <PanelLeftCloseIcon className="w-4 h-4 text-text-tertiary hover:text-text-secondary" />
      </button>

      {/* proq — main chat nav item */}
      <Link
        href="/supervisor"
        className={`w-full text-left px-4 pl-[18px] relative group block flex-shrink-0 h-[48px] flex items-center
          ${isChatActive ? "bg-surface-selected" : "hover:bg-surface-hover/40"}`}
      >
        {isChatActive && (
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-bronze-700 dark:bg-bronze-600" />
        )}
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={isChatActive ? "/proq-logo-vector.svg" : "/proq-logo-vector-gray.svg"}
            alt="proq"
            width={13}
            height={13}
            className="flex-shrink-0 translate-y-[1px]"
          />
          <span
            className={`text-lg lowercase ${isChatActive ? "text-text-primary" : "text-text-tertiary group-hover:text-text-secondary"}`}
            style={{ fontFamily: "var(--font-gemunu-libre)" }}
          >
            proq
          </span>
        </div>
      </Link>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-4 h-[48px] flex items-center justify-between flex-shrink-0">
          <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-widest">
            Projects
          </span>
          <button
            onClick={onAddProject}
            className="btn-secondary flex items-center gap-1.5"
          >
            <PlusIcon className="w-3 h-3" />
            <span>New</span>
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

      {/* Fixed Settings at bottom */}
      <Link
        href="/settings"
        className={`h-12 flex items-center gap-2.5 px-4 border-t border-border-default flex-shrink-0 group/settings
          ${isSettingsActive ? "bg-surface-selected/50" : "hover:bg-surface-hover/40"} relative`}
      >
        {isSettingsActive && (
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-bronze-700 dark:bg-bronze-600" />
        )}
        <span className="relative">
          <SettingsIcon className={`w-4 h-4 flex-shrink-0 ${isSettingsActive ? "text-text-secondary" : "text-text-tertiary group-hover/settings:text-text-secondary"}`} />
          {isElectron && updateAvailable && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-bronze-600" />
          )}
        </span>
        <span className={`text-sm font-medium ${isSettingsActive ? "text-text-primary" : "text-text-secondary group-hover/settings:text-text-primary"}`}>
          Settings
        </span>
      </Link>

    </aside>
  );
}
