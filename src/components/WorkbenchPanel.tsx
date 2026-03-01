'use client';

import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
} from 'react';
import { Plus, TerminalIcon, SquareChevronUpIcon, ChevronUp, ChevronDown, MoreHorizontal, PencilIcon, Trash2Icon } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useWorkbenchTabs, type WorkbenchTab } from './WorkbenchTabsProvider';
import { TerminalPane } from './TerminalPane';
import { AgentTabPane } from './AgentTabPane';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

interface WorkbenchPanelProps {
  projectId: string;
  projectPath?: string;
  style?: React.CSSProperties;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onExpand?: () => void;
  onResizeStart?: (e: React.MouseEvent) => void;
  isDragging?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Panel component                                                            */
/* -------------------------------------------------------------------------- */

export default function WorkbenchPanel({ projectId, projectPath, style, collapsed, onToggleCollapsed, onExpand, onResizeStart, isDragging }: WorkbenchPanelProps) {
  const { getTabs, getActiveTabId, setActiveTabId, openTab, closeTab, renameTab, hydrateProject } = useWorkbenchTabs();
  const panelRef = useRef<HTMLDivElement>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Hydrate persisted tabs on mount
  useEffect(() => { hydrateProject(projectId); }, [projectId, hydrateProject]);

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

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingTabId) renameInputRef.current?.focus();
  }, [renamingTabId]);

  const submitRename = useCallback(() => {
    if (renamingTabId && renameValue.trim()) {
      renameTab(projectId, renamingTabId, renameValue.trim());
    }
    setRenamingTabId(null);
    setRenameValue('');
  }, [renamingTabId, renameValue, renameTab, projectId]);

  const addShellTab = useCallback(async () => {
    const id = `shell-${uuidv4().slice(0, 8)}`;
    const shellCount = tabs.filter((t) => t.type === 'shell').length + 1;

    await fetch('/api/shell/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabId: id, cwd: projectPath }),
    });

    openTab(projectId, id, `Terminal ${shellCount}`, 'shell');
  }, [tabs, openTab, projectId, projectPath]);

  const addAgentTab = useCallback(() => {
    const id = `agent-${uuidv4().slice(0, 8)}`;
    const agentCount = tabs.filter((t) => t.type === 'agent').length + 1;
    openTab(projectId, id, `Agent ${agentCount}`, 'agent');
  }, [tabs, openTab, projectId]);

  const removeTab = useCallback(
    (tabId: string) => {
      closeTab(projectId, tabId);
    },
    [closeTab, projectId]
  );

  const tabIcon = (tab: WorkbenchTab) =>
    tab.type === 'agent'
      ? <SquareChevronUpIcon className="w-3 h-3" />
      : <TerminalIcon className="w-3 h-3" />;

  return (
    <div
      ref={panelRef}
      className="w-full flex flex-col bg-bronze-200 dark:bg-[#0C0C0C] flex-shrink-0 font-mono"
      style={{ minHeight: 0, ...(collapsed ? {} : style) }}
    >
      {/* Tab Bar — also serves as the resize drag handle */}
      <div className="relative shrink-0">
        {/* Edge resize strip — sits over the top border */}
        {!collapsed && (
          <div
            onMouseDown={(e) => onResizeStart?.(e)}
            className="absolute inset-x-0 top-0 h-[5px] -translate-y-1/2 cursor-row-resize z-20 group/edge"
          >
            <div className="absolute inset-x-0 top-1/2 h-px bg-transparent group-hover/edge:bg-bronze-800 transition-colors" />
          </div>
        )}
        <div
          className={`h-12 flex items-stretch bg-bronze-300/20 dark:bg-zinc-900/20 overflow-visible border-t border-zinc-200 dark:border-zinc-800 ${
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
          className="flex items-center justify-center w-12 self-stretch text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 hover:bg-bronze-300/30 dark:hover:bg-zinc-800/30 shrink-0"
          title={collapsed ? 'Expand terminal' : 'Collapse terminal'}
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {tabs.map((tab) => (
          <div key={tab.id} className="group/tab flex items-stretch shrink-0 relative">
            <button
              onClick={() => {
                setActiveTabId(projectId, tab.id);
                if (collapsed) (onExpand ?? onToggleCollapsed)();
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setRenamingTabId(tab.id);
                setRenameValue(tab.label);
              }}
              className={`relative flex items-center gap-1.5 px-3 self-stretch text-xs transition-colors min-w-[100px] ${
                activeTabId === tab.id
                  ? 'bg-bronze-300/60 dark:bg-zinc-800/60 text-bronze-500'
                  : 'text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-400 hover:bg-bronze-300/30 dark:hover:bg-zinc-800/30'
              }`}
            >
              {tabIcon(tab)}
              <span className="relative">
                {/* Always rendered to preserve tab width */}
                <span className={`max-w-[120px] truncate block ${renamingTabId === tab.id ? 'invisible' : ''}`}>
                  {tab.label}
                </span>
                {renamingTabId === tab.id && (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename();
                      if (e.key === 'Escape') { setRenamingTabId(null); setRenameValue(''); }
                    }}
                    onBlur={submitRename}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-0 bg-transparent border border-zinc-600 rounded px-1 text-xs outline-none focus:border-zinc-400"
                  />
                )}
              </span>
              {/* Dots menu — hidden until hover */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <span
                    data-clickable
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 inset-y-0 flex items-center pl-4 pr-2 opacity-0 group-hover/tab:opacity-100 transition-opacity cursor-pointer text-zinc-500 hover:text-zinc-300 bg-gradient-to-l from-zinc-900/90 from-50% to-transparent"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="bottom" className="w-40">
                  <DropdownMenuItem
                    onSelect={() => {
                      setRenamingTabId(tab.id);
                      setRenameValue(tab.label);
                    }}
                  >
                    <PencilIcon className="w-3.5 h-3.5" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => removeTab(tab.id)}
                    className="text-red-400 hover:text-red-300 focus:text-red-300"
                  >
                    <Trash2Icon className="w-3.5 h-3.5" />
                    {tab.type === 'agent' ? 'Close Agent' : 'Kill Terminal'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </button>
          </div>
        ))}

        {/* New tab button with dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center justify-center w-12 self-stretch h-full text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 hover:bg-bronze-300/30 dark:hover:bg-zinc-800/30 shrink-0"
              title="New tab"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="w-40">
            <DropdownMenuItem
              onSelect={() => {
                addAgentTab();
                if (collapsed) (onExpand ?? onToggleCollapsed)();
              }}
            >
              <SquareChevronUpIcon className="w-3.5 h-3.5" />
              Agent
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                addShellTab();
                if (collapsed) (onExpand ?? onToggleCollapsed)();
              }}
            >
              <TerminalIcon className="w-3.5 h-3.5" />
              Terminal
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Spacer — fills remaining space for grab target */}
        <div className="flex-1" />
        </div>
      </div>

      {/* Panes — each manages its own lifecycle */}
      {!collapsed && (
        <div className="flex-1 relative" style={{ minHeight: 0 }}>
          {tabs.map((tab) =>
            tab.type === 'agent' ? (
              <AgentTabPane key={tab.id} tabId={tab.id} projectId={projectId} visible={activeTabId === tab.id} />
            ) : (
              <TerminalPane key={tab.id} tabId={tab.id} visible={activeTabId === tab.id} cwd={projectPath} enableDrop />
            )
          )}
        </div>
      )}

    </div>
  );
}
