'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GitBranchIcon, ChevronDownIcon, CheckIcon, ArrowUpIcon, ArrowDownIcon, Loader2Icon, HistoryIcon, DiffIcon, LayoutGridIcon, ListIcon, ColumnsIcon, SettingsIcon, GitCommitHorizontalIcon, XIcon, SearchIcon } from 'lucide-react';
import type { Project, ProjectTab, ViewType } from '@/lib/types';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { GitDetailModal } from '@/components/GitDetailModal';
import { isElectron } from '@/lib/utils';

export type TabOption = ProjectTab;

export interface GitStatus {
  hasGit: boolean;
  hasRemote: boolean;
  ahead: number;
  behind: number;
  dirty: number;
  aheadOfMain?: number;
}

interface TopBarProps {
  project: Project;
  activeTab: TabOption;
  onTabChange: (tab: TabOption) => void;
  currentBranch?: string;
  branches?: string[];
  taskBranchMap?: Record<string, string>;
  onSwitchBranch?: (branch: string) => void;
  projectId?: string;
  gitStatus?: GitStatus;
  onPush?: () => Promise<void>;
  onPull?: () => Promise<void>;
  onInitGit?: () => void;
  viewType?: ViewType;
  onViewTypeChange?: (viewType: ViewType) => void;
  onOpenSettings?: () => void;
  onCommit?: () => void;
  onCreateBranch?: (name: string) => Promise<void>;
}

