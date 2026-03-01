'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

export type WorkbenchTabType = 'shell' | 'agent';

export interface WorkbenchTab {
  id: string;
  label: string;
  type: WorkbenchTabType;
}

interface ProjectWorkbenchState {
  tabs: WorkbenchTab[];
  activeTabId: string;
  hydrated?: boolean;
}

interface WorkbenchTabsContextValue {
  getTabs(projectId: string): WorkbenchTab[];
  getActiveTabId(projectId: string): string;
  setActiveTabId(projectId: string, tabId: string): void;
  openTab(projectId: string, tabId: string, label: string, type: WorkbenchTabType): void;
  closeTab(projectId: string, tabId: string): void;
  renameTab(projectId: string, tabId: string, label: string): void;
  hydrateProject(projectId: string): void;
}

const WorkbenchTabsContext = createContext<WorkbenchTabsContextValue | null>(null);

function defaultTab(projectId: string): WorkbenchTab {
  return { id: `default-${projectId}`, label: 'Terminal', type: 'shell' };
}

function getOrCreate(
  state: Record<string, ProjectWorkbenchState>,
  projectId: string
): ProjectWorkbenchState {
  const dt = defaultTab(projectId);
  return state[projectId] || { tabs: [dt], activeTabId: dt.id };
}

/** Extract tabs as persistable data (includes type for agent tabs) */
function persistableTabsFor(ps: ProjectWorkbenchState): Array<{ id: string; label: string; type?: WorkbenchTabType }> {
  return ps.tabs.map(({ id, label, type }) => ({ id, label, ...(type !== 'shell' ? { type } : {}) }));
}

export function WorkbenchTabsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Record<string, ProjectWorkbenchState>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const hydratedSet = useRef<Set<string>>(new Set());

  // Persist tabs + active tab to server (debounced)
  const persistTabs = useCallback((projectId: string, ps: ProjectWorkbenchState) => {
    if (saveTimers.current[projectId]) clearTimeout(saveTimers.current[projectId]);
    saveTimers.current[projectId] = setTimeout(() => {
      const tabs = persistableTabsFor(ps);
      fetch(`/api/projects/${projectId}/workbench-tabs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabs, activeTabId: ps.activeTabId }),
      }).catch(() => {});
    }, 300);
  }, []);

  // Hydrate tabs for a project from server
  const hydrateProject = useCallback((projectId: string) => {
    if (hydratedSet.current.has(projectId)) return;
    hydratedSet.current.add(projectId);

    fetch(`/api/projects/${projectId}/workbench-tabs`)
      .then((res) => res.json())
      .then((data) => {
        const saved: Array<{ id: string; label: string; type?: WorkbenchTabType }> = data.tabs || [];
        const savedActiveTabId: string | undefined = data.activeTabId;
        setState((prev) => {
          const existing = prev[projectId];

          let tabs: WorkbenchTab[];
          if (saved.length > 0) {
            tabs = saved.map((t) => ({ id: t.id, label: t.label, type: t.type || 'shell' }));
          } else {
            tabs = [defaultTab(projectId)];
          }

          // Restore saved active tab if it still exists, otherwise fall back
          const activeTabId =
            (savedActiveTabId && tabs.find((t) => t.id === savedActiveTabId) ? savedActiveTabId : null)
            ?? (existing?.activeTabId && tabs.find((t) => t.id === existing.activeTabId) ? existing.activeTabId : null)
            ?? tabs[0].id;

          return { ...prev, [projectId]: { tabs, activeTabId, hydrated: true } };
        });
      })
      .catch(() => {});
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const getTabs = useCallback(
    (projectId: string): WorkbenchTab[] => getOrCreate(state, projectId).tabs,
    [state]
  );

  const getActiveTabId = useCallback(
    (projectId: string): string => getOrCreate(state, projectId).activeTabId,
    [state]
  );

  const setActiveTabId = useCallback((projectId: string, tabId: string) => {
    setState((prev) => {
      const ps = getOrCreate(prev, projectId);
      const next = { ...prev, [projectId]: { ...ps, activeTabId: tabId } };
      persistTabs(projectId, next[projectId]);
      return next;
    });
  }, [persistTabs]);

  const openTab = useCallback(
    (projectId: string, tabId: string, label: string, type: WorkbenchTabType) => {
      setState((prev) => {
        const ps = getOrCreate(prev, projectId);
        if (ps.tabs.find((t) => t.id === tabId)) {
          return { ...prev, [projectId]: { ...ps, activeTabId: tabId } };
        }
        const newTab: WorkbenchTab = { id: tabId, label, type };
        const next = {
          ...prev,
          [projectId]: {
            ...ps,
            tabs: [...ps.tabs, newTab],
            activeTabId: tabId,
          },
        };
        persistTabs(projectId, next[projectId]);
        return next;
      });
    },
    [persistTabs]
  );

  const closeTab = useCallback((projectId: string, tabId: string) => {
    const ps = getOrCreate(state, projectId);
    const tab = ps.tabs.find((t) => t.id === tabId);
    if (tab?.type === 'agent') {
      fetch(`/api/agent-tab/${tabId}`, { method: 'DELETE' }).catch(() => {});
    } else {
      fetch(`/api/shell/${tabId}`, { method: 'DELETE' }).catch(() => {});
    }

    setState((prev) => {
      const ps = getOrCreate(prev, projectId);
      const filtered = ps.tabs.filter((t) => t.id !== tabId);
      let next: Record<string, ProjectWorkbenchState>;
      if (filtered.length === 0) {
        const dt = defaultTab(projectId);
        next = { ...prev, [projectId]: { ...ps, tabs: [dt], activeTabId: dt.id } };
      } else {
        const activeTabId = ps.activeTabId === tabId ? filtered[0].id : ps.activeTabId;
        next = { ...prev, [projectId]: { ...ps, tabs: filtered, activeTabId } };
      }
      persistTabs(projectId, next[projectId]);
      return next;
    });
  }, [state, persistTabs]);

  const renameTab = useCallback((projectId: string, tabId: string, label: string) => {
    setState((prev) => {
      const ps = getOrCreate(prev, projectId);
      const next = {
        ...prev,
        [projectId]: {
          ...ps,
          tabs: ps.tabs.map((t) =>
            t.id === tabId ? { ...t, label } : t
          ),
        },
      };
      persistTabs(projectId, next[projectId]);
      return next;
    });
  }, [persistTabs]);

  return (
    <WorkbenchTabsContext.Provider
      value={{ getTabs, getActiveTabId, setActiveTabId, openTab, closeTab, renameTab, hydrateProject }}
    >
      {children}
    </WorkbenchTabsContext.Provider>
  );
}

export function useWorkbenchTabs(): WorkbenchTabsContextValue {
  const ctx = useContext(WorkbenchTabsContext);
  if (!ctx) throw new Error('useWorkbenchTabs must be used within WorkbenchTabsProvider');
  return ctx;
}
