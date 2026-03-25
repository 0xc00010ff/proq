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
import { TerminalPane, setTerminalDraft } from './TerminalPane';
import { AgentTabPane, setAgentDraft } from './AgentTabPane';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useResizablePanel } from '@/hooks/useResizablePanel';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type WorkbenchTabType = 'shell' | 'agent';

export interface WorkbenchTab {
  id: string;
  label: string;
  type: WorkbenchTabType;
}

interface AddTabOptions {
  /** Pre-fill text: sent to terminal once WS connects, or placed in agent message input */
  initialInput?: string;
  /** If true, activate an existing tab of this type instead of creating a new one (default: false) */
  reuse?: boolean;
}

export interface WorkbenchPanelHandle {
  addShellTab: (opts?: AddTabOptions) => Promise<void>;
  addAgentTab: (opts?: AddTabOptions) => void;
  expand: () => void;
  toggle: () => void;
}

interface WorkbenchPanelProps {
  projectId: string;
  projectPath?: string;
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

function defaultTabs(projectId: string): WorkbenchTab[] {
  return [
    { id: `default-agent-${projectId}`, label: 'Agent', type: 'agent' },
    { id: `default-shell-${projectId}`, label: 'Terminal', type: 'shell' },
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
        if (idx < state.tabs.length - 1) newActiveTabId = state.tabs[idx + 1].id;
        else if (idx > 0) newActiveTabId = state.tabs[idx - 1].id;
        else newActiveTabId = '';
      }
      return { tabs: filtered, activeTabId: newActiveTabId };
    }

    case 'activate':
      return { ...state, activeTabId: action.tabId };

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

const TAB_BAR_HEIGHT = 48; // px — matches h-12

const WorkbenchPanel = forwardRef<WorkbenchPanelHandle, WorkbenchPanelProps>(function WorkbenchPanel({ projectId, projectPath }, ref) {
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Discover parent container for resize calculations
  useEffect(() => {
    containerRef.current = panelRef.current?.parentElement as HTMLDivElement | null;
  }, []);

  // --- Resize state (internalized from page.tsx) ---
  const patchWorkbenchState = useCallback((data: { open?: boolean; height?: number }) => {
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
  });

  // Restore collapsed/height from server on mount
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/workbench-state`)
      .then((res) => res.json())
      .then((data) => {
        workbench.setCollapsed(!data.open);
        if (typeof data.height === 'number') workbench.setPercent(data.height);
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
    workbench.setPercent((prev: number) => Math.max(prev, 25));
  }, [workbench, patchWorkbenchState]);

  // --- Tab state (internalized from WorkbenchTabsProvider) ---
  const initialTabs = defaultTabs(projectId);
  const [tabState, dispatch] = useReducer(tabReducer, { tabs: initialTabs, activeTabId: initialTabs[0].id });
  const [hydrated, setHydrated] = useState(false);
  const prevProjectIdRef = useRef(projectId);

  // Re-initialize when projectId changes
  useEffect(() => {
    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId;
      const dts = defaultTabs(projectId);
      dispatch({ type: 'hydrate', tabs: dts, activeTabId: dts[0].id });
      setHydrated(false);
    }
  }, [projectId]);

  // Hydrate tabs from server
  useEffect(() => {
    fetch(`/api/projects/${projectId}/workbench-tabs`)
      .then((res) => res.json())
      .then((data) => {
        const saved: Array<{ id: string; label: string; type?: WorkbenchTabType }> = data.tabs || [];
        let tabs: WorkbenchTab[];
        if (saved.length > 0) {
          tabs = saved.map((t) => ({ id: t.id, label: t.label, type: t.type || 'shell' }));
        } else {
          tabs = defaultTabs(projectId);
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
      const persistable = tabState.tabs.map(({ id, label, type }) => ({
        id, label, ...(type !== 'shell' ? { type } : {}),
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

    const id = `shell-${uuidv4().slice(0, 8)}`;
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
    const { initialInput, reuse } = opts ?? {};
    const currentTabs = tabsRef.current;

    if (reuse) {
      const existing = currentTabs.find((t) => t.type === 'agent');
      if (existing) {
        if (initialInput) setAgentDraft(existing.id, initialInput);
        dispatch({ type: 'activate', tabId: existing.id });
        return;
      }
    }

    const id = `agent-${uuidv4().slice(0, 8)}`;
    const agentCount = currentTabs.filter((t) => t.type === 'agent').length + 1;
    if (initialInput) setAgentDraft(id, initialInput);
    dispatch({ type: 'open', tab: { id, label: `Agent ${agentCount}`, type: 'agent' } });
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

  return (
    <div
      ref={panelRef}
      className="w-full flex flex-col bg-surface-deep flex-shrink-0"
      style={{
        minHeight: 0,
        ...(workbench.collapsed
          ? { flexBasis: 'auto', flexGrow: 0 }
          : { flexBasis: `${workbench.percent}%` }),
      }}
    >
      {/* Tab Bar — also serves as the resize drag handle */}
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
        <div
          className={`h-12 flex items-stretch bg-surface-secondary overflow-visible border-t border-border-default ${
            workbench.isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          onMouseDown={(e) => {
            // Don't start resize if clicking on interactive elements
            const target = e.target as HTMLElement;
            if (target.closest('button') || target.closest('[data-clickable]')) return;
            workbench.onResizeStart(e);
          }}
        >
        <button
          onClick={toggleCollapsed}
          className="flex items-center justify-center w-12 self-stretch text-text-placeholder hover:text-text-secondary hover:bg-surface-hover/30 shrink-0"
          title={workbench.collapsed ? 'Expand terminal' : 'Collapse terminal'}
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
                if (workbench.collapsed) expandPanel();
                addAgentTab();
              }}
            >
              <SquareChevronUpIcon className="w-3.5 h-3.5" />
              Agent
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (workbench.collapsed) expandPanel();
                addShellTab();
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
      {!workbench.collapsed && (
        <div className="flex-1 relative" style={{ minHeight: 0 }}>
          {tabs.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-text-placeholder text-xs">
              No open tabs
            </div>
          ) : (
            tabs.map((tab) =>
              tab.type === 'agent' ? (
                <AgentTabPane key={tab.id} tabId={tab.id} projectId={projectId} visible={activeTabId === tab.id} />
              ) : (
                <TerminalPane key={tab.id} tabId={tab.id} visible={activeTabId === tab.id} cwd={projectPath} enableDrop />
              )
            )
          )}
        </div>
      )}

      {/* Full-screen overlay while dragging to prevent interaction interference */}
      {workbench.isDragging && <div className="fixed inset-0 z-50 cursor-grabbing" />}
    </div>
  );
});

export default WorkbenchPanel;
