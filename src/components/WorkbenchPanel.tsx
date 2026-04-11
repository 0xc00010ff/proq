'use client';

import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
  useReducer,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { Plus, TerminalIcon, SquareChevronUpIcon, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal, PencilIcon, Trash2Icon, EraserIcon, PanelBottom, PanelRight } from 'lucide-react';
import { v7 as uuidv7 } from 'uuid';
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
import { TerminalPane, setTerminalDraft } from './TerminalPane';
import { AgentTabPane, setAgentDraft } from './AgentTabPane';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useResizablePanel } from '@/hooks/useResizablePanel';
import type { Agent } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type WorkbenchTabType = 'shell' | 'agent';

export interface WorkbenchTab {
  id: string;
  label: string;
  type: WorkbenchTabType;
  agentId?: string;
}

interface AddTabOptions {
  /** Pre-fill text: sent to terminal once WS connects, or placed in agent message input */
  initialInput?: string;
  /** If true, activate an existing tab of this type instead of creating a new one (default: false) */
  reuse?: boolean;
  /** Agent ID to associate with this agent tab */
  agentId?: string;
}

export type WorkbenchOrientation = 'bottom' | 'right';

export interface WorkbenchPanelHandle {
  addShellTab: (opts?: AddTabOptions) => Promise<void>;
  addAgentTab: (opts?: AddTabOptions) => void;
  expand: () => void;
  toggle: () => void;
}

interface WorkbenchPanelProps {
  projectId: string;
  projectPath?: string;
  agentMap?: Map<string, Agent>;
  defaultAgentId?: string;
  onOrientationChange?: (orientation: WorkbenchOrientation) => void;
}

/* -------------------------------------------------------------------------- */
/*  Tab reducer                                                                */
/* -------------------------------------------------------------------------- */

interface TabState {
  tabs: WorkbenchTab[];
  activeTabId: string;
}

type TabAction =
  | { type: 'hydrate'; tabs: WorkbenchTab[]; activeTabId: string }
  | { type: 'open'; tab: WorkbenchTab }
  | { type: 'close'; tabId: string }
  | { type: 'activate'; tabId: string }
  | { type: 'rename'; tabId: string; label: string }
  | { type: 'reorder'; tabs: WorkbenchTab[] };

function defaultTabs(): WorkbenchTab[] {
  return [
    { id: uuidv7(), label: 'Agent', type: 'agent' },
    { id: uuidv7(), label: 'Terminal', type: 'shell' },
  ];
}

