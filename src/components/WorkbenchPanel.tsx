'use client';

import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { Plus, TerminalIcon, SquareChevronUpIcon, ChevronUp, ChevronDown, MoreHorizontal, PencilIcon, Trash2Icon, EraserIcon } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useWorkbenchTabs, type WorkbenchTab, type WorkbenchScope } from './WorkbenchTabsProvider';
import { TerminalPane, setTerminalDraft } from './TerminalPane';
import { AgentTabPane, setAgentDraft } from './AgentTabPane';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

interface AddTabOptions {
  /** Pre-fill text: sent to terminal once WS connects, or placed in agent message input */
  initialInput?: string;
  /** If true, activate an existing tab of this type instead of creating a new one (default: false) */
  reuse?: boolean;
}

export interface WorkbenchPanelHandle {
  addShellTab: (opts?: AddTabOptions) => Promise<void>;
  addAgentTab: (opts?: AddTabOptions) => void;
}

interface WorkbenchPanelProps {
  projectId: string;
  projectPath?: string;
  scope?: WorkbenchScope;
  agentContext?: string;
  style?: React.CSSProperties;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onExpand?: () => void;
  onResizeStart?: (e: React.MouseEvent) => void;
  isDragging?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Sortable tab item                                                         */
/* -------------------------------------------------------------------------- */

interface SortableTabProps {
  tab: WorkbenchTab;
  isActive: boolean;
  isRenaming: boolean;
  renameValue: string;
  setRenameValue: (v: string) => void;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onSelect: () => void;
  onDoubleClick: () => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onRenameStart: () => void;
  onRemove: () => void;
  onClear: () => void;
}

function SortableTab({
  tab, isActive, isRenaming, renameValue, setRenameValue,
  renameInputRef, onSelect, onDoubleClick, onSubmitRename,
  onCancelRename, onRenameStart, onRemove, onClear,
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const icon = tab.type === 'agent'
    ? <SquareChevronUpIcon className="w-3 h-3 shrink-0" />
    : <TerminalIcon className="w-3 h-3 shrink-0" />;

  return (
    <div ref={setNodeRef} style={style} className="group/tab flex items-stretch shrink-0 relative" {...attributes} {...listeners}>
      <button
        onClick={onSelect}
        onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
        className={`relative flex items-center gap-1.5 px-4 self-stretch text-xs min-w-[100px] ${
          isActive
            ? 'bg-surface-hover/60 text-text-chrome-active'
            : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-hover/30'
        }`}
      >
        {icon}
        <span className="relative">
          <span className={`max-w-[120px] truncate block ${isRenaming ? 'invisible' : ''}`}>
            {tab.label}
          </span>
          {isRenaming && (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSubmitRename();
                if (e.key === 'Escape') onCancelRename();
              }}
              onBlur={onSubmitRename}
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-0 bg-transparent border border-border-default rounded px-1 text-xs outline-none focus:border-text-secondary"
            />
          )}
        </span>
        {/* Dots menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <span
              data-clickable
              onClick={(e) => e.stopPropagation()}
              className={`absolute right-0 inset-y-0 flex items-center pl-4 pr-2 opacity-0 group-hover/tab:opacity-100 transition-opacity cursor-pointer text-text-tertiary hover:text-text-secondary bg-gradient-to-l from-50% to-transparent ${
                isActive ? 'from-surface-hover/60' : 'from-surface-topbar group-hover/tab:from-surface-hover/30'
              }`}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="w-40">
            <DropdownMenuItem onSelect={onRenameStart}>
              <PencilIcon className="w-3.5 h-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onClear}>
              <EraserIcon className="w-3.5 h-3.5" />
              Clear
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onRemove}
              className="text-red-400 hover:text-red-300 focus:text-red-300"
            >
              <Trash2Icon className="w-3.5 h-3.5" />
              {tab.type === 'agent' ? 'Close Agent' : 'Kill Terminal'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Panel component                                                           */
/* -------------------------------------------------------------------------- */

const WorkbenchPanel = forwardRef<WorkbenchPanelHandle, WorkbenchPanelProps>(function WorkbenchPanel({ projectId, projectPath, scope = 'project', agentContext, style, collapsed, onToggleCollapsed, onExpand, onResizeStart, isDragging }, ref) {
  const { getTabs, getActiveTabId, setActiveTabId, openTab, closeTab, renameTab, reorderTabs, hydrateProject } = useWorkbenchTabs();
  const panelRef = useRef<HTMLDivElement>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Hydrate persisted tabs on mount
  useEffect(() => { hydrateProject(projectId, scope); }, [projectId, scope, hydrateProject]);

  const tabs = getTabs(projectId, scope);
  const activeTabId = getActiveTabId(projectId, scope);

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
      renameTab(projectId, renamingTabId, renameValue.trim(), scope);
    }
    setRenamingTabId(null);
    setRenameValue('');
  }, [renamingTabId, renameValue, renameTab, projectId, scope]);

  const addShellTab = useCallback(async (opts?: AddTabOptions) => {
    const { initialInput, reuse } = opts ?? {};

    if (reuse) {
      const existing = tabs.find((t) => t.type === 'shell');
      if (existing) {
        if (initialInput) setTerminalDraft(existing.id, initialInput);
        setActiveTabId(projectId, existing.id, scope);
        return;
      }
    }

    const id = `shell-${uuidv4().slice(0, 8)}`;
    const shellCount = tabs.filter((t) => t.type === 'shell').length + 1;

    if (initialInput) setTerminalDraft(id, initialInput);

    await fetch('/api/shell/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabId: id, cwd: projectPath }),
    });

    openTab(projectId, id, `Terminal ${shellCount}`, 'shell', scope);
  }, [tabs, openTab, setActiveTabId, projectId, projectPath, scope]);

