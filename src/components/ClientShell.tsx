'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ProjectsProvider } from './ProjectsProvider';
import { WorkbenchTabsProvider } from './WorkbenchTabsProvider';
import { Sidebar } from './Sidebar';
import { MissingPathModal } from './MissingPathModal';
import { useProjects } from './ProjectsProvider';
import type { Project } from '@/lib/types';

interface ShellActions {
  addProject: () => Promise<void>;
}

const ShellActionsContext = createContext<ShellActions | null>(null);

export function useShellActions() {
  const ctx = useContext(ShellActionsContext);
  if (!ctx) throw new Error('useShellActions must be used within ClientShell');
  return ctx;
}

const STANDALONE_ROUTES = ['/design'];

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStandalone = STANDALONE_ROUTES.includes(pathname);
  const { refreshProjects, isLoaded } = useProjects();
  const [missingProject, setMissingProject] = useState<Project | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleAddProject = useCallback(async () => {
    const res = await fetch('/api/folder-picker', { method: 'POST' });
    const data = await res.json();
    if (data.cancelled) return;

    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: data.name, path: data.path }),
    });
    await refreshProjects();
  }, [refreshProjects]);

  const handleRelocate = useCallback(async (project: Project, newPath: string) => {
    const newName = newPath.split('/').pop() || project.name;
    await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, path: newPath }),
    });
    setMissingProject(null);
    await refreshProjects();
  }, [refreshProjects]);

  const handleRemoveProject = useCallback(async (project: Project) => {
    await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
    setMissingProject(null);
    await refreshProjects();
  }, [refreshProjects]);

  if (isStandalone) {
    return (
      <div className="h-screen w-full overflow-y-auto font-sans">
        {children}
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-screen w-full bg-surface-base text-text-primary items-center justify-center">
        <div className="text-text-tertiary text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <ShellActionsContext.Provider value={{ addProject: handleAddProject }}>
      <div className="flex h-screen w-full bg-surface-base text-text-primary overflow-hidden font-sans">
        <Sidebar
          onAddProject={handleAddProject}
          onMissingPath={setMissingProject}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        />
        <div className="flex-1 flex flex-col min-w-0">
          {children}
        </div>
        {missingProject && (
          <MissingPathModal
            project={missingProject}
            onClose={() => setMissingProject(null)}
            onRelocate={handleRelocate}
            onRemove={handleRemoveProject}
          />
        )}
      </div>
    </ShellActionsContext.Provider>
  );
}

export function ClientShell({ children }: { children: React.ReactNode }) {
  // Listen for OS theme changes when theme is set to "system"
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const stored = localStorage.getItem('theme');
      if (!stored || stored === 'system') {
        document.documentElement.classList.toggle('dark', mq.matches);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <ProjectsProvider>
      <WorkbenchTabsProvider>
        <ShellInner>{children}</ShellInner>
      </WorkbenchTabsProvider>
    </ProjectsProvider>
  );
}
