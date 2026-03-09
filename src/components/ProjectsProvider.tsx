'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Project, TaskColumns } from '@/lib/types';

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

export const emptyColumns = (): TaskColumns => ({
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

  return (
    <ProjectsContext.Provider
      value={{ projects, tasksByProject, isLoaded, refreshProjects, refreshTasks, setProjects, setTasksByProject }}
    >
      {children}
    </ProjectsContext.Provider>
  );
}
