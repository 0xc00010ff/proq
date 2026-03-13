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
  getTabs(projectId: string, scope?: WorkbenchScope): WorkbenchTab[];
  getActiveTabId(projectId: string, scope?: WorkbenchScope): string;
  setActiveTabId(projectId: string, tabId: string, scope?: WorkbenchScope): void;
  openTab(projectId: string, tabId: string, label: string, type: WorkbenchTabType, scope?: WorkbenchScope): void;
  closeTab(projectId: string, tabId: string, scope?: WorkbenchScope): void;
  renameTab(projectId: string, tabId: string, label: string, scope?: WorkbenchScope): void;
  reorderTabs(projectId: string, tabs: WorkbenchTab[], scope?: WorkbenchScope): void;
  hydrateProject(projectId: string, scope?: WorkbenchScope): void;
}

const WorkbenchTabsContext = createContext<WorkbenchTabsContextValue | null>(null);

export type WorkbenchScope = 'project' | 'live';

function defaultTabs(projectId: string, scope: WorkbenchScope = 'project'): WorkbenchTab[] {
  if (scope === 'live') {
    return [
      { id: `live-agent-${projectId}`, label: 'Agent', type: 'agent' },
      { id: `live-shell-${projectId}`, label: 'Terminal', type: 'shell' },
    ];
  }
  return [
    { id: `default-agent-${projectId}`, label: 'Agent', type: 'agent' },
    { id: `default-shell-${projectId}`, label: 'Terminal', type: 'shell' },
  ];
}

/** Derive a scoped key for storing workbench state per project + scope */
function scopedKey(projectId: string, scope: WorkbenchScope = 'project'): string {
  return scope === 'project' ? projectId : `${projectId}::${scope}`;
}

