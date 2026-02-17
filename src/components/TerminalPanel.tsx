'use client';

import React, {
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { Plus, X, TerminalIcon, ChevronUp, ChevronDown } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useTerminalTabs, type TerminalTab } from './TerminalTabsProvider';
import { TerminalPane } from './TerminalPane';

interface TerminalPanelProps {
  projectId: string;
  projectPath?: string;
  style?: React.CSSProperties;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Panel component                                                            */
/* -------------------------------------------------------------------------- */

export default function TerminalPanel({ projectId, projectPath, style, collapsed, onToggleCollapsed }: TerminalPanelProps) {
  const { getTabs, getActiveTabId, setActiveTabId, openTab, closeTab } = useTerminalTabs();
  const panelRef = useRef<HTMLDivElement>(null);

  const tabs = getTabs(projectId);
  const activeTabId = getActiveTabId(projectId);

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
    tab.type === 'task' ? 'text-steel' : 'text-patina';

  return (
    <div
      ref={panelRef}
      className="w-full flex flex-col bg-gunmetal-200 dark:bg-black/40 flex-shrink-0 font-mono"
      style={{ minHeight: 0, ...(collapsed ? {} : style) }}
    >
      {/* Tab Bar */}
      <div className="h-14 flex items-center border-t border-gunmetal-300/60 dark:border-zinc-800/60 bg-gunmetal-300/20 dark:bg-zinc-900/20 px-1 overflow-x-auto shrink-0">
        <button
          onClick={onToggleCollapsed}
          className="flex items-center justify-center w-7 h-7 text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 hover:bg-gunmetal-300/30 dark:hover:bg-zinc-800/30 rounded-md ml-1 mr-2 shrink-0"
          title={collapsed ? 'Expand terminal' : 'Collapse terminal'}
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTabId(projectId, tab.id)}
            className={`flex items-center gap-1.5 px-3 h-8 text-xs rounded-md transition-colors shrink-0 ${
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
          onClick={addShellTab}
          className="flex items-center justify-center w-7 h-7 text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 hover:bg-gunmetal-300/30 dark:hover:bg-zinc-800/30 rounded-md ml-1 shrink-0"
          title="New terminal"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>

      </div>

      {/* Terminal Panes — each manages its own xterm lifecycle */}
      {!collapsed && (
        <div className="flex-1 relative" style={{ minHeight: 0 }}>
          {tabs.map((tab) => (
            <TerminalPane key={tab.id} tabId={tab.id} visible={activeTabId === tab.id} cwd={projectPath} />
          ))}
        </div>
      )}
    </div>
  );
}
