'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Project, Task, TaskColumns, TaskStatus } from '@/lib/types';
import { useGlobalTaskEvents, type GlobalSSEEvent } from '@/hooks/useGlobalTaskEvents';

interface ProjectsContextValue {
  projects: Project[];
  tasksByProject: Record<string, TaskColumns>;
  isLoaded: boolean;
  refreshProjects: () => Promise<void>;
  refreshTasks: (projectId: string) => Promise<void>;
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setTasksByProject: React.Dispatch<React.SetStateAction<Record<string, TaskColumns>>>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectsProvider');
  return ctx;
}

export const emptyTasks = (): TaskColumns => ({
  "todo": [],
  "in-progress": [],
  "verify": [],
  "done": [],
});

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Record<string, TaskColumns>>({});
  const [isLoaded, setIsLoaded] = useState(false);

  const refreshTasks = useCallback(async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/tasks`);
    if (!res.ok) return;
    const columns: TaskColumns = await res.json();
    setTasksByProject((prev) => {
      const existing = prev[projectId];
      // Skip update if data hasn't changed — prevents unnecessary re-renders
      // that break text selection and cause task cards to jump
      if (existing && JSON.stringify(existing) === JSON.stringify(columns)) {
        return prev;
      }
      return { ...prev, [projectId]: columns };
    });
  }, []);

  const refreshProjects = useCallback(async () => {
    const res = await fetch('/api/projects');
    const data: Project[] = await res.json();
    setProjects(data);
    await Promise.all(data.map((p) => refreshTasks(p.id)));
    setIsLoaded(true);
  }, [refreshTasks]);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // Global SSE: keep sidebar task counts fresh across all projects in real time.
  const handleGlobalEvent = useCallback((event: GlobalSSEEvent) => {
    const { projectId } = event;

    if (event.type === 'update') {
      const newStatus = event.changes.status as TaskStatus | undefined;
      setTasksByProject((prev) => {
        const cols = prev[projectId];
        if (!cols) return prev;
        for (const status of ['todo', 'in-progress', 'verify', 'done'] as TaskStatus[]) {
          const idx = cols[status].findIndex((t) => t.id === event.taskId);
          if (idx === -1) continue;
          const merged = { ...cols[status][idx], ...event.changes } as Task;
          const updated = { ...cols };
          if (newStatus && newStatus !== status) {
            updated[status] = cols[status].filter((t) => t.id !== event.taskId);
            updated[newStatus] = [merged, ...cols[newStatus]];
          } else {
            updated[status] = [...cols[status]];
            updated[status][idx] = merged;
          }
          return { ...prev, [projectId]: updated };
        }
        return prev;
      });
    } else if (event.type === 'created') {
      const task = event.task as unknown as Task;
      if (!task.id) return;
      const targetStatus = (task.status as TaskStatus) || 'todo';
      setTasksByProject((prev) => {
        const cols = prev[projectId];
        if (!cols) return prev;
        for (const status of ['todo', 'in-progress', 'verify', 'done'] as TaskStatus[]) {
          if (cols[status].some((t) => t.id === task.id)) return prev;
        }
        return { ...prev, [projectId]: { ...cols, [targetStatus]: [task, ...cols[targetStatus]] } };
      });
    } else if (event.type === 'project_update') {
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, ...event.changes } : p))
      );
    }
  }, [setTasksByProject, setProjects]);

  useGlobalTaskEvents(handleGlobalEvent);

  return (
    <ProjectsContext.Provider
      value={{ projects, tasksByProject, isLoaded, refreshProjects, refreshTasks, setProjects, setTasksByProject }}
    >
      {children}
    </ProjectsContext.Provider>
  );
}
