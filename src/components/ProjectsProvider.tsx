'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Project, Task } from '@/lib/types';

interface ProjectsContextValue {
  projects: Project[];
  tasksByProject: Record<string, Task[]>;
  isLoaded: boolean;
  refreshProjects: () => Promise<void>;
  refreshTasks: (projectId: string) => Promise<void>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectsProvider');
  return ctx;
}

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Record<string, Task[]>>({});
  const [isLoaded, setIsLoaded] = useState(false);

  const refreshTasks = useCallback(async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/tasks`);
    const tasks: Task[] = await res.json();
    setTasksByProject((prev) => ({ ...prev, [projectId]: tasks }));
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
      value={{ projects, tasksByProject, isLoaded, refreshProjects, refreshTasks }}
    >
      {children}
    </ProjectsContext.Provider>
  );
}