function getOrCreate(
  state: Record<string, ProjectWorkbenchState>,
  projectId: string,
  scope: WorkbenchScope = 'project',
): ProjectWorkbenchState {
  const key = scopedKey(projectId, scope);
  const dts = defaultTabs(projectId, scope);
  return state[key] || { tabs: dts, activeTabId: dts[0].id };
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
  const persistTabs = useCallback((projectId: string, ps: ProjectWorkbenchState, scope: WorkbenchScope = 'project') => {
    const key = scopedKey(projectId, scope);
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      const tabs = persistableTabsFor(ps);
      const url = scope === 'project'
        ? `/api/projects/${projectId}/workbench-tabs`
        : `/api/projects/${projectId}/workbench-tabs?scope=${scope}`;
      fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabs, activeTabId: ps.activeTabId }),
      }).catch(() => {});
    }, 300);
  }, []);

  // Hydrate tabs for a project from server
  const hydrateProject = useCallback((projectId: string, scope: WorkbenchScope = 'project') => {
    const key = scopedKey(projectId, scope);
    if (hydratedSet.current.has(key)) return;
    hydratedSet.current.add(key);

    const url = scope === 'project'
      ? `/api/projects/${projectId}/workbench-tabs`
      : `/api/projects/${projectId}/workbench-tabs?scope=${scope}`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        const saved: Array<{ id: string; label: string; type?: WorkbenchTabType }> = data.tabs || [];
        const savedActiveTabId: string | undefined = data.activeTabId;
        setState((prev) => {
          const existing = prev[key];

          let tabs: WorkbenchTab[];
          if (saved.length > 0) {
            tabs = saved.map((t) => ({ id: t.id, label: t.label, type: t.type || 'shell' }));
          } else {
            tabs = defaultTabs(projectId, scope);
          }

          // Restore saved active tab if it still exists, otherwise fall back
          const activeTabId =
            (savedActiveTabId && tabs.find((t) => t.id === savedActiveTabId) ? savedActiveTabId : null)
            ?? (existing?.activeTabId && tabs.find((t) => t.id === existing.activeTabId) ? existing.activeTabId : null)
            ?? tabs[0].id;

          return { ...prev, [key]: { tabs, activeTabId, hydrated: true } };
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
    (projectId: string, scope: WorkbenchScope = 'project'): WorkbenchTab[] => getOrCreate(state, projectId, scope).tabs,
    [state]
  );

  const getActiveTabId = useCallback(
    (projectId: string, scope: WorkbenchScope = 'project'): string => getOrCreate(state, projectId, scope).activeTabId,
    [state]
  );

  const setActiveTabId = useCallback((projectId: string, tabId: string, scope: WorkbenchScope = 'project') => {
    const key = scopedKey(projectId, scope);
    setState((prev) => {
      const ps = getOrCreate(prev, projectId, scope);
      const next = { ...prev, [key]: { ...ps, activeTabId: tabId } };
      persistTabs(projectId, next[key], scope);
      return next;
    });
  }, [persistTabs]);

  const openTab = useCallback(
    (projectId: string, tabId: string, label: string, type: WorkbenchTabType, scope: WorkbenchScope = 'project') => {
      const key = scopedKey(projectId, scope);
      setState((prev) => {
        const ps = getOrCreate(prev, projectId, scope);
        if (ps.tabs.find((t) => t.id === tabId)) {
          return { ...prev, [key]: { ...ps, activeTabId: tabId } };
        }
        const newTab: WorkbenchTab = { id: tabId, label, type };
        const next = {
          ...prev,
          [key]: {
            ...ps,
            tabs: [...ps.tabs, newTab],
            activeTabId: tabId,
          },
        };
        persistTabs(projectId, next[key], scope);
        return next;
      });
    },
    [persistTabs]
  );

  const closeTab = useCallback((projectId: string, tabId: string, scope: WorkbenchScope = 'project') => {
    const key = scopedKey(projectId, scope);
    const ps = getOrCreate(state, projectId, scope);
    const tab = ps.tabs.find((t) => t.id === tabId);
    if (tab?.type === 'agent') {
      fetch(`/api/agent-tab/${tabId}`, { method: 'DELETE' }).catch(() => {});
    } else {
      fetch(`/api/shell/${tabId}`, { method: 'DELETE' }).catch(() => {});
    }

    setState((prev) => {
      const ps = getOrCreate(prev, projectId, scope);
      const closedIndex = ps.tabs.findIndex((t) => t.id === tabId);
      const filtered = ps.tabs.filter((t) => t.id !== tabId);
      let activeTabId: string;
      if (filtered.length === 0) {
        activeTabId = '';
      } else if (ps.activeTabId !== tabId) {
        activeTabId = ps.activeTabId;
      } else {
        // Select the previous tab, or the next if closing the first tab
        activeTabId = filtered[closedIndex > 0 ? closedIndex - 1 : 0].id;
      }
      const next = { ...prev, [key]: { ...ps, tabs: filtered, activeTabId } };
      persistTabs(projectId, next[key], scope);
      return next;
    });
  }, [state, persistTabs]);

  const renameTab = useCallback((projectId: string, tabId: string, label: string, scope: WorkbenchScope = 'project') => {
    const key = scopedKey(projectId, scope);
    setState((prev) => {
      const ps = getOrCreate(prev, projectId, scope);
      const next = {
        ...prev,
        [key]: {
          ...ps,
          tabs: ps.tabs.map((t) =>
            t.id === tabId ? { ...t, label } : t
          ),
        },
      };
      persistTabs(projectId, next[key], scope);
      return next;
    });
  }, [persistTabs]);

  const reorderTabs = useCallback((projectId: string, newTabs: WorkbenchTab[], scope: WorkbenchScope = 'project') => {
    const key = scopedKey(projectId, scope);
    setState((prev) => {
      const ps = getOrCreate(prev, projectId, scope);
      const next = { ...prev, [key]: { ...ps, tabs: newTabs } };
      persistTabs(projectId, next[key], scope);
      return next;
    });
  }, [persistTabs]);

  return (
    <WorkbenchTabsContext.Provider
      value={{ getTabs, getActiveTabId, setActiveTabId, openTab, closeTab, renameTab, reorderTabs, hydrateProject }}
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
