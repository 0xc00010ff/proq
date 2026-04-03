'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ProjectsProvider } from './ProjectsProvider';
import { useElectronDragSuppression } from '@/hooks/useElectronDragSuppression';

import { Sidebar } from './Sidebar';
import { MissingPathModal } from './MissingPathModal';
import { ProjectCreationModal } from './ProjectCreationModal';
import { useProjects } from './ProjectsProvider';
import type { Project } from '@/lib/types';

interface ShellActions {
  addProject: () => Promise<void>;
  openCreationModal: () => void;
  /** Prefill the supervisor chat input and navigate to /supervisor */
  prefillSupervisorChat: (text: string) => void;
  /** Consume (read + clear) any pending draft for the supervisor chat */
  consumeSupervisorDraft: () => string | null;
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
  const router = useRouter();
  const isStandalone = STANDALONE_ROUTES.includes(pathname);
  const { refreshProjects, isLoaded } = useProjects();
  const [missingProject, setMissingProject] = useState<Project | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [creationModalOpen, setCreationModalOpen] = useState(false);
  const supervisorDraftRef = useRef<string | null>(null);

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

  const handleOpenCreationModal = useCallback(() => {
    setCreationModalOpen(true);
  }, []);

  const handlePrefillSupervisorChat = useCallback((text: string) => {
    supervisorDraftRef.current = text;
    if (pathname !== '/supervisor') {
      router.push('/supervisor');
    }
  }, [pathname, router]);

  const handleConsumeSupervisorDraft = useCallback(() => {
    const draft = supervisorDraftRef.current;
    supervisorDraftRef.current = null;
    return draft;
  }, []);

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
    <ShellActionsContext.Provider value={{ addProject: handleAddProject, openCreationModal: handleOpenCreationModal, prefillSupervisorChat: handlePrefillSupervisorChat, consumeSupervisorDraft: handleConsumeSupervisorDraft }}>
      <div className="flex h-screen w-full bg-surface-base text-text-primary overflow-hidden font-sans">
        <Sidebar
          onAddProject={handleOpenCreationModal}
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
        <ProjectCreationModal
          isOpen={creationModalOpen}
          onClose={() => setCreationModalOpen(false)}
          onCreated={async (projectId) => {
            await refreshProjects();
            router.push(`/projects/${projectId}`);
          }}
          onOpenExisting={handleAddProject}
          onSomethingElse={handlePrefillSupervisorChat}
        />
      </div>
    </ShellActionsContext.Provider>
  );
}

export function ClientShell({ children }: { children: React.ReactNode }) {
  // Suppress electron drag regions when Radix portals (modals/dropdowns) are open
  useElectronDragSuppression();

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

  // Sync theme across windows (storage event fires in OTHER windows on same origin)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'theme') {
        const isDark = e.newValue === 'dark' || (e.newValue !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.toggle('dark', isDark);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return (
    <ProjectsProvider>
      <ShellInner>{children}</ShellInner>
    </ProjectsProvider>
  );
}
