'use client';

import React, { useCallback } from 'react';
import { ProjectsProvider } from './ProjectsProvider';
import { TerminalTabsProvider } from './TerminalTabsProvider';
import { Sidebar } from './Sidebar';
import { useProjects } from './ProjectsProvider';

function ShellInner({ children }: { children: React.ReactNode }) {
  const { refreshProjects, isLoaded } = useProjects();

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

  if (!isLoaded) {
    return (
      <div className="flex h-screen w-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans">
      <Sidebar onAddProject={handleAddProject} />
      <div className="flex-1 flex flex-col min-w-0">
        {children}
      </div>
    </div>
  );
}

export function ClientShell({ children }: { children: React.ReactNode }) {
  return (
    <ProjectsProvider>
      <TerminalTabsProvider>
        <ShellInner>{children}</ShellInner>
      </TerminalTabsProvider>
    </ProjectsProvider>
  );
}
