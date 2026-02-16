'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

export interface TerminalTab {
  id: string;
  label: string;
  type: 'shell' | 'task';
  status?: 'running' | 'done';
}

interface ProjectTerminalState {
  tabs: TerminalTab[];
  activeTabId: string;
}

interface TerminalTabsContextValue {
  getTabs(projectId: string): TerminalTab[];
  getActiveTabId(projectId: string): string;
  setActiveTabId(projectId: string, tabId: string): void;
  openTab(projectId: string, tabId: string, label: string, type: 'shell' | 'task'): void;
  closeTab(projectId: string, tabId: string): void;
  markTabDone(projectId: string, tabId: string): void;
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

export function TerminalTabsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Record<string, ProjectTerminalState>>({});

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
      return { ...prev, [projectId]: { ...ps, activeTabId: tabId } };
    });
  }, []);

  const openTab = useCallback(
    (projectId: string, tabId: string, label: string, type: 'shell' | 'task') => {
      setState((prev) => {
        const ps = getOrCreate(prev, projectId);
        if (ps.tabs.find((t) => t.id === tabId)) {
          // Already exists — just activate
          return { ...prev, [projectId]: { ...ps, activeTabId: tabId } };
        }
        const newTab: TerminalTab = {
          id: tabId,
          label,
          type,
          ...(type === 'task' ? { status: 'running' as const } : {}),
        };
        return {
          ...prev,
          [projectId]: {
            tabs: [...ps.tabs, newTab],
            activeTabId: tabId,
          },
        };
      });
    },
    []
  );

  const closeTab = useCallback((projectId: string, tabId: string) => {
    fetch(`/api/terminal/${tabId}`, { method: 'DELETE' }).catch(() => {});

    setState((prev) => {
      const ps = getOrCreate(prev, projectId);
      const filtered = ps.tabs.filter((t) => t.id !== tabId);
      if (filtered.length === 0) {
        const dt = defaultTab(projectId);
        return {
          ...prev,
          [projectId]: { tabs: [dt], activeTabId: dt.id },
        };
      }
      const activeTabId = ps.activeTabId === tabId ? filtered[0].id : ps.activeTabId;
      return { ...prev, [projectId]: { tabs: filtered, activeTabId } };
    });
  }, []);

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
      value={{ getTabs, getActiveTabId, setActiveTabId, openTab, closeTab, markTabDone }}
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
