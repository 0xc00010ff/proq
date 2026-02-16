'use client';

import React, { useState } from 'react';
import { ProjectsProvider } from './ProjectsProvider';
import { Sidebar } from './Sidebar';
import { AddProjectModal } from './AddProjectModal';
import { useProjects } from './ProjectsProvider';

function ShellInner({ children }: { children: React.ReactNode }) {
  const [showAddProject, setShowAddProject] = useState(false);
  const { refreshProjects, isLoaded } = useProjects();

  if (!isLoaded) {
    return (
      <div className="flex h-screen w-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans">
      <Sidebar onAddProject={() => setShowAddProject(true)} />
      <div className="flex-1 flex flex-col min-w-0">
        {children}
      </div>
      <AddProjectModal
        open={showAddProject}
        onClose={() => setShowAddProject(false)}
        onCreated={refreshProjects}
      />
    </div>
  );
}

export function ClientShell({ children }: { children: React.ReactNode }) {
  return (
    <ProjectsProvider>
      <ShellInner>{children}</ShellInner>
    </ProjectsProvider>
  );
}