function tabReducer(state: TabState, action: TabAction): TabState {
  switch (action.type) {
    case 'hydrate':
      return { tabs: action.tabs, activeTabId: action.activeTabId };

    case 'open': {
      const existing = state.tabs.find((t) => t.id === action.tab.id);
      if (existing) return { ...state, activeTabId: action.tab.id };
      return { tabs: [...state.tabs, action.tab], activeTabId: action.tab.id };
    }

    case 'close': {
      const idx = state.tabs.findIndex((t) => t.id === action.tabId);
      if (idx === -1) return state;
      const filtered = state.tabs.filter((t) => t.id !== action.tabId);
      let newActiveTabId = state.activeTabId;
      if (state.activeTabId === action.tabId) {
        // Select the tab at the same position in the filtered array, or the last one
        if (idx < filtered.length) newActiveTabId = filtered[idx].id;
        else if (filtered.length > 0) newActiveTabId = filtered[filtered.length - 1].id;
        else newActiveTabId = '';
      }
      return { tabs: filtered, activeTabId: newActiveTabId };
    }

    case 'activate': {
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      return { ...state, activeTabId: action.tabId };
    }

    case 'rename':
      return {
        ...state,
        tabs: state.tabs.map((t) => t.id === action.tabId ? { ...t, label: action.label } : t),
      };

    case 'reorder':
      return { ...state, tabs: action.tabs };

    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/*  Sortable tab item (bottom mode)                                           */
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
/*  New tab dropdown (shared between both headers)                            */
/* -------------------------------------------------------------------------- */

interface NewTabDropdownProps {
  agentMap?: Map<string, Agent>;
  defaultAgentId?: string;
  collapsed: boolean;
  expandPanel: () => void;
  addAgentTab: (opts?: AddTabOptions) => void;
  addShellTab: (opts?: AddTabOptions) => Promise<void>;
}

function NewTabDropdown({ agentMap, defaultAgentId, collapsed, expandPanel, addAgentTab, addShellTab }: NewTabDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center justify-center w-10 self-stretch h-full text-text-placeholder hover:text-text-secondary hover:bg-surface-hover/30 shrink-0"
          title="New tab"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="w-40">
        {agentMap && agentMap.size > 1 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <SquareChevronUpIcon className="w-3.5 h-3.5" />
              Agent
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              {Array.from(agentMap.values()).map((agent) => (
                <DropdownMenuItem
                  key={agent.id}
                  onSelect={() => {
                    if (collapsed) expandPanel();
                    addAgentTab({ agentId: agent.id });
                  }}
                >
                  {agent.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : (
          <DropdownMenuItem
            onSelect={() => {
              if (collapsed) expandPanel();
              addAgentTab(defaultAgentId ? { agentId: defaultAgentId } : undefined);
            }}
          >
            <SquareChevronUpIcon className="w-3.5 h-3.5" />
            Agent
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() => {
            if (collapsed) expandPanel();
            addShellTab();
          }}
        >
          <TerminalIcon className="w-3.5 h-3.5" />
          Terminal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------------------------------------------------- */
/*  Panel component                                                           */
/* -------------------------------------------------------------------------- */

const TAB_BAR_HEIGHT = 48; // px — matches h-12

const WorkbenchPanel = forwardRef<WorkbenchPanelHandle, WorkbenchPanelProps>(function WorkbenchPanel({ projectId, projectPath, agentMap, defaultAgentId, onOrientationChange }, ref) {
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const agentMapRef = useRef(agentMap);
  agentMapRef.current = agentMap;

  // --- Orientation state ---
  const [orientation, setOrientation] = useState<WorkbenchOrientation>('bottom');
  const isRight = orientation === 'right';

  // Discover parent container for resize calculations
  useEffect(() => {
    containerRef.current = panelRef.current?.parentElement as HTMLDivElement | null;
  }, []);

  // --- Resize state ---
  const patchWorkbenchState = useCallback((data: { open?: boolean; height?: number; orientation?: WorkbenchOrientation }) => {
    fetch(`/api/projects/${projectId}/workbench-state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => {});
  }, [projectId]);

  const workbench = useResizablePanel(containerRef, {
    defaultPercent: 60,
    closedPercent: 25,
    onPersist: (height) => patchWorkbenchState({ height }),
    axis: isRight ? 'horizontal' : 'vertical',
  });

  // Restore collapsed/height/orientation from server on mount
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/workbench-state`)
      .then((res) => res.json())
      .then((data) => {
        workbench.setCollapsed(!data.open);
        if (typeof data.height === 'number') workbench.setPercent(data.height);
        if (data.orientation) {
          setOrientation(data.orientation);
          onOrientationChange?.(data.orientation);
        }
      })
      .catch(() => {});
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCollapsed = useCallback(() => {
    workbench.setCollapsed((prev: boolean) => {
      patchWorkbenchState({ open: prev }); // prev=true means it was collapsed, now opening
      return !prev;
    });
  }, [workbench, patchWorkbenchState]);

  const expandPanel = useCallback(() => {
    workbench.setCollapsed((prev: boolean) => {
      if (!prev) return prev;
      patchWorkbenchState({ open: true });
      return false;
    });
    workbench.setPercent((prev: number) => Math.max(prev, 40));
  }, [workbench, patchWorkbenchState]);

  const toggleOrientation = useCallback(() => {
    setOrientation((prev) => {
      const next = prev === 'bottom' ? 'right' : 'bottom';
      patchWorkbenchState({ orientation: next });
      onOrientationChange?.(next);
      return next;
    });
  }, [patchWorkbenchState, onOrientationChange]);

  // --- Tab state (internalized from WorkbenchTabsProvider) ---
  const initialTabs = defaultTabs();
  const [tabState, dispatch] = useReducer(tabReducer, { tabs: initialTabs, activeTabId: initialTabs[0].id });
  const [hydrated, setHydrated] = useState(false);
  const prevProjectIdRef = useRef(projectId);

  // Re-initialize when projectId changes
  useEffect(() => {
    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId;
      const dts = defaultTabs();
      dispatch({ type: 'hydrate', tabs: dts, activeTabId: dts[0].id });
      setHydrated(false);
    }
  }, [projectId]);

  // Hydrate tabs from server
  useEffect(() => {
    fetch(`/api/projects/${projectId}/workbench-tabs`)
      .then((res) => res.json())
      .then((data) => {
        const saved: Array<{ id: string; label: string; type?: WorkbenchTabType; agentId?: string }> = data.tabs || [];
        let tabs: WorkbenchTab[];
        if (saved.length > 0) {
          tabs = saved.map((t) => ({ id: t.id, label: t.label, type: t.type || 'shell', agentId: t.agentId }));
        } else {
          tabs = defaultTabs();
        }
        const savedActiveTabId: string | undefined = data.activeTabId;
        const activeTabId =
          (savedActiveTabId && tabs.find((t) => t.id === savedActiveTabId) ? savedActiveTabId : null)
          ?? tabs[0]?.id
          ?? '';
        dispatch({ type: 'hydrate', tabs, activeTabId });
        setHydrated(true);
      })
      .catch(() => { setHydrated(true); });
  }, [projectId]);

  // Persist tabs on change (debounced), gated on hydrated
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      const persistable = tabState.tabs.map(({ id, label, type, agentId }) => ({
        id, label, ...(type !== 'shell' ? { type } : {}), ...(agentId ? { agentId } : {}),
      }));
      fetch(`/api/projects/${projectId}/workbench-tabs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabs: persistable, activeTabId: tabState.activeTabId }),
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [tabState.tabs, tabState.activeTabId, hydrated, projectId]);

  // Track closed tabs for backend cleanup
  const prevTabIdsRef = useRef<Set<string>>(new Set(tabState.tabs.map((t) => t.id)));
  const tabTypeMapRef = useRef<Map<string, WorkbenchTabType>>(new Map(tabState.tabs.map((t) => [t.id, t.type])));

  // Keep type map up to date
  useEffect(() => {
    tabTypeMapRef.current = new Map(tabState.tabs.map((t) => [t.id, t.type]));
  }, [tabState.tabs]);

  // Cleanup backend resources for closed tabs
  useEffect(() => {
    const currentIds = new Set(tabState.tabs.map((t) => t.id));
    const prevIds = prevTabIdsRef.current;
    for (const id of prevIds) {
      if (!currentIds.has(id)) {
        const type = tabTypeMapRef.current.get(id) || 'shell';
        if (type === 'agent') {
          fetch(`/api/agent-tab/${id}`, { method: 'DELETE' }).catch(() => {});
        } else {
          fetch(`/api/shell/${id}`, { method: 'DELETE' }).catch(() => {});
        }
      }
    }
    prevTabIdsRef.current = currentIds;
  }, [tabState.tabs]);

  const { tabs, activeTabId } = tabState;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // --- Rename state ---
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

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
      dispatch({ type: 'rename', tabId: renamingTabId, label: renameValue.trim() });
    }
    setRenamingTabId(null);
    setRenameValue('');
  }, [renamingTabId, renameValue]);

  const addShellTab = useCallback(async (opts?: AddTabOptions) => {
    const { initialInput, reuse } = opts ?? {};
    const currentTabs = tabsRef.current;

    if (reuse) {
      const existing = currentTabs.find((t) => t.type === 'shell');
      if (existing) {
        if (initialInput) setTerminalDraft(existing.id, initialInput);
        dispatch({ type: 'activate', tabId: existing.id });
        return;
      }
    }

    const id = uuidv7();
    const shellCount = currentTabs.filter((t) => t.type === 'shell').length + 1;

    if (initialInput) setTerminalDraft(id, initialInput);

    await fetch('/api/shell/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabId: id, cwd: projectPath }),
    });

    dispatch({ type: 'open', tab: { id, label: `Terminal ${shellCount}`, type: 'shell' } });
  }, [projectPath]);

  const addAgentTab = useCallback((opts?: AddTabOptions) => {
    const { initialInput, reuse, agentId } = opts ?? {};
    const currentTabs = tabsRef.current;

    if (reuse && !agentId) {
      const existing = currentTabs.find((t) => t.type === 'agent');
      if (existing) {
        if (initialInput) setAgentDraft(existing.id, initialInput);
        dispatch({ type: 'activate', tabId: existing.id });
        return;
      }
    }

    const id = uuidv7();
    const agentCount = currentTabs.filter((t) => t.type === 'agent').length + 1;
    const agentLabel = agentId && agentMapRef.current?.get(agentId)?.name || `Agent ${agentCount}`;
    if (initialInput) setAgentDraft(id, initialInput);
    dispatch({ type: 'open', tab: { id, label: agentLabel, type: 'agent', agentId } });
  }, []);

  useImperativeHandle(ref, () => ({ addShellTab, addAgentTab, expand: expandPanel, toggle: toggleCollapsed }), [addShellTab, addAgentTab, expandPanel, toggleCollapsed]);

  const removeTab = useCallback((tabId: string) => {
    dispatch({ type: 'close', tabId });
  }, []);

  const clearTab = useCallback((tab: WorkbenchTab) => {
    window.dispatchEvent(new CustomEvent('workbench-clear-tab', { detail: { tabId: tab.id, type: tab.type } }));
  }, []);

  // DnD sensors — require 5px movement before activating to avoid blocking clicks
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = tabs.findIndex((t) => t.id === active.id);
      const newIndex = tabs.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      dispatch({ type: 'reorder', tabs: arrayMove(tabs, oldIndex, newIndex) });
    },
    [tabs]
  );

  /* ---- Shared header props ---- */
  const newTabProps: NewTabDropdownProps = {
    agentMap,
    defaultAgentId,
    collapsed: workbench.collapsed,
    expandPanel,
    addAgentTab,
    addShellTab,
  };

  /* ---- Bottom mode header ---- */
  const renderBottomHeader = () => (
    <div className="relative shrink-0">
      {/* Edge resize strip — sits over the top border */}
      {!workbench.collapsed && (
        <div
          onMouseDown={(e) => workbench.onResizeStart(e)}
          className="absolute inset-x-0 top-0 h-[5px] -translate-y-1/2 cursor-row-resize z-20 group/edge"
        >
          <div className="absolute inset-x-0 top-1/2 h-px bg-transparent group-hover/edge:bg-bronze-800 transition-colors" />
        </div>
      )}
      <div className="h-12 flex items-stretch bg-surface-secondary overflow-visible border-t border-border-default">
        <button
          onClick={toggleCollapsed}
          className="flex items-center justify-center w-12 self-stretch text-text-placeholder hover:text-text-secondary hover:bg-surface-hover/30 shrink-0"
          title={workbench.collapsed ? 'Expand panel' : 'Collapse panel'}
        >
          {workbench.collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
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
                  dispatch({ type: 'activate', tabId: tab.id });
                  if (workbench.collapsed) expandPanel();
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

        <NewTabDropdown {...newTabProps} />

        {/* Spacer — fills remaining space, doubles as resize grab target */}
        <div
          className={`flex-1 ${workbench.isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onMouseDown={(e) => workbench.onResizeStart(e)}
        />

        {/* Orientation toggle */}
        <button
          onClick={toggleOrientation}
          className="flex items-center justify-center w-10 self-stretch text-text-placeholder hover:text-text-secondary hover:bg-surface-hover/30 shrink-0"
          title="Move panel to right"
        >
          <PanelRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  /* ---- Right mode header ---- */
  const renderRightHeader = () => {
    const activeIcon = activeTab?.type === 'agent'
      ? <SquareChevronUpIcon className="w-3 h-3 shrink-0" />
      : <TerminalIcon className="w-3 h-3 shrink-0" />;

    return (
      <div className="relative shrink-0">
        {/* Edge resize strip — sits over the left border */}
        {!workbench.collapsed && (
          <div
            onMouseDown={(e) => workbench.onResizeStart(e)}
            className="absolute inset-y-0 left-0 w-[5px] -translate-x-1/2 cursor-col-resize z-20 group/edge"
          >
            <div className="absolute inset-y-0 left-1/2 w-px bg-transparent group-hover/edge:bg-bronze-800 transition-colors" />
          </div>
        )}
        <div className="h-12 flex items-stretch bg-surface-secondary overflow-visible border-b border-border-default">
          <button
            onClick={toggleCollapsed}
            className="flex items-center justify-center w-10 self-stretch text-text-placeholder hover:text-text-secondary hover:bg-surface-hover/30 shrink-0"
            title={workbench.collapsed ? 'Expand panel' : 'Collapse panel'}
          >
            {workbench.collapsed ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {/* Active tab selector — shows current tab with dropdown for switching */}
          {!workbench.collapsed && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex-1 flex items-center gap-1.5 px-2 text-xs text-text-chrome-active hover:bg-surface-hover/30 min-w-0">
                  {activeIcon}
                  <span className="truncate">{activeTab?.label || 'No tab'}</span>
                  <ChevronDown className="w-3 h-3 shrink-0 text-text-placeholder" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="bottom" className="w-52">
                {tabs.map((tab) => {
                  const tabIcon = tab.type === 'agent'
                    ? <SquareChevronUpIcon className="w-3.5 h-3.5" />
                    : <TerminalIcon className="w-3.5 h-3.5" />;
                  return (
                    <DropdownMenuItem
                      key={tab.id}
                      onSelect={() => dispatch({ type: 'activate', tabId: tab.id })}
                      className={activeTabId === tab.id ? 'bg-surface-hover/60' : ''}
                    >
                      {tabIcon}
                      <span className="truncate">{tab.label}</span>
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />
                {agentMap && agentMap.size > 1 ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Plus className="w-3.5 h-3.5" />
                      New tab
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-44">
                      {Array.from(agentMap.values()).map((agent) => (
                        <DropdownMenuItem
                          key={agent.id}
                          onSelect={() => addAgentTab({ agentId: agent.id })}
                        >
                          <SquareChevronUpIcon className="w-3.5 h-3.5" />
                          {agent.name}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => addShellTab()}>
                        <TerminalIcon className="w-3.5 h-3.5" />
                        Terminal
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : (
                  <>
                    <DropdownMenuItem onSelect={() => addAgentTab(defaultAgentId ? { agentId: defaultAgentId } : undefined)}>
                      <SquareChevronUpIcon className="w-3.5 h-3.5" />
                      New Agent
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => addShellTab()}>
                      <TerminalIcon className="w-3.5 h-3.5" />
                      New Terminal
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Spacer — resize grab target */}
          {!workbench.collapsed && (
            <div
              className={`flex-1 min-w-0 ${workbench.isDragging ? 'cursor-grabbing' : ''}`}
            />
          )}

          {/* Orientation toggle */}
          <button
            onClick={toggleOrientation}
            className="flex items-center justify-center w-10 self-stretch text-text-placeholder hover:text-text-secondary hover:bg-surface-hover/30 shrink-0"
            title="Move panel to bottom"
          >
            <PanelBottom className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={panelRef}
      className={`flex flex-col bg-surface-deep flex-shrink-0 ${isRight ? 'h-full border-l border-border-default' : 'w-full'}`}
      style={{
        ...(isRight ? { minWidth: 0 } : { minHeight: 0 }),
        ...(workbench.collapsed
          ? { flexBasis: 'auto', flexGrow: 0 }
          : { flexBasis: `${workbench.percent}%` }),
      }}
    >
      {isRight ? renderRightHeader() : renderBottomHeader()}

      {/* Panes — each manages its own lifecycle */}
      {!workbench.collapsed && (
        <div className="flex-1 relative" style={{ minHeight: 0, minWidth: 0 }}>
          {tabs.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-text-placeholder text-xs">
              No open tabs
            </div>
          ) : (
            tabs.map((tab) =>
              tab.type === 'agent' ? (
                <AgentTabPane key={tab.id} tabId={tab.id} projectId={projectId} agentId={tab.agentId} visible={activeTabId === tab.id} />
              ) : (
                <TerminalPane key={tab.id} tabId={tab.id} visible={activeTabId === tab.id} cwd={projectPath} enableDrop />
              )
            )
          )}
        </div>
      )}

      {/* Full-screen overlay while dragging to prevent interaction interference */}
      {workbench.isDragging && <div className={`fixed inset-0 z-50 ${isRight ? 'cursor-col-resize' : 'cursor-grabbing'}`} />}
    </div>
  );
});

export default WorkbenchPanel;