export function TopBar({ project, activeTab, onTabChange, currentBranch, branches, taskBranchMap, onSwitchBranch, projectId, gitStatus, onPush, onPull, onInitGit, viewType = 'kanban', onViewTypeChange, onOpenSettings, onCommit, onCreateBranch }: TopBarProps) {
  // Branch selector popover
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false);
  const [branchFilter, setBranchFilter] = useState('');
  const branchPopoverRef = useRef<HTMLDivElement>(null);
  const branchTriggerRef = useRef<HTMLButtonElement>(null);
  const branchSearchRef = useRef<HTMLInputElement>(null);

  // Dropdown data for status labels
  const [dirtyFiles, setDirtyFiles] = useState<{ path: string; status: string }[] | null>(null);
  const [dirtyDropdownOpen, setDirtyDropdownOpen] = useState(false);

  // Dropdown commit lists (fetched on open)
  const [aheadCommits, setAheadCommits] = useState<{ hash: string; message: string; author: string; date: string }[] | null>(null);
  const [behindCommits, setBehindCommits] = useState<{ hash: string; message: string; author: string; date: string }[] | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Detail modal state
  const [detailModal, setDetailModal] = useState<
    | { type: 'diff'; title: string; content: string }
    | { type: 'log'; title: string; commits: { hash: string; message: string; author: string; date: string; insertions?: number; deletions?: number }[]; behindCommits: { hash: string; message: string; author: string; date: string; insertions?: number; deletions?: number }[] }
    | null
  >(null);

  const fetchDirtyFiles = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/git`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
      });
      if (res.ok) { const data = await res.json(); setDirtyFiles(data.files); }
    } catch { /* best effort */ }
  }, [projectId]);

  const openDiffModal = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/git`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'diff' }),
      });
      if (res.ok) {
        const data = await res.json();
        setDetailModal({ type: 'diff', title: 'Working Changes', content: data.diff || 'No changes.' });
      }
    } catch { /* best effort */ }
  }, [projectId]);

  const fetchHistoryCommits = useCallback(async () => {
    if (!projectId) return;
    const ahead = gitStatus?.ahead ?? 0;
    const behind = gitStatus?.behind ?? 0;
    // Fetch ahead and behind commits in parallel, silently in background
    const [aheadRes, behindRes] = await Promise.all([
      ahead > 0
        ? fetch(`/api/projects/${projectId}/git`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'log', direction: 'ahead' }),
          }).then(r => r.ok ? r.json() : { commits: [] }).catch(() => ({ commits: [] }))
        : Promise.resolve({ commits: [] }),
      behind > 0
        ? fetch(`/api/projects/${projectId}/git`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'log', direction: 'behind' }),
          }).then(r => r.ok ? r.json() : { commits: [] }).catch(() => ({ commits: [] }))
        : Promise.resolve({ commits: [] }),
    ]);
    setAheadCommits(aheadRes.commits || []);
    setBehindCommits(behindRes.commits || []);
  }, [projectId, gitStatus]);

  // Re-fetch commits after push/pull and update the modal in-place
  const refreshModalAfterSync = useCallback(async () => {
    if (!projectId) return;
    const [aheadRes, behindRes] = await Promise.all([
      fetch(`/api/projects/${projectId}/git`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'log', direction: 'ahead' }),
      }).then(r => r.ok ? r.json() : { commits: [] }).catch(() => ({ commits: [] })),
      fetch(`/api/projects/${projectId}/git`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'log', direction: 'behind' }),
      }).then(r => r.ok ? r.json() : { commits: [] }).catch(() => ({ commits: [] })),
    ]);
    const newAhead = aheadRes.commits || [];
    const newBehind = behindRes.commits || [];
    setAheadCommits(newAhead);
    setBehindCommits(newBehind);
    // Update the open modal with fresh data
    setDetailModal(prev => {
      if (!prev || prev.type !== 'log') return prev;
      const branchName = currentBranch ? `origin/${currentBranch}` : 'origin';
      const parts: string[] = [];
      if (newAhead.length > 0) parts.push(`${newAhead.length} ahead`);
      if (newBehind.length > 0) parts.push(`${newBehind.length} behind`);
      const title = parts.length > 0 ? parts.join(', ') + ` · ${branchName}` : `Up to date · ${branchName}`;
      return { ...prev, title, commits: newAhead, behindCommits: newBehind };
    });
  }, [projectId, currentBranch]);

  const openHistoryModal = useCallback(() => {
    const branchName = currentBranch ? `origin/${currentBranch}` : 'origin';
    const a = gitStatus?.ahead ?? 0;
    const b = gitStatus?.behind ?? 0;
    const parts: string[] = [];
    if (a > 0) parts.push(`${a} ahead`);
    if (b > 0) parts.push(`${b} behind`);
    const title = parts.length > 0 ? parts.join(', ') + ` · ${branchName}` : `Up to date · ${branchName}`;
    setDetailModal({
      type: 'log',
      title,
      commits: aheadCommits || [],
      behindCommits: behindCommits || [],
    });
  }, [gitStatus, currentBranch, aheadCommits, behindCommits]);

  // Branch popover: click-outside to close
  useEffect(() => {
    if (!branchPopoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        branchPopoverRef.current && !branchPopoverRef.current.contains(e.target as Node) &&
        branchTriggerRef.current && !branchTriggerRef.current.contains(e.target as Node)
      ) {
        setBranchPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [branchPopoverOpen]);

  // Focus search input when branch popover opens
  useEffect(() => {
    if (branchPopoverOpen) {
      setBranchFilter('');
      setTimeout(() => branchSearchRef.current?.focus(), 0);
    }
  }, [branchPopoverOpen]);

  const tabs: { id: TabOption; label: string }[] = [
    { id: 'project', label: 'Project' },
    { id: 'live', label: 'Live' },
    { id: 'code', label: 'Code' },
  ];

  const isOnPreviewBranch = currentBranch?.startsWith('proq/') ?? false;
  const hasGit = gitStatus?.hasGit !== false;

  // Sort branches: proq/* first, then main, then others
  const sortedBranches = branches ? [...branches].sort((a, b) => {
    const aIsProq = a.startsWith('proq/');
    const bIsProq = b.startsWith('proq/');
    if (aIsProq && !bIsProq) return -1;
    if (!aIsProq && bIsProq) return 1;
    const aIsMain = a === 'main' || a === 'master';
    const bIsMain = b === 'main' || b === 'master';
    if (aIsMain && !bIsMain) return -1;
    if (!aIsMain && bIsMain) return 1;
    return a.localeCompare(b);
  }) : [];

  // Group branches: main/master, proq/* branches, others
  const mainBranches = sortedBranches.filter(b => b === 'main' || b === 'master');
  const proqBranches = sortedBranches.filter(b => b.startsWith('proq/'));
  const otherBranches = sortedBranches.filter(b => b !== 'main' && b !== 'master' && !b.startsWith('proq/'));

  // History button label + color
  const ahead = gitStatus?.ahead ?? 0;
  const behind = gitStatus?.behind ?? 0;
  const isUpToDate = ahead === 0 && behind === 0;
  const historyLabel = (() => {
    const parts: string[] = [];
    if (ahead > 0) parts.push(`${ahead} ahead`);
    if (behind > 0) parts.push(`${behind} behind`);
    if (parts.length > 0) return parts.join(', ');
    return 'Up to date';
  })();
  // Text color: emerald/crimson for ahead/behind, chrome for up to date or mixed
  const historyTextColor = isUpToDate
    ? 'text-text-chrome'
    : behind > 0 && ahead === 0
      ? 'text-crimson'
      : ahead > 0 && behind === 0
        ? 'text-emerald'
        : 'text-text-chrome';

  return (
    <header className="h-[48px] bg-surface-topbar flex items-center px-4 flex-shrink-0 border-b border-border-default relative">
      {isElectron && <div className="absolute top-0 left-0 right-0 h-[18px] electron-drag" />}
      <div className="flex-1 flex items-center min-w-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 text-text-secondary dark:text-zinc-300 hover:text-bronze-600 dark:hover:text-bronze-500">
              <h1 className="text-base font-semibold leading-tight truncate">
                {project.name}
              </h1>
              <ChevronDownIcon className="w-4 h-4 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52 p-0">
            <div className="p-1.5">
              <DropdownMenuLabel>View</DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => onViewTypeChange?.('kanban')}
                className={`text-xs gap-2 ${viewType === 'kanban' ? 'text-text-chrome-active' : ''}`}
              >
                <LayoutGridIcon className="w-3.5 h-3.5" />
                <span>Board</span>
                {viewType === 'kanban' && <CheckIcon className="w-3 h-3 ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onViewTypeChange?.('list')}
                className={`text-xs gap-2 ${viewType === 'list' ? 'text-text-chrome-active' : ''}`}
              >
                <ListIcon className="w-3.5 h-3.5" />
                <span>List</span>
                {viewType === 'list' && <CheckIcon className="w-3 h-3 ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onViewTypeChange?.('grid')}
                className={`text-xs gap-2 ${viewType === 'grid' ? 'text-text-chrome-active' : ''}`}
              >
                <ColumnsIcon className="w-3.5 h-3.5" />
                <span>Grid</span>
                {viewType === 'grid' && <CheckIcon className="w-3 h-3 ml-auto" />}
              </DropdownMenuItem>
            </div>
            <DropdownMenuSeparator />
            <div className="p-1.5">
              <DropdownMenuItem
                onSelect={() => onOpenSettings?.()}
                className="text-xs gap-2"
              >
                <SettingsIcon className="w-3.5 h-3.5" />
                <span>Project Settings</span>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1 flex justify-center min-w-0">
        <div className="bg-surface-hover/40 p-0.5 rounded-md flex items-center border border-border-default">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`relative px-3.5 py-1 text-xs font-medium rounded-md z-10 ${
                  isActive ? 'text-text-chrome-active' : 'text-text-tertiary dark:text-zinc-500 hover:text-bronze-600 dark:hover:text-bronze-500'
                }`}
              >
                {isActive && (
                  <div
                    className="absolute inset-0 bg-surface-primary rounded-md border border-border-hover/50 shadow-sm"
                    style={{ zIndex: -1 }}
                  />
                )}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-end gap-2 whitespace-nowrap">
        {!hasGit ? (
          /* No git — show init button */
          <button
            onClick={onInitGit}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-border-default bg-surface-secondary text-text-secondary hover:bg-surface-hover"
          >
            <GitBranchIcon className="w-3.5 h-3.5" />
            Track changes
          </button>
        ) : (
          <>
            {/* Uncommitted files dropdown */}
            {gitStatus && gitStatus.dirty > 0 && (
              <DropdownMenu open={dirtyDropdownOpen} onOpenChange={(open) => { setDirtyDropdownOpen(open); if (open) fetchDirtyFiles(); else setDirtyFiles(null); }}>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center text-xs font-medium rounded-md border border-border-default bg-surface-secondary text-crimson hover:bg-surface-hover hover:text-crimson overflow-hidden">
                    <span className="flex items-center gap-1.5 px-2.5 py-1.5">
                      {gitStatus.dirty} uncommitted {gitStatus.dirty === 1 ? 'file' : 'files'}
                    </span>
                    <span className="px-1.5 py-1.5 border-l border-border-default text-text-chrome">
                      <ChevronDownIcon className="w-3 h-3" />
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 max-h-72 overflow-hidden flex flex-col p-0">
                  <div className="flex-shrink-0 bg-surface-modal border-b border-border-subtle/60 px-2 py-1.5 flex items-center justify-between">
                    <span className="text-xs font-semibold text-crimson">{dirtyFiles?.length || gitStatus.dirty} Uncommitted Changes</span>
                    {onCommit && (
                      <button
                        onClick={() => { setDirtyDropdownOpen(false); onCommit(); }}
                        className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded text-crimson hover:bg-crimson/10"
                      >
                        Commit
                        <GitCommitHorizontalIcon className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {dirtyFiles === null ? (
                      <DropdownMenuItem disabled className="text-xs text-text-tertiary justify-center">
                        <Loader2Icon className="w-3 h-3 animate-spin mr-2" /> Loading...
                      </DropdownMenuItem>
                    ) : dirtyFiles.length === 0 ? (
                      <DropdownMenuItem disabled className="text-xs text-text-tertiary">No changes found</DropdownMenuItem>
                    ) : (
                      dirtyFiles.map((file, i) => (
                        <DropdownMenuItem key={i} className="text-xs gap-2 font-mono pointer-events-none min-w-0">
                          <StatusBadge status={file.status} />
                          <span className="truncate">{file.path}</span>
                        </DropdownMenuItem>
                      ))
                    )}
                  </div>
                  <DropdownMenuSeparator />
                  <div className="flex-shrink-0 p-1">
                    <DropdownMenuItem className="text-xs justify-center text-text-chrome" onSelect={openDiffModal}>
                      <DiffIcon className="!size-3" />
                      Diff
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Preview branch: show commits ahead of default branch */}
            {isOnPreviewBranch && gitStatus?.aheadOfMain != null && (
              <span className="flex items-center text-xs font-medium rounded-md border border-border-default bg-surface-secondary text-text-chrome px-2.5 py-1.5">
                {gitStatus.aheadOfMain === 0
                  ? 'No new commits'
                  : `${gitStatus.aheadOfMain} ${gitStatus.aheadOfMain === 1 ? 'commit' : 'commits'}`}
              </span>
            )}

            {/* Unified history dropdown (or direct modal when up to date) */}
            {!isOnPreviewBranch && gitStatus?.hasRemote && isUpToDate && (
              <button
                onClick={() => { fetchHistoryCommits(); openHistoryModal(); }}
                className={`flex items-center text-xs font-medium rounded-md border border-border-default bg-surface-secondary ${historyTextColor} hover:bg-surface-hover overflow-hidden`}
              >
                <span className="flex items-center gap-1.5 px-2.5 py-1.5">
                  {historyLabel}
                  <CheckIcon className="w-3 h-3" />
                </span>
              </button>
            )}
            {!isOnPreviewBranch && gitStatus?.hasRemote && !isUpToDate && (
              <DropdownMenu onOpenChange={(open) => { if (open) { setAheadCommits(null); setBehindCommits(null); fetchHistoryCommits(); setSyncError(null); } }}>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`flex items-center text-xs font-medium rounded-md border border-border-default bg-surface-secondary ${historyTextColor} hover:bg-surface-hover overflow-hidden`}
                  >
                    <span className="flex items-center gap-1.5 px-2.5 py-1.5">
                      {historyLabel}
                    </span>
                    <span className="px-1.5 py-1.5 border-l border-border-default text-text-chrome">
                      <ChevronDownIcon className="w-3 h-3" />
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 max-h-72 overflow-hidden flex flex-col p-0">
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {/* Behind commits */}
                    {behind > 0 && (
                      <>
                        <div className="sticky top-0 z-10 bg-surface-modal border-b border-border-subtle/60 px-2 py-1.5 flex items-center justify-between">
                          <span className="text-xs font-semibold text-crimson">{behind} Commits Behind</span>
                          {onPull && (
                            <button
                              onClick={async (e) => { e.stopPropagation(); if (pulling) return; setPulling(true); setSyncError(null); try { await onPull(); } catch (err) { setSyncError(err instanceof Error ? err.message : 'Pull failed'); } finally { setPulling(false); } }}
                              disabled={pulling}
                              className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded text-crimson hover:bg-crimson/10"
                            >
                              Pull
                              {pulling ? <Loader2Icon className="w-3 h-3 animate-spin" /> : <ArrowDownIcon className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                        {behindCommits === null ? (
                          <DropdownMenuItem disabled className="text-xs text-text-tertiary justify-center">
                            <Loader2Icon className="w-3 h-3 animate-spin mr-2" /> Loading...
                          </DropdownMenuItem>
                        ) : behindCommits.length === 0 ? (
                          <DropdownMenuItem disabled className="text-xs text-text-tertiary">No commits found</DropdownMenuItem>
                        ) : (
                          behindCommits.map((c, i) => (
                            <DropdownMenuItem key={i} className="text-xs gap-2 cursor-default hover:!bg-transparent focus:!bg-transparent" title={c.message} onSelect={(e) => e.preventDefault()}>
                              <span className="font-mono text-text-chrome shrink-0">{c.hash}</span>
                              <span className="truncate text-text-secondary">{c.message}</span>
                            </DropdownMenuItem>
                          ))
                        )}
                      </>
                    )}
                    {/* Ahead commits */}
                    {ahead > 0 && (
                      <>
                        <div className="sticky top-0 z-10 bg-surface-modal border-b border-border-subtle/60 px-2 py-1.5 flex items-center justify-between">
                          <span className="text-xs font-semibold text-emerald">{ahead} Commits Ahead</span>
                          {onPush && (
                            <button
                              onClick={async (e) => { e.stopPropagation(); if (pushing) return; setPushing(true); setSyncError(null); try { await onPush(); } catch (err) { setSyncError(err instanceof Error ? err.message : 'Push failed'); } finally { setPushing(false); } }}
                              disabled={pushing}
                              className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded text-emerald hover:bg-emerald/10"
                            >
                              Push
                              {pushing ? <Loader2Icon className="w-3 h-3 animate-spin" /> : <ArrowUpIcon className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                        {aheadCommits === null ? (
                          <DropdownMenuItem disabled className="text-xs text-text-tertiary justify-center">
                            <Loader2Icon className="w-3 h-3 animate-spin mr-2" /> Loading...
                          </DropdownMenuItem>
                        ) : aheadCommits.length === 0 ? (
                          <DropdownMenuItem disabled className="text-xs text-text-tertiary">No commits found</DropdownMenuItem>
                        ) : (
                          aheadCommits.map((c, i) => (
                            <DropdownMenuItem key={i} className="text-xs gap-2 cursor-default hover:!bg-transparent focus:!bg-transparent" title={c.message} onSelect={(e) => e.preventDefault()}>
                              <span className="font-mono text-text-chrome shrink-0">{c.hash}</span>
                              <span className="truncate text-text-secondary">{c.message}</span>
                            </DropdownMenuItem>
                          ))
                        )}
                      </>
                    )}
                  </div>
                  {syncError && (
                    <div className="flex-shrink-0 px-2 py-1.5 border-t border-border-subtle/60 text-[11px] text-red-400 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                      {syncError}
                    </div>
                  )}
                  <DropdownMenuSeparator />
                  <div className="flex-shrink-0 p-1">
                    <DropdownMenuItem className="text-xs justify-center text-text-chrome" onSelect={openHistoryModal}>
                      <HistoryIcon className="!size-3" />
                      Commit History
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Detail modal */}
            {detailModal && detailModal.type === 'diff' && (
              <GitDetailModal
                isOpen={true}
                onClose={() => setDetailModal(null)}
                title={detailModal.title}
                content={detailModal.content}
                type="diff"
              />
            )}
            {detailModal && detailModal.type === 'log' && projectId && (
              <GitDetailModal
                isOpen={true}
                onClose={() => setDetailModal(null)}
                title={detailModal.title}
                commits={detailModal.commits}
                behindCommits={detailModal.behindCommits}
                projectId={projectId}
                currentBranch={currentBranch}
                onPush={onPush}
                onPull={onPull}
                onSyncDone={refreshModalAfterSync}
                type="log"
              />
            )}

            {/* Branch selector */}
            {currentBranch && branches && branches.length > 0 && (
              <div className="relative">
                <button
                  ref={branchTriggerRef}
                  onClick={() => setBranchPopoverOpen(!branchPopoverOpen)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono rounded-md border outline-none ${
                    isOnPreviewBranch
                      ? 'border-lazuli/40 bg-surface-secondary text-lazuli shadow-[0_0_8px_rgba(91,131,176,0.1)] hover:text-lazuli-light hover:bg-surface-hover'
                      : 'border-border-default bg-surface-secondary text-text-chrome hover:bg-surface-hover'
                  }`}
                >
                  <GitBranchIcon className={`w-3.5 h-3.5 ${isOnPreviewBranch ? 'text-lazuli' : ''}`} />
                  <span className="max-w-[180px] truncate">
                    {isOnPreviewBranch && taskBranchMap?.[currentBranch!]
                      ? taskBranchMap[currentBranch!].split(/\s+/).slice(0, 4).join(' ')
                      : currentBranch}
                  </span>
                  <ChevronDownIcon className="w-3 h-3 opacity-50" />
                </button>
                {branchPopoverOpen && (
                  <BranchPopover
                    ref={branchPopoverRef}
                    branches={sortedBranches}
                    mainBranches={mainBranches}
                    proqBranches={proqBranches}
                    otherBranches={otherBranches}
                    currentBranch={currentBranch}
                    taskBranchMap={taskBranchMap}
                    branchFilter={branchFilter}
                    onFilterChange={setBranchFilter}
                    searchRef={branchSearchRef}
                    onSwitchBranch={(branch) => { onSwitchBranch?.(branch); setBranchPopoverOpen(false); }}
                    onClose={() => setBranchPopoverOpen(false)}
                    onCreateBranch={onCreateBranch ? async (name) => { await onCreateBranch(name); setBranchPopoverOpen(false); } : undefined}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </header>
  );
}

const BranchPopover = React.forwardRef<HTMLDivElement, {
  branches: string[];
  mainBranches: string[];
  proqBranches: string[];
  otherBranches: string[];
  currentBranch: string;
  taskBranchMap?: Record<string, string>;
  branchFilter: string;
  onFilterChange: (v: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onSwitchBranch: (branch: string) => void;
  onClose: () => void;
  onCreateBranch?: (name: string) => Promise<void>;
}>(function BranchPopover(props, ref) {
  const {
    branches, mainBranches, proqBranches, otherBranches, currentBranch, taskBranchMap,
    branchFilter, onFilterChange, searchRef, onSwitchBranch, onClose, onCreateBranch,
  } = props;
  const [creating, setCreating] = useState(false);

  const filter = branchFilter.toLowerCase().trim();
  const filteredMain = mainBranches.filter(b => b.toLowerCase().includes(filter));
  const filteredProq = proqBranches.filter(b => {
    const title = taskBranchMap?.[b]?.toLowerCase() || '';
    return b.toLowerCase().includes(filter) || title.includes(filter);
  });
  const filteredOther = otherBranches.filter(b => b.toLowerCase().includes(filter));
  const totalFiltered = filteredMain.length + filteredProq.length + filteredOther.length;

  // Show "Create branch" option when filter text doesn't exactly match any existing branch
  const exactMatch = filter && branches.some(b => b.toLowerCase() === filter);
  const showCreate = onCreateBranch && filter && !exactMatch;

  const handleCreate = async () => {
    if (!onCreateBranch || !filter || creating) return;
    setCreating(true);
    try {
      await onCreateBranch(branchFilter.trim());
    } catch { /* handled by caller */ }
    setCreating(false);
  };

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 w-[300px] z-50 rounded-lg border border-border-default bg-surface-modal shadow-lg overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-default">
        <span className="text-xs font-semibold text-text-primary">Switch branches</span>
        <button
          onClick={onClose}
          className="text-text-tertiary hover:text-text-secondary p-0.5 rounded"
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Search / create input */}
      <div className="px-2.5 py-2 border-b border-border-default">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-placeholder" />
          <input
            ref={searchRef}
            type="text"
            value={branchFilter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder={onCreateBranch ? 'Find or create a branch...' : 'Find a branch...'}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface-inset border border-border-strong rounded-md text-text-primary placeholder:text-text-placeholder focus:outline-none focus:border-border-strong"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && showCreate && totalFiltered === 0) {
                e.preventDefault();
                handleCreate();
              }
            }}
          />
        </div>
      </div>

      {/* Branch list */}
      <div className="max-h-[280px] overflow-y-auto">
        {filteredProq.map((branch) => (
          <BranchRow
            key={branch}
            branch={branch}
            isCurrent={branch === currentBranch}
            taskTitle={taskBranchMap?.[branch]}
            onSelect={() => onSwitchBranch(branch)}
          />
        ))}
        {filteredMain.length > 0 && filteredProq.length > 0 && (
          <div className="border-t border-border-default" />
        )}
        {filteredMain.map((branch) => (
          <BranchRow
            key={branch}
            branch={branch}
            isCurrent={branch === currentBranch}
            isDefault
            onSelect={() => onSwitchBranch(branch)}
          />
        ))}
        {filteredOther.length > 0 && (filteredMain.length > 0 || filteredProq.length > 0) && (
          <div className="border-t border-border-default" />
        )}
        {filteredOther.map((branch) => (
          <BranchRow
            key={branch}
            branch={branch}
            isCurrent={branch === currentBranch}
            onSelect={() => onSwitchBranch(branch)}
          />
        ))}

        {/* Create branch option — shown when filter doesn't match an existing branch */}
        {showCreate && (
          <>
            {totalFiltered > 0 && <div className="border-t border-border-default" />}
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:bg-surface-hover transition-colors"
            >
              {creating ? (
                <Loader2Icon className="w-3.5 h-3.5 shrink-0 animate-spin" />
              ) : (
                <GitBranchIcon className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
              )}
              <span>
                Create branch <strong className="text-text-primary">{branchFilter.trim()}</strong> from <strong className="text-text-primary">{currentBranch}</strong>
              </span>
            </button>
          </>
        )}

        {totalFiltered === 0 && !showCreate && (
          <div className="px-3 py-4 text-xs text-text-tertiary text-center">No branches match</div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border-default">
        <button
          onClick={() => onFilterChange('')}
          className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-text-secondary hover:bg-surface-hover transition-colors"
        >
          <span className="w-4 shrink-0 flex justify-center">
            <GitBranchIcon className="w-3.5 h-3.5 text-text-tertiary" />
          </span>
          View all branches
        </button>
      </div>
    </div>
  );
});

function BranchRow({ branch, isCurrent, isDefault, taskTitle, onSelect }: {
  branch: string;
  isCurrent: boolean;
  isDefault?: boolean;
  taskTitle?: string;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={() => { if (!isCurrent) onSelect(); }}
      className={`flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-surface-hover transition-colors ${
        isCurrent ? 'text-text-chrome-active' : 'text-text-secondary'
      }`}
    >
      <span className="w-4 shrink-0 flex justify-center">
        {isCurrent && <CheckIcon className="w-3.5 h-3.5" />}
      </span>
      {taskTitle ? (
        <>
          <span className="truncate">{taskTitle}</span>
          <span className="ml-auto text-[10px] font-mono text-text-tertiary truncate max-w-[100px]">
            {branch.replace('proq/', '')}
          </span>
        </>
      ) : (
        <span className="font-mono truncate">{branch}</span>
      )}
      {isDefault && (
        <span className="ml-auto text-[10px] font-medium text-text-tertiary border border-border-default rounded px-1.5 py-0.5 leading-none">
          default
        </span>
      )}
    </button>
  );
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  M: { label: 'M', color: 'text-yellow-400' },
  A: { label: 'A', color: 'text-green-400' },
  D: { label: 'D', color: 'text-red-400' },
  R: { label: 'R', color: 'text-blue-400' },
  '?': { label: '?', color: 'text-text-tertiary' },
  '??': { label: '?', color: 'text-text-tertiary' },
};

function StatusBadge({ status }: { status: string }) {
  const info = STATUS_LABELS[status] || { label: status, color: 'text-text-secondary' };
  return (
    <span className={`${info.color} font-mono w-4 text-center shrink-0`}>{info.label}</span>
  );
}
