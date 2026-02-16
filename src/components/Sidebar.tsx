"use client";

import React, { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PlusIcon,
  LayoutGridIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  CheckCircle2Icon,
} from "lucide-react";
import type { Task, TaskStatus } from "@/lib/types";
import { useProjects } from "./ProjectsProvider";

interface SidebarProps {
  onAddProject: () => void;
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
        <CheckCircle2Icon className="w-3 h-3 text-green-400" />
        <span className="text-zinc-500 dark:text-zinc-400">{counts["verify"]} to verify</span>
      </span>
    );
  }
  if (counts["todo"]) {
    segments.push(
      <span key="t" className="flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full bg-zinc-400 dark:bg-zinc-500 flex-shrink-0" />
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

export function Sidebar({ onAddProject }: SidebarProps) {
  const pathname = usePathname();
  const { projects, tasksByProject } = useProjects();

  const isChatActive = pathname === "/chat";

  return (
    <aside className="w-[260px] h-full bg-zinc-100/50 dark:bg-zinc-800/30 border-r border-zinc-200 dark:border-zinc-800 flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="h-16 flex items-center px-4 border-b border-zinc-200/50 dark:border-zinc-800/50">
        <LayoutGridIcon className="w-5 h-5 text-zinc-400 mr-3" />
        <span className="text-sm font-bold tracking-wide text-zinc-900 dark:text-zinc-100 uppercase">
          Claude Queued
        </span>
      </div>

      {/* Main Chat Item */}
      <Link
        href="/chat"
        className={`w-full text-left p-3 px-4 relative group py-4 border-b border-zinc-200/60 dark:border-zinc-800/60 block
          ${isChatActive ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/40"}`}
      >
        {isChatActive && (
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-blue-500" />
        )}
        <div className="flex items-center gap-2.5">
          <MessageSquareIcon
            className={`w-4 h-4 ${isChatActive ? "text-blue-400" : "text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300"}`}
          />
          <span
            className={`text-sm font-medium ${isChatActive ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-zinc-100"}`}
          >
            Big Claude
          </span>
        </div>
      </Link>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 text-[10px] font-medium text-zinc-500 uppercase tracking-widest">
          Projects
        </div>
        {projects.map((project, index) => {
          const isActive = pathname === `/projects/${project.id}`;
          const tasks = tasksByProject[project.id] || [];
          return (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className={`w-full text-left p-3 px-4 relative group block
                ${isActive ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/40"}
                ${index > 0 ? "border-t border-zinc-200/60 dark:border-zinc-800/60" : ""}
                py-4`}
            >
              {isActive && (
                <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-blue-500" />
              )}
              {/* Project Name */}
              <div
                className={`text-sm font-medium leading-tight ${isActive ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-zinc-100"}`}
              >
                {project.name}
              </div>

              {/* Path */}
              <div className="text-[11px] font-mono text-zinc-400 dark:text-zinc-600 mt-1 truncate">
                {project.path}
              </div>

              {/* Task Summary */}
              <div className="mt-2.5 text-[11px]">
                <TaskStatusSummary tasks={tasks} />
              </div>
            </Link>
          );
        })}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 py-[11px]">
        <button
          onClick={onAddProject}
          className="w-full flex items-center justify-center space-x-2 py-2 px-3 rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 text-sm"
        >
          <PlusIcon className="w-4 h-4" />
          <span>Add Project</span>
        </button>
      </div>
    </aside>
  );
}
