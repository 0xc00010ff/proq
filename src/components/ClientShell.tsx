'use client';

import React, { useCallback, useState } from 'react';
import { ProjectsProvider } from './ProjectsProvider';
import { WorkbenchTabsProvider } from './WorkbenchTabsProvider';
import { Sidebar } from './Sidebar';
import { MissingPathModal } from './MissingPathModal';
import { useProjects } from './ProjectsProvider';
import type { Project } from '@/lib/types';

function ShellInner({ children }: { children: React.ReactNode }) {
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

  if (!isLoaded) {
    return (
      <div className="flex h-screen w-full bg-surface-base text-bronze-900 dark:text-zinc-100 items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-surface-base text-bronze-900 dark:text-zinc-100 overflow-hidden font-sans">
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
  );
}

export function ClientShell({ children }: { children: React.ReactNode }) {
  return (
    <ProjectsProvider>
      <WorkbenchTabsProvider>
        <ShellInner>{children}</ShellInner>
      </WorkbenchTabsProvider>
    </ProjectsProvider>
  );
}
