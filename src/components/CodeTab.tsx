'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import 'highlight.js/styles/github-dark.css';
import dynamic from 'next/dynamic';
import type { editor as MonacoEditorType } from 'monaco-editor';
import {
  ExternalLink,
  Eye,
  Pencil,
  Loader2,
  Check,
  Copy,
  X,
  Search,
  ChevronRight,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { FileTree, type TreeNode } from './FileTree';
import type { Project } from '@/lib/types';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <div className="flex-1 bg-[#1e1e1e]" />,
});

interface CodeTabProps {
  project: Project;
}

interface OpenTab {
  path: string;
  name: string;
  language: string;
  dirty: boolean;
  preview: boolean;         // transient tab — replaced when clicking another file
  content: string;          // current content in editor
  savedContent: string;     // last saved content
  viewState: MonacoEditorType.ICodeEditorViewState | null;
}

// Persisted tab shape (no content/viewState — we reload on restore)
interface PersistedTab {
  path: string;
  preview: boolean;
}

function getStorageKey(projectId: string) {
  return `proq-code-tabs-${projectId}`;
}

function loadPersistedTabs(projectId: string): { tabs: PersistedTab[]; active: string | null } | null {
  try {
    const raw = localStorage.getItem(getStorageKey(projectId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persistTabs(projectId: string, tabs: OpenTab[], activePath: string | null) {
  try {
    const data = {
      tabs: tabs.map((t) => ({ path: t.path, preview: t.preview })),
      active: activePath,
    };
    localStorage.setItem(getStorageKey(projectId), JSON.stringify(data));
  } catch {
    // localStorage full or unavailable
  }
}

const DEFAULT_TREE_WIDTH = 260;
const MIN_TREE_WIDTH = 140;
const MAX_TREE_WIDTH = 600;

type SaveStatus = 'idle' | 'saving' | 'saved';

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === 'file') result.push(node);
    if (node.children) result.push(...flattenTree(node.children));
  }
  return result;
}

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CodeTab({ project }: CodeTabProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [fileLanguage, setFileLanguage] = useState<string>('plaintext');
  const [mdView, setMdView] = useState<'raw' | 'pretty'>('pretty');
  const [treeWidth, setTreeWidth] = useState(DEFAULT_TREE_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoEditorType.IStandaloneCodeEditor | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingFileRef = useRef(false);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<OpenTab[]>([]);
  const activeTabPathRef = useRef<string | null>(null);

  // Keep refs in sync
  tabsRef.current = openTabs;
  activeTabPathRef.current = activeTabPath;

  const activeTab = useMemo(
    () => openTabs.find((t) => t.path === activeTabPath) ?? null,
    [openTabs, activeTabPath]
  );

  const isDirty = activeTab?.dirty ?? false;

  const isMarkdown = useMemo(() => {
    if (!activeTabPath) return false;
    const ext = activeTabPath.split('.').pop()?.toLowerCase();
    return ext === 'md' || ext === 'mdx';
  }, [activeTabPath]);

  const fileContent = activeTab?.content ?? '';

  // Flatten tree for Cmd+P palette
  const allFiles = useMemo(() => flattenTree(tree), [tree]);
  const filteredFiles = useMemo(() => {
    if (!paletteQuery) return allFiles.slice(0, 50);
    // Match against full relative path so "src/" or "lib/db" works
    return allFiles.filter((f) => {
      const rel = f.path.replace(project.path + '/', '');
      return fuzzyMatch(paletteQuery, rel);
    }).slice(0, 50);
  }, [allFiles, paletteQuery, project.path]);

  // Resize drag handling
  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setTreeWidth(Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, x)));
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Load file tree
  useEffect(() => {
    if (!project.path) return;
    fetch(`/api/files/tree?path=${encodeURIComponent(project.path)}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTree(data);
      })
      .catch(console.error);
  }, [project.path]);

  // Restore persisted tabs on mount
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !project.id || tree.length === 0) return;
    restoredRef.current = true;
    const saved = loadPersistedTabs(project.id);
    if (!saved || saved.tabs.length === 0) return;
    // Load each tab's content
    Promise.all(
      saved.tabs.map(async (st) => {
        try {
          const res = await fetch(`/api/files/read?path=${encodeURIComponent(st.path)}`);
          const data = await res.json();
          if (data.error) return null;
          return {
            path: st.path,
            name: st.path.split('/').pop() || st.path,
            language: data.language,
            dirty: false,
            preview: st.preview,
            content: data.content,
            savedContent: data.content,
            viewState: null,
          } as OpenTab;
        } catch {
          return null;
        }
      })
    ).then((results) => {
      const tabs = results.filter((t): t is OpenTab => t !== null);
      if (tabs.length === 0) return;
      setOpenTabs(tabs);
      // Restore active tab
      const active = saved.active && tabs.find((t) => t.path === saved.active)
        ? saved.active
        : tabs[0].path;
      setActiveTabPath(active);
      const activeTabData = tabs.find((t) => t.path === active);
      if (activeTabData) {
        setFileLanguage(activeTabData.language);
        if (editorRef.current) {
          isLoadingFileRef.current = true;
          editorRef.current.setValue(activeTabData.content);
          isLoadingFileRef.current = false;
        }
      }
    });
  }, [project.id, tree]);

  // Persist tabs whenever they change
  useEffect(() => {
    if (!project.id || !restoredRef.current) return;
    persistTabs(project.id, openTabs, activeTabPath);
  }, [project.id, openTabs, activeTabPath]);

  // Cmd+P global shortcut — focuses the search input in the sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setPaletteQuery('');
        setPaletteIndex(0);
        setShowPalette(true);
        setTimeout(() => paletteInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Save file
  const saveFile = useCallback(async (filePath: string, content: string) => {
    setSaveStatus('saving');
    try {
      await fetch('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
      });
      // Update tab saved content + pin on save
      setOpenTabs((tabs) =>
        tabs.map((t) =>
          t.path === filePath
            ? { ...t, savedContent: content, dirty: false, preview: false }
            : t
        )
      );
      setSaveStatus('saved');
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('idle');
    }
  }, []);

  // Save active file
  const handleSave = useCallback(() => {
    if (!activeTab || !activeTab.dirty) return;
    saveFile(activeTab.path, activeTab.content);
  }, [activeTab, saveFile]);

  // Discard changes in active file
  const handleDiscard = useCallback(() => {
    if (!activeTab) return;
    const restored = activeTab.savedContent;
    setOpenTabs((tabs) =>
      tabs.map((t) =>
        t.path === activeTab.path
          ? { ...t, content: restored, dirty: false }
          : t
      )
    );
    // Set editor content imperatively
    if (editorRef.current) {
      isLoadingFileRef.current = true;
      editorRef.current.setValue(restored);
      isLoadingFileRef.current = false;
    }
    setSaveStatus('idle');
  }, [activeTab]);

  // Save/restore view state when switching tabs
  const saveCurrentViewState = useCallback(() => {
    if (!editorRef.current || !activeTabPath) return;
    const viewState = editorRef.current.saveViewState();
    setOpenTabs((tabs) =>
      tabs.map((t) =>
        t.path === activeTabPath ? { ...t, viewState } : t
      )
    );
  }, [activeTabPath]);

  // Switch to a tab
  const switchToTab = useCallback(
    (path: string) => {
      if (path === activeTabPath) return;
      saveCurrentViewState();
      setActiveTabPath(path);
      const tab = tabsRef.current.find((t) => t.path === path);
      if (tab) {
        setFileLanguage(tab.language);
        setSaveStatus(tab.dirty ? 'idle' : 'idle');
        // Set editor content imperatively
        if (editorRef.current) {
          isLoadingFileRef.current = true;
          editorRef.current.setValue(tab.content);
          // Restore view state after a tick
          setTimeout(() => {
            if (editorRef.current && tab.viewState) {
              editorRef.current.restoreViewState(tab.viewState);
            }
            isLoadingFileRef.current = false;
          }, 0);
        }
      }
    },
    [activeTabPath, saveCurrentViewState]
  );

  // Pin a preview tab (make it permanent) — called on edit or double-click
  const pinTab = useCallback((path: string) => {
    setOpenTabs((tabs) =>
      tabs.map((t) => (t.path === path ? { ...t, preview: false } : t))
    );
  }, []);

  // Load file as a preview tab (single-click from tree). Replaces existing preview tab.
  const loadFile = useCallback(
    async (filePath: string) => {
      // If already open, switch to it
      const existing = tabsRef.current.find((t) => t.path === filePath);
      if (existing) {
        switchToTab(filePath);
        return;
      }

      // Save current view state before switching
      saveCurrentViewState();
      setSaveStatus('idle');

      try {
        const res = await fetch(
          `/api/files/read?path=${encodeURIComponent(filePath)}`
        );
        const data = await res.json();
        const name = filePath.split('/').pop() || filePath;
        let content: string;
        let language: string;

        if (data.error) {
          content = `// Error: ${data.error}`;
          language = 'plaintext';
        } else {
          content = data.content;
          language = data.language;
        }

        const newTab: OpenTab = {
          path: filePath,
          name,
          language,
          dirty: false,
          preview: true,  // opens as preview
          content,
          savedContent: content,
          viewState: null,
        };

        setOpenTabs((tabs) => {
          // Replace existing preview tab (if any) with this new one
          const hasPreview = tabs.some((t) => t.preview);
          if (hasPreview) {
            return tabs.map((t) => (t.preview ? newTab : t));
          }
          return [...tabs, newTab];
        });
        setActiveTabPath(filePath);
        setFileLanguage(language);

        // Set editor content imperatively
        if (editorRef.current) {
          isLoadingFileRef.current = true;
          editorRef.current.setValue(content);
          isLoadingFileRef.current = false;
        }
      } catch {
        // Failed to load — don't open a tab
      }
    },
    [switchToTab, saveCurrentViewState]
  );

  // Open file pinned (double-click from tree or Cmd+P)
  const loadFilePinned = useCallback(
    async (filePath: string) => {
      // If already open, pin it and switch
      const existing = tabsRef.current.find((t) => t.path === filePath);
      if (existing) {
        pinTab(filePath);
        switchToTab(filePath);
        return;
      }

      // Save current view state before switching
      saveCurrentViewState();
      setSaveStatus('idle');

      try {
        const res = await fetch(
          `/api/files/read?path=${encodeURIComponent(filePath)}`
        );
        const data = await res.json();
        const name = filePath.split('/').pop() || filePath;
        let content: string;
        let language: string;

        if (data.error) {
          content = `// Error: ${data.error}`;
          language = 'plaintext';
        } else {
          content = data.content;
          language = data.language;
        }

        const newTab: OpenTab = {
          path: filePath,
          name,
          language,
          dirty: false,
          preview: false,  // pinned immediately
          content,
          savedContent: content,
          viewState: null,
        };

        setOpenTabs((tabs) => {
          // Replace existing preview tab if it exists, otherwise append
          const hasPreview = tabs.some((t) => t.preview);
          if (hasPreview) {
            return tabs.map((t) => (t.preview ? newTab : t));
          }
          return [...tabs, newTab];
        });
        setActiveTabPath(filePath);
        setFileLanguage(language);

        if (editorRef.current) {
          isLoadingFileRef.current = true;
          editorRef.current.setValue(content);
          isLoadingFileRef.current = false;
        }
      } catch {
        // Failed to load
      }
    },
    [pinTab, switchToTab, saveCurrentViewState]
  );

  // Close a tab
  const closeTab = useCallback(
    (path: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      setOpenTabs((tabs) => {
        const idx = tabs.findIndex((t) => t.path === path);
        const newTabs = tabs.filter((t) => t.path !== path);
        // If closing active tab, switch to adjacent
        if (path === activeTabPath && newTabs.length > 0) {
          const newIdx = Math.min(idx, newTabs.length - 1);
          const nextTab = newTabs[newIdx];
          setActiveTabPath(nextTab.path);
          setFileLanguage(nextTab.language);
          if (editorRef.current) {
            isLoadingFileRef.current = true;
            editorRef.current.setValue(nextTab.content);
            setTimeout(() => {
              if (editorRef.current && nextTab.viewState) {
                editorRef.current.restoreViewState(nextTab.viewState);
              }
              isLoadingFileRef.current = false;
            }, 0);
          }
        } else if (newTabs.length === 0) {
          setActiveTabPath(null);
        }
        return newTabs;
      });
      setSaveStatus('idle');
    },
    [activeTabPath]
  );

  // Handle middle-click on tab
  const handleTabMouseDown = useCallback(
    (path: string, e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(path);
      }
    },
    [closeTab]
  );

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleCopyFile = useCallback(async () => {
    const content = editorRef.current?.getValue() || fileContent;
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      console.error('Failed to copy file contents');
    }
  }, [fileContent]);

  const handleOpenWith = useCallback(async () => {
    try {
      await fetch('/api/files/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: project.path }),
      });
    } catch (e) {
      console.error('Failed to open:', e);
    }
  }, [project.path]);

  // Define custom Monaco theme before mount to avoid vs-dark flash
  const handleEditorWillMount = useCallback((monacoInstance: typeof import('monaco-editor')) => {
    monacoInstance.editor.defineTheme('proq-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0c0c0e',              // surface-inset — deepest content
        'editor.lineHighlightBackground': '#111115',   // subtle line highlight
        'editorGutter.background': '#0c0c0e',         // match editor bg
        'minimap.background': '#0c0c0e',
        'editorOverviewRuler.background': '#0c0c0e',
        'scrollbarSlider.background': '#1a1a1e80',
        'scrollbarSlider.hoverBackground': '#2a2a2ea0',
      },
    });
  }, []);

  // Monaco editor mount handler — uses refs to avoid stale closures
  const handleEditorMount = useCallback(
    (editor: MonacoEditorType.IStandaloneCodeEditor) => {
      editorRef.current = editor;

      // If a tab was already loaded before editor mounted, set its content now
      const currentPath = activeTabPathRef.current;
      if (currentPath) {
        const tab = tabsRef.current.find((t) => t.path === currentPath);
        if (tab) {
          isLoadingFileRef.current = true;
          editor.setValue(tab.content);
          isLoadingFileRef.current = false;
        }
      }

      // Cmd+S to save
      editor.addCommand(
        // eslint-disable-next-line no-bitwise
        (window as unknown as { monaco: typeof import('monaco-editor') }).monaco?.KeyMod.CtrlCmd | (window as unknown as { monaco: typeof import('monaco-editor') }).monaco?.KeyCode.KeyS,
        () => {
          const currentPath = activeTabPathRef.current;
          if (!currentPath) return;
          const tab = tabsRef.current.find((t) => t.path === currentPath);
          if (tab && tab.dirty) {
            saveFile(currentPath, editor.getValue());
          }
        }
      );

      // Track content changes for dirty state + auto-pin preview tabs on edit
      editor.onDidChangeModelContent(() => {
        if (isLoadingFileRef.current) return;
        const currentPath = activeTabPathRef.current;
        if (!currentPath) return;
        const value = editor.getValue();
        setOpenTabs((tabs) =>
          tabs.map((t) => {
            if (t.path !== currentPath) return t;
            const dirty = value !== t.savedContent;
            // Pin preview tab on edit
            return { ...t, content: value, dirty, preview: false };
          })
        );
      });
    },
    [saveFile]
  );

  // Palette file selection — opens pinned (intentional open)
  const handlePaletteSelect = useCallback(
    (filePath: string) => {
      setShowPalette(false);
      setPaletteQuery('');
      loadFilePinned(filePath);
    },
    [loadFilePinned]
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-surface-base">
      {/* Sub-header bar — lightest chrome layer, 3-column layout */}
      <div className="h-10 flex-shrink-0 grid grid-cols-[1fr_auto_1fr] items-center px-6 border-b border-border-default bg-surface-secondary">
        {/* Left: breadcrumb + save status (ml-1 aligns with TopBar project name) */}
        <div className="flex items-center gap-2 min-w-0 ml-1">
          {activeTabPath && (() => {
            const rel = activeTabPath.replace(project.path + '/', '');
            const parts = rel.split('/');
            return (
              <div className="flex items-center gap-0.5 text-xs font-mono truncate min-w-0">
                <span className="text-lazuli font-medium shrink-0">{project.name}</span>
                {parts.map((part, i) => (
                  <React.Fragment key={i}>
                    <ChevronRight className="w-3 h-3 text-text-tertiary/40 shrink-0" />
                    <span className={i === parts.length - 1 ? 'text-text-primary font-medium' : 'text-text-tertiary'}>
                      {part}
                    </span>
                  </React.Fragment>
                ))}
                {isDirty && <span className="w-2 h-2 rounded-full bg-zinc-500 ml-1.5 shrink-0" />}
              </div>
            );
          })()}
          {saveStatus === 'saving' && (
            <span className="flex items-center text-xs text-text-tertiary">
              <Loader2 className="w-3 h-3 animate-spin" />
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center text-xs text-text-tertiary">
              <Check className="w-3 h-3" />
            </span>
          )}
        </div>

        {/* Center: Edit / Preview toggle (markdown only) */}
        <div className="flex items-center justify-center">
          {isMarkdown && activeTabPath && (
            <div className="flex items-center bg-surface-hover rounded-md p-0.5 border border-border-strong">
              <button
                onClick={() => setMdView('raw')}
                className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${
                  mdView === 'raw'
                    ? 'bg-border-strong text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
              <button
                onClick={() => setMdView('pretty')}
                className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${
                  mdView === 'pretty'
                    ? 'bg-border-strong text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                <Eye className="w-3 h-3" />
                Preview
              </button>
            </div>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1.5 justify-end">
          {isDirty && (
            <>
              <button
                onClick={handleDiscard}
                className="px-3 py-1 text-xs font-medium text-text-secondary hover:text-text-primary bg-surface-hover hover:bg-border-strong rounded-md border border-border-strong transition-colors"
                title="Discard changes"
              >
                Cancel changes
              </button>
              <button
                onClick={handleSave}
                className="px-3 py-1 text-xs font-medium text-white bg-emerald/80 hover:bg-emerald rounded-md transition-colors"
                title="Save (Cmd+S)"
              >
                Save changes
              </button>
            </>
          )}

          {activeTabPath && (
            <button
              onClick={handleCopyFile}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-text-tertiary hover:text-text-secondary hover:bg-surface-hover rounded-md transition-colors"
              title="Copy file contents"
            >
              {copyStatus === 'copied' ? (
                <Check className="w-3.5 h-3.5 text-emerald" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          <button
            onClick={handleOpenWith}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-text-tertiary hover:text-text-secondary hover:bg-surface-hover rounded-md transition-colors"
            title="Open in external editor"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      {openTabs.length > 0 && (
        <div className="h-[33px] flex-shrink-0 flex items-end border-b border-border-default bg-surface-topbar overflow-x-auto">
          {openTabs.map((tab) => {
            const isActive = tab.path === activeTabPath;
            return (
              <div
                key={tab.path}
                onClick={() => switchToTab(tab.path)}
                onDoubleClick={() => pinTab(tab.path)}
                onMouseDown={(e) => handleTabMouseDown(tab.path, e)}
                className={`group flex items-center gap-1.5 px-3 h-[32px] text-xs cursor-pointer border-r border-border-default select-none shrink-0 ${
                  isActive
                    ? 'bg-surface-inset text-text-primary border-b border-b-transparent -mb-px'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-base/60'
                }`}
              >
                {tab.dirty && (
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 flex-shrink-0" />
                )}
                <span className={`truncate max-w-[140px] font-mono text-[11px] ${tab.preview ? 'italic' : ''}`}>
                  {tab.name}
                </span>
                <button
                  onClick={(e) => closeTab(tab.path, e)}
                  className={`flex-shrink-0 p-0.5 rounded hover:bg-surface-hover ${
                    isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
                  }`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Main content: file tree + editor */}
      <div ref={containerRef} className="flex-1 flex min-h-0 overflow-hidden">
        {/* File tree */}
        <div
          className="h-full flex flex-col border-r border-border-default bg-surface-topbar flex-shrink-0"
          style={{ width: treeWidth }}
        >
          {/* Go to file search — inline input with dropdown */}
          <div className="p-2 border-b border-border-default shrink-0 relative">
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] bg-surface-inset rounded-md border transition-colors ${
                showPalette ? 'border-border-strong' : 'border-border-default hover:border-border-strong'
              }`}
            >
              <Search className="w-3 h-3 text-text-tertiary/60 flex-shrink-0" />
              <input
                ref={paletteInputRef}
                type="text"
                value={paletteQuery}
                onChange={(e) => { setPaletteQuery(e.target.value); setPaletteIndex(0); }}
                onFocus={() => { setShowPalette(true); setPaletteIndex(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setShowPalette(false);
                    (e.target as HTMLInputElement).blur();
                  }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setPaletteIndex((i) => Math.min(i + 1, filteredFiles.length - 1));
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setPaletteIndex((i) => Math.max(i - 1, 0));
                  }
                  if (e.key === 'Enter' && filteredFiles.length > 0) {
                    handlePaletteSelect(filteredFiles[paletteIndex].path);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="Go to file"
                className="flex-1 bg-transparent text-[11px] text-text-primary placeholder:text-text-tertiary/50 outline-none min-w-0"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {/* Dropdown results */}
            {showPalette && (
              <div className="absolute left-2 right-2 top-full mt-1 z-[60] bg-surface-modal border border-border-strong rounded-md shadow-xl overflow-hidden max-h-[300px] flex flex-col">
                <div className="overflow-y-auto">
                  {filteredFiles.length === 0 ? (
                    <div className="px-3 py-3 text-[11px] text-text-tertiary text-center">
                      No files found
                    </div>
                  ) : (
                    filteredFiles.map((file, i) => (
                      <button
                        key={file.path}
                        onClick={() => {
                          handlePaletteSelect(file.path);
                          paletteInputRef.current?.blur();
                        }}
                        className={`w-full flex flex-col gap-0 px-2.5 py-1.5 text-left transition-colors ${
                          i === paletteIndex ? 'bg-surface-hover/80' : 'hover:bg-surface-hover/40'
                        }`}
                      >
                        <span className="text-[11px] text-text-primary font-medium truncate">{file.name}</span>
                        <span className="text-text-tertiary/50 font-mono text-[10px] truncate">
                          {file.path.replace(project.path + '/', '')}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            <FileTree
              nodes={tree}
              selectedPath={activeTabPath}
              onSelectFile={loadFile}
              onDoubleClickFile={loadFilePinned}
            />
          </div>
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={(e) => { e.preventDefault(); setIsDragging(true); }}
          className={`w-[5px] flex-shrink-0 cursor-col-resize transition-colors ${
            isDragging
              ? 'bg-lazuli-dark'
              : 'bg-border-default hover:bg-border-hover'
          }`}
        />

        {/* Editor — deepest layer */}
        <div className="flex-1 min-w-0 h-full overflow-hidden bg-surface-inset">
          {!activeTabPath ? (
            <div className="h-full flex flex-col items-center justify-center text-text-tertiary text-sm gap-1.5">
              <span>Select a file to view</span>
              <button
                onClick={() => {
                  setPaletteQuery('');
                  setPaletteIndex(0);
                  setShowPalette(true);
                  setTimeout(() => paletteInputRef.current?.focus(), 0);
                }}
                className="text-[11px] text-text-tertiary/50 font-mono hover:text-text-tertiary transition-colors"
              >
                &#8984;P to go to file
              </button>
            </div>
          ) : isMarkdown && mdView === 'pretty' ? (
            <div className="h-full overflow-y-auto p-6">
              <div className="prose prose-zinc dark:prose-invert prose-sm max-w-none prose-pre:bg-surface-hover prose-pre:text-text-primary prose-code:text-lazuli prose-headings:text-text-primary">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                >
                  {fileContent}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <MonacoEditor
              height="100%"
              language={fileLanguage}
              defaultValue=""
              theme="proq-dark"
              beforeMount={handleEditorWillMount}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: true },
                fontSize: 13,
                fontFamily: 'Geist Mono, monospace',
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                padding: { top: 12 },
                renderLineHighlight: 'line',
              }}
            />
          )}
        </div>
      </div>

      {/* Drag overlay to prevent iframe/editor stealing mouse events */}
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}

      {/* Click-away listener for palette dropdown */}
      {showPalette && (
        <div
          className="fixed inset-0 z-[59]"
          onClick={() => setShowPalette(false)}
        />
      )}
    </div>
  );
}
