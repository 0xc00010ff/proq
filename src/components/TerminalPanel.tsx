'use client';

import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
} from 'react';
import { Plus, X, TerminalIcon, ChevronUp, ChevronDown, GripHorizontal } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useTerminalTabs, type TerminalTab } from './TerminalTabsProvider';
import { TerminalPane } from './TerminalPane';

interface TerminalPanelProps {
  projectId: string;
  projectPath?: string;
  style?: React.CSSProperties;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  cleanupTimes?: Record<string, number>;
  onResizeStart?: (e: React.MouseEvent) => void;
  isDragging?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Panel component                                                            */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*  Cleanup countdown helper                                                   */
/* -------------------------------------------------------------------------- */

function useCleanupCountdown(expiresAt: number | undefined): string | null {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!expiresAt) return null;

  const remaining = expiresAt - now;
  if (remaining <= 0) return 'process will be terminated shortly';

  const mins = Math.ceil(remaining / 60_000);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const m = mins % 60;
    return `process will be terminated in ${hrs}h ${m}m`;
  }
  return `process will be terminated in ${mins}m`;
}

export default function TerminalPanel({ projectId, projectPath, style, collapsed, onToggleCollapsed, cleanupTimes, onResizeStart, isDragging }: TerminalPanelProps) {
  const { getTabs, getActiveTabId, setActiveTabId, openTab, closeTab, hydrateProject } = useTerminalTabs();
  const panelRef = useRef<HTMLDivElement>(null);

  // Hydrate persisted shell tabs on mount
  useEffect(() => { hydrateProject(projectId); }, [projectId, hydrateProject]);

  const tabs = getTabs(projectId);
  const activeTabId = getActiveTabId(projectId);

  // Find cleanup expiry for the active task tab
  const activeTab = tabs.find((t) => t.id === activeTabId);
  let activeCleanupExpiresAt: number | undefined;
  if (activeTab?.type === 'task' && cleanupTimes) {
    // Tab ID is "task-{first8}", cleanup keys are full task IDs
    const shortId = activeTab.id.replace('task-', '');
    const matchingKey = Object.keys(cleanupTimes).find((k) => k.startsWith(shortId));
    if (matchingKey) activeCleanupExpiresAt = cleanupTimes[matchingKey];
  }
  const countdownText = useCleanupCountdown(activeCleanupExpiresAt);

  // Load xterm CSS once
  useEffect(() => {
    const linkId = 'xterm-css';
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = '/xterm.css';
      document.head.appendChild(link);
    }
  }, []);

  const addShellTab = useCallback(async () => {
    const id = `shell-${uuidv4().slice(0, 8)}`;
    const shellCount = tabs.filter((t) => t.type === 'shell').length + 1;

    await fetch('/api/terminal/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabId: id, cwd: projectPath }),
    });

    openTab(projectId, id, `Terminal ${shellCount}`, 'shell');
  }, [tabs, openTab, projectId, projectPath]);

  const removeTab = useCallback(
    (tabId: string) => {
      closeTab(projectId, tabId);
    },
    [closeTab, projectId]
  );

  const tabAccentColor = (tab: TerminalTab) =>
    tab.type === 'task' ? 'text-steel' : 'text-gunmetal-500';

  return (
    <div
      ref={panelRef}
      className="w-full flex flex-col bg-gunmetal-200 dark:bg-black/40 flex-shrink-0 font-mono"
      style={{ minHeight: 0, ...(collapsed ? {} : style) }}
    >
      {/* Tab Bar — also serves as the resize drag handle */}
      <div
        className={`h-12 flex items-stretch border-t border-gunmetal-300/60 dark:border-zinc-800/60 bg-gunmetal-300/20 dark:bg-zinc-900/20 overflow-x-auto shrink-0 ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        onMouseDown={(e) => {
          // Don't start resize if clicking on interactive elements
          const target = e.target as HTMLElement;
          if (target.closest('button') || target.closest('[data-clickable]')) return;
          onResizeStart?.(e);
        }}
      >
        <button
          onClick={onToggleCollapsed}
          className="flex items-center justify-center w-12 self-stretch text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 hover:bg-gunmetal-300/30 dark:hover:bg-zinc-800/30 shrink-0"
          title={collapsed ? 'Expand terminal' : 'Collapse terminal'}
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTabId(projectId, tab.id);
              if (collapsed) onToggleCollapsed();
            }}
            className={`flex items-center gap-1.5 px-3 self-stretch text-xs transition-colors shrink-0 ${
              activeTabId === tab.id
                ? 'bg-gunmetal-300/60 dark:bg-zinc-800/60 ' + tabAccentColor(tab)
                : 'text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-400 hover:bg-gunmetal-300/30 dark:hover:bg-zinc-800/30'
            }`}
          >
            <TerminalIcon className="w-3 h-3" />
            <span className="max-w-[120px] truncate">
              {tab.status === 'done' ? '\u2705 ' : ''}
              {tab.label}
            </span>
            <span
              data-clickable
              onClick={(e) => {
                e.stopPropagation();
                removeTab(tab.id);
              }}
              className="ml-1 text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </span>
          </button>
        ))}

        <button
          onClick={() => {
            addShellTab();
            if (collapsed) onToggleCollapsed();
          }}
          className="flex items-center justify-center px-2.5 self-stretch text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 hover:bg-gunmetal-300/30 dark:hover:bg-zinc-800/30 shrink-0"
          title="New terminal"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>

        {/* Grip indicator — fills remaining space */}
        <div className="flex-1 flex items-center justify-center">
          <GripHorizontal className="w-4 h-4 text-zinc-700/40" />
        </div>
      </div>

      {/* Terminal Panes — each manages its own xterm lifecycle */}
      {!collapsed && (
        <div className="flex-1 relative" style={{ minHeight: 0 }}>
          {tabs.map((tab) => (
            <TerminalPane key={tab.id} tabId={tab.id} visible={activeTabId === tab.id} cwd={projectPath} enableDrop />
          ))}
        </div>
      )}

      {/* Cleanup countdown footer */}
      {!collapsed && countdownText && (
        <div className="px-3 py-1 text-xs text-zinc-600 dark:text-zinc-600 font-mono shrink-0">
          {countdownText}
        </div>
      )}
    </div>
  );
}
