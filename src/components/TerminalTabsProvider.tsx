'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

export interface TerminalTab {
  id: string;
  label: string;
  type: 'shell' | 'task';
  status?: 'running' | 'done';
}

interface ProjectTerminalState {
  tabs: TerminalTab[];
  activeTabId: string;
  hydrated?: boolean;
}

interface TerminalTabsContextValue {
  getTabs(projectId: string): TerminalTab[];
  getActiveTabId(projectId: string): string;
  setActiveTabId(projectId: string, tabId: string): void;
  openTab(projectId: string, tabId: string, label: string, type: 'shell' | 'task'): void;
  closeTab(projectId: string, tabId: string): void;
  markTabDone(projectId: string, tabId: string): void;
  hydrateProject(projectId: string): void;
}

const TerminalTabsContext = createContext<TerminalTabsContextValue | null>(null);

function defaultTab(projectId: string): TerminalTab {
  return { id: `default-${projectId}`, label: 'Terminal', type: 'shell' };
}

function getOrCreate(
  state: Record<string, ProjectTerminalState>,
  projectId: string
): ProjectTerminalState {
  const dt = defaultTab(projectId);
  return state[projectId] || { tabs: [dt], activeTabId: dt.id };
}

/** Extract shell tabs as persistable data */
function shellTabsFor(ps: ProjectTerminalState): Array<{ id: string; label: string }> {
  return ps.tabs
    .filter((t) => t.type === 'shell')
    .map(({ id, label }) => ({ id, label }));
}

export function TerminalTabsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Record<string, ProjectTerminalState>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const hydratedSet = useRef<Set<string>>(new Set());

  // Persist shell tabs + active tab to server (debounced)
  const persistTabs = useCallback((projectId: string, ps: ProjectTerminalState) => {
    if (saveTimers.current[projectId]) clearTimeout(saveTimers.current[projectId]);
    saveTimers.current[projectId] = setTimeout(() => {
      const tabs = shellTabsFor(ps);
      fetch(`/api/projects/${projectId}/terminal-tabs`, {
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

    fetch(`/api/projects/${projectId}/terminal-tabs`)
      .then((res) => res.json())
      .then((data) => {
        const saved: Array<{ id: string; label: string }> = data.tabs || [];
        const savedActiveTabId: string | undefined = data.activeTabId;
        setState((prev) => {
          const existing = prev[projectId];
          // If tabs were already added (e.g. task tabs opened before hydration), merge
          const taskTabs = existing ? existing.tabs.filter((t) => t.type === 'task') : [];

          let shellTabs: TerminalTab[];
          if (saved.length > 0) {
            shellTabs = saved.map((t) => ({ ...t, type: 'shell' as const }));
          } else {
            shellTabs = [defaultTab(projectId)];
          }

          const allTabs = [...shellTabs, ...taskTabs];
          // Restore saved active tab if it still exists, otherwise fall back
          const activeTabId =
            (savedActiveTabId && allTabs.find((t) => t.id === savedActiveTabId) ? savedActiveTabId : null)
            ?? (existing?.activeTabId && allTabs.find((t) => t.id === existing.activeTabId) ? existing.activeTabId : null)
            ?? allTabs[0].id;

          return { ...prev, [projectId]: { tabs: allTabs, activeTabId, hydrated: true } };
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
    (projectId: string): TerminalTab[] => getOrCreate(state, projectId).tabs,
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
    (projectId: string, tabId: string, label: string, type: 'shell' | 'task') => {
      setState((prev) => {
        const ps = getOrCreate(prev, projectId);
        if (ps.tabs.find((t) => t.id === tabId)) {
          return { ...prev, [projectId]: { ...ps, activeTabId: tabId } };
        }
        const newTab: TerminalTab = {
          id: tabId,
          label,
          type,
          ...(type === 'task' ? { status: 'running' as const } : {}),
        };
        const next = {
          ...prev,
          [projectId]: {
            ...ps,
            tabs: [...ps.tabs, newTab],
            activeTabId: tabId,
          },
        };
        if (type === 'shell') persistTabs(projectId, next[projectId]);
        return next;
      });
    },
    [persistTabs]
  );

  const closeTab = useCallback((projectId: string, tabId: string) => {
    fetch(`/api/terminal/${tabId}`, { method: 'DELETE' }).catch(() => {});

    setState((prev) => {
      const ps = getOrCreate(prev, projectId);
      const filtered = ps.tabs.filter((t) => t.id !== tabId);
      let next: Record<string, ProjectTerminalState>;
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
  }, [persistTabs]);

  const markTabDone = useCallback((projectId: string, tabId: string) => {
    setState((prev) => {
      const ps = getOrCreate(prev, projectId);
      return {
        ...prev,
        [projectId]: {
          ...ps,
          tabs: ps.tabs.map((t) =>
            t.id === tabId ? { ...t, status: 'done' as const } : t
          ),
        },
      };
    });
  }, []);

  return (
    <TerminalTabsContext.Provider
      value={{ getTabs, getActiveTabId, setActiveTabId, openTab, closeTab, markTabDone, hydrateProject }}
    >
      {children}
    </TerminalTabsContext.Provider>
  );
}

export function useTerminalTabs(): TerminalTabsContextValue {
  const ctx = useContext(TerminalTabsContext);
  if (!ctx) throw new Error('useTerminalTabs must be used within TerminalTabsProvider');
  return ctx;
}