  const addAgentTab = useCallback((opts?: AddTabOptions) => {
    const { initialInput, reuse } = opts ?? {};

    if (reuse) {
      const existing = tabs.find((t) => t.type === 'agent');
      if (existing) {
        if (initialInput) setAgentDraft(existing.id, initialInput);
        setActiveTabId(projectId, existing.id, scope);
        return;
      }
    }

    const id = `agent-${uuidv4().slice(0, 8)}`;
    const agentCount = tabs.filter((t) => t.type === 'agent').length + 1;
    if (initialInput) setAgentDraft(id, initialInput);
    openTab(projectId, id, `Agent ${agentCount}`, 'agent', scope);
  }, [tabs, openTab, setActiveTabId, projectId, scope]);

  useImperativeHandle(ref, () => ({ addShellTab, addAgentTab }), [addShellTab, addAgentTab]);

  const removeTab = useCallback(
    (tabId: string) => {
      closeTab(projectId, tabId, scope);
    },
    [closeTab, projectId, scope]
  );

  const clearTab = useCallback(
    (tab: WorkbenchTab) => {
      window.dispatchEvent(new CustomEvent('workbench-clear-tab', { detail: { tabId: tab.id, type: tab.type } }));
    },
    []
  );

  // DnD sensors — require 5px movement before activating to avoid blocking clicks
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = tabs.findIndex((t) => t.id === active.id);
      const newIndex = tabs.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      reorderTabs(projectId, arrayMove(tabs, oldIndex, newIndex), scope);
    },
    [tabs, reorderTabs, projectId, scope]
  );

  return (
    <div
      ref={panelRef}
      className="w-full flex flex-col bg-surface-deep flex-shrink-0"
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
          className={`h-12 flex items-stretch bg-surface-secondary overflow-visible border-t border-border-default ${
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
          className="flex items-center justify-center w-12 self-stretch text-text-placeholder hover:text-text-secondary hover:bg-surface-hover/30 shrink-0"
          title={collapsed ? 'Expand terminal' : 'Collapse terminal'}
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={activeTabId === tab.id}
                isRenaming={renamingTabId === tab.id}
                renameValue={renameValue}
                setRenameValue={setRenameValue}
                renameInputRef={renameInputRef}
                onSelect={() => {
                  setActiveTabId(projectId, tab.id, scope);
                  if (collapsed) (onExpand ?? onToggleCollapsed)();
                }}
                onDoubleClick={() => {
                  setRenamingTabId(tab.id);
                  setRenameValue(tab.label);
                }}
                onSubmitRename={submitRename}
                onCancelRename={() => { setRenamingTabId(null); setRenameValue(''); }}
                onRenameStart={() => {
                  setRenamingTabId(tab.id);
                  setRenameValue(tab.label);
                }}
                onRemove={() => removeTab(tab.id)}
                onClear={() => clearTab(tab)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* New tab button with dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center justify-center w-12 self-stretch h-full text-text-placeholder hover:text-text-secondary hover:bg-surface-hover/30 shrink-0"
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
          {tabs.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-text-placeholder text-xs">
              No open tabs
            </div>
          ) : (
            tabs.map((tab) =>
              tab.type === 'agent' ? (
                <AgentTabPane key={tab.id} tabId={tab.id} projectId={projectId} visible={activeTabId === tab.id} context={agentContext} />
              ) : (
                <TerminalPane key={tab.id} tabId={tab.id} visible={activeTabId === tab.id} cwd={projectPath} enableDrop />
              )
            )
          )}
        </div>
      )}

    </div>
  );
});

export default WorkbenchPanel;
