'use client';

import React, { useState, useCallback } from 'react';
import { GitBranchIcon, ChevronDownIcon, CheckIcon, ArrowUpIcon, ArrowDownIcon, Loader2Icon, HistoryIcon, DiffIcon } from 'lucide-react';
import type { Project, ProjectTab } from '@/lib/types';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { GitDetailModal } from '@/components/GitDetailModal';

export type TabOption = ProjectTab;

export interface GitStatus {
  hasGit: boolean;
  hasRemote: boolean;
  ahead: number;
  behind: number;
  dirty: number;
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
}

export function TopBar({ project, activeTab, onTabChange, currentBranch, branches, taskBranchMap, onSwitchBranch, projectId, gitStatus, onPush, onPull, onInitGit }: TopBarProps) {
  // Dropdown data for status labels
  const [dirtyFiles, setDirtyFiles] = useState<{ path: string; status: string }[] | null>(null);

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

  const tabs: { id: TabOption; label: string }[] = [
    { id: 'project', label: 'Project' },
    { id: 'live', label: 'Live' },
    { id: 'code', label: 'Code' },
  ];

  const isOnPreviewBranch = currentBranch?.startsWith('proq/') ?? false;
  const hasGit = gitStatus?.hasGit !== false;

  // Sort branches: main first, then proq/* branches, then others
  const sortedBranches = branches ? [...branches].sort((a, b) => {
    if (a === 'main' || a === 'master') return -1;
    if (b === 'main' || b === 'master') return 1;
    const aIsProq = a.startsWith('proq/');
    const bIsProq = b.startsWith('proq/');
    if (aIsProq && !bIsProq) return -1;
    if (!aIsProq && bIsProq) return 1;
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
  // Text color: red if behind only, green if ahead only, chrome if both, bronze if up to date
  const historyTextColor = isUpToDate
    ? 'text-bronze-500'
    : behind > 0 && ahead === 0
      ? 'text-red-400'
      : ahead > 0 && behind === 0
        ? 'text-green-400'
        : 'text-text-chrome';

  return (
    <header className="h-16 bg-surface-base flex items-center px-6 flex-shrink-0">
      <div className="flex-1 flex flex-col justify-center min-w-0">
        <h1 className="text-lg font-semibold text-bronze-900 dark:text-zinc-100 leading-tight">
          {project.path.replace(/\/+$/, "").split("/").pop() || project.name}
        </h1>
        <span className="text-xs font-mono text-zinc-500 mt-0.5">
          {project.path}
        </span>
      </div>

      <div className="flex-1 flex justify-center min-w-0">
        <div className="bg-surface-secondary p-1 rounded-lg flex items-center border border-border-default">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`relative px-4 py-1.5 text-sm font-medium rounded-md z-10 ${
                  isActive ? 'text-text-chrome-active' : 'text-text-chrome hover:text-text-chrome-hover'
                }`}
              >
                {isActive && (
                  <div
                    className="absolute inset-0 bg-bronze-50 dark:bg-zinc-800/60 rounded-md border border-bronze-400/50 dark:border-bronze-800/50 shadow-sm"
                    style={{ zIndex: -1 }}
                  />
                )}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
        {!hasGit ? (
          /* No git — show init button */
          <button
            onClick={onInitGit}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-border-default bg-surface-secondary text-text-chrome hover:text-text-chrome-hover hover:bg-surface-hover transition-colors"
          >
            <GitBranchIcon className="w-3.5 h-3.5" />
            Track changes
          </button>
        ) : (
          <>
            {/* Uncommitted files dropdown */}
            {gitStatus && gitStatus.dirty > 0 && (
              <DropdownMenu onOpenChange={(open) => { if (open) fetchDirtyFiles(); else setDirtyFiles(null); }}>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center text-xs font-medium rounded-md border border-border-default bg-surface-secondary text-red-400 hover:bg-surface-hover transition-colors overflow-hidden">
                    <span className="flex items-center gap-1.5 px-2.5 py-1.5">
                      {gitStatus.dirty} uncommitted {gitStatus.dirty === 1 ? 'file' : 'files'}
                    </span>
                    <span className="px-1.5 py-1.5 border-l border-border-default text-bronze-500">
                      <ChevronDownIcon className="w-3 h-3" />
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 max-h-72 overflow-hidden flex flex-col p-0">
                  <div className="flex-shrink-0 py-1">
                    <DropdownMenuLabel>{dirtyFiles?.length || 0} Uncommitted Changes</DropdownMenuLabel>
                  </div>
                  <DropdownMenuSeparator />
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {dirtyFiles === null ? (
                      <DropdownMenuItem disabled className="text-xs text-zinc-500 justify-center">
                        <Loader2Icon className="w-3 h-3 animate-spin mr-2" /> Loading...
                      </DropdownMenuItem>
                    ) : dirtyFiles.length === 0 ? (
                      <DropdownMenuItem disabled className="text-xs text-zinc-500">No changes found</DropdownMenuItem>
                    ) : (
                      dirtyFiles.map((file, i) => (
                        <DropdownMenuItem key={i} className="text-xs gap-2 font-mono pointer-events-none">
                          <StatusBadge status={file.status} />
                          <span className="truncate">{file.path}</span>
                        </DropdownMenuItem>
                      ))
                    )}
                  </div>
                  <DropdownMenuSeparator />
                  <div className="flex-shrink-0 p-1">
                    <DropdownMenuItem className="text-xs justify-center text-bronze-500" onSelect={openDiffModal}>
                      <DiffIcon className="!size-3" />
                      Diff
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Unified history dropdown */}
            {gitStatus?.hasRemote && (
              <DropdownMenu onOpenChange={(open) => { if (open) { setAheadCommits(null); setBehindCommits(null); fetchHistoryCommits(); setSyncError(null); } }}>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`flex items-center text-xs font-medium rounded-md border border-border-default bg-surface-secondary ${historyTextColor} hover:bg-surface-hover transition-colors overflow-hidden`}
                  >
                    <span className="flex items-center gap-1.5 px-2.5 py-1.5">
                      {historyLabel}
                      {isUpToDate && <CheckIcon className="w-3 h-3" />}
                    </span>
                    <span className="px-1.5 py-1.5 border-l border-border-default text-bronze-500">
                      <ChevronDownIcon className="w-3 h-3" />
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 max-h-72 overflow-hidden flex flex-col p-0">
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {/* Behind commits */}
                    {behind > 0 && (
                      <>
                        <div className="sticky top-0 z-10 bg-surface-secondary border-b border-zinc-800/50 px-2 py-1.5 flex items-center justify-between">
                          <span className="text-xs font-semibold text-red-400">{behind} Commits Behind</span>
                          {onPull && (
                            <button
                              onClick={async (e) => { e.stopPropagation(); if (pulling) return; setPulling(true); setSyncError(null); try { await onPull(); } catch (err) { setSyncError(err instanceof Error ? err.message : 'Pull failed'); } finally { setPulling(false); } }}
                              disabled={pulling}
                              className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded text-red-400 hover:bg-red-500/10 transition-colors"
                            >
                              Pull
                              {pulling ? <Loader2Icon className="w-3 h-3 animate-spin" /> : <ArrowDownIcon className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                        {behindCommits === null ? (
                          <DropdownMenuItem disabled className="text-xs text-zinc-500 justify-center">
                            <Loader2Icon className="w-3 h-3 animate-spin mr-2" /> Loading...
                          </DropdownMenuItem>
                        ) : behindCommits.length === 0 ? (
                          <DropdownMenuItem disabled className="text-xs text-zinc-500">No commits found</DropdownMenuItem>
                        ) : (
                          behindCommits.map((c, i) => (
                            <DropdownMenuItem key={i} className="text-xs gap-2 pointer-events-none">
                              <span className="font-mono text-bronze-500 shrink-0">{c.hash}</span>
                              <span className="truncate text-zinc-400">{c.message}</span>
                            </DropdownMenuItem>
                          ))
                        )}
                      </>
                    )}
                    {/* Ahead commits */}
                    {ahead > 0 && (
                      <>
                        <div className="sticky top-0 z-10 bg-surface-secondary border-b border-zinc-800/50 px-2 py-1.5 flex items-center justify-between">
                          <span className="text-xs font-semibold text-green-400">{ahead} Commits Ahead</span>
                          {onPush && (
                            <button
                              onClick={async (e) => { e.stopPropagation(); if (pushing) return; setPushing(true); setSyncError(null); try { await onPush(); } catch (err) { setSyncError(err instanceof Error ? err.message : 'Push failed'); } finally { setPushing(false); } }}
                              disabled={pushing}
                              className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded text-green-400 hover:bg-green-500/10 transition-colors"
                            >
                              Push
                              {pushing ? <Loader2Icon className="w-3 h-3 animate-spin" /> : <ArrowUpIcon className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                        {aheadCommits === null ? (
                          <DropdownMenuItem disabled className="text-xs text-zinc-500 justify-center">
                            <Loader2Icon className="w-3 h-3 animate-spin mr-2" /> Loading...
                          </DropdownMenuItem>
                        ) : aheadCommits.length === 0 ? (
                          <DropdownMenuItem disabled className="text-xs text-zinc-500">No commits found</DropdownMenuItem>
                        ) : (
                          aheadCommits.map((c, i) => (
                            <DropdownMenuItem key={i} className="text-xs gap-2 pointer-events-none">
                              <span className="font-mono text-bronze-500 shrink-0">{c.hash}</span>
                              <span className="truncate text-zinc-400">{c.message}</span>
                            </DropdownMenuItem>
                          ))
                        )}
                      </>
                    )}
                    {/* Up to date — just show header */}
                    {isUpToDate && (
                      <div className="py-1">
                        <DropdownMenuLabel>Commits</DropdownMenuLabel>
                      </div>
                    )}
                  </div>
                  {syncError && (
                    <div className="flex-shrink-0 px-2 py-1.5 border-t border-zinc-800/50 text-[11px] text-red-400 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                      {syncError}
                    </div>
                  )}
                  <DropdownMenuSeparator />
                  <div className="flex-shrink-0 p-1">
                    <DropdownMenuItem className="text-xs justify-center text-bronze-500" onSelect={openHistoryModal}>
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono rounded-md border transition-colors outline-none ${
                      isOnPreviewBranch
                        ? 'border-gold/40 bg-surface-secondary text-gold shadow-[0_0_8px_rgba(201,168,76,0.1)] hover:text-gold-light hover:bg-surface-hover'
                        : 'border-border-default bg-surface-secondary text-text-chrome hover:text-text-chrome-hover hover:bg-surface-hover'
                    }`}
                  >
                    <GitBranchIcon className={`w-3.5 h-3.5 ${isOnPreviewBranch ? 'text-gold' : ''}`} />
                    <span className="max-w-[180px] truncate">
                      {isOnPreviewBranch && taskBranchMap?.[currentBranch!]
                        ? taskBranchMap[currentBranch!].split(/\s+/).slice(0, 4).join(' ')
                        : currentBranch}
                    </span>
                    <ChevronDownIcon className="w-3 h-3 opacity-50" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72 max-h-64 overflow-hidden flex flex-col p-0">
                  <div className="flex-shrink-0 py-1">
                    <DropdownMenuLabel>Branches</DropdownMenuLabel>
                  </div>
                  <DropdownMenuSeparator />
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {mainBranches.map((branch) => (
                      <BranchItem
                        key={branch}
                        branch={branch}
                        isCurrent={branch === currentBranch}
                        onSelect={() => onSwitchBranch?.(branch)}
                      />
                    ))}
                    {proqBranches.length > 0 && mainBranches.length > 0 && (
                      <DropdownMenuSeparator />
                    )}
                    {proqBranches.map((branch) => (
                      <BranchItem
                        key={branch}
                        branch={branch}
                        isCurrent={branch === currentBranch}
                        taskTitle={taskBranchMap?.[branch]}
                        onSelect={() => onSwitchBranch?.(branch)}
                      />
                    ))}
                    {otherBranches.length > 0 && (mainBranches.length > 0 || proqBranches.length > 0) && (
                      <DropdownMenuSeparator />
                    )}
                    {otherBranches.map((branch) => (
                      <BranchItem
                        key={branch}
                        branch={branch}
                        isCurrent={branch === currentBranch}
                        onSelect={() => onSwitchBranch?.(branch)}
                      />
                    ))}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
      </div>
    </header>
  );
}

function BranchItem({ branch, isCurrent, taskTitle, onSelect }: {
  branch: string;
  isCurrent: boolean;
  taskTitle?: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={() => { if (!isCurrent) onSelect(); }}
      className={`text-xs gap-2 ${isCurrent ? 'text-text-chrome-active' : ''}`}
    >
      {isCurrent ? (
        <CheckIcon className="w-3 h-3 shrink-0" />
      ) : (
        <span className="w-3 shrink-0" />
      )}
      {taskTitle ? (
        <>
          <span className="truncate">{taskTitle}</span>
          <span className="ml-auto text-[10px] font-mono text-bronze-500 dark:text-zinc-600 truncate max-w-[100px]">
            {branch.replace('proq/', '')}
          </span>
        </>
      ) : (
        <span className="font-mono truncate">{branch}</span>
      )}
    </DropdownMenuItem>
  );
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  M: { label: 'M', color: 'text-yellow-400' },
  A: { label: 'A', color: 'text-green-400' },
  D: { label: 'D', color: 'text-red-400' },
  R: { label: 'R', color: 'text-blue-400' },
  '?': { label: '?', color: 'text-zinc-500' },
  '??': { label: '?', color: 'text-zinc-500' },
};

function StatusBadge({ status }: { status: string }) {
  const info = STATUS_LABELS[status] || { label: status, color: 'text-zinc-400' };
  return (
    <span className={`${info.color} font-mono w-4 text-center shrink-0`}>{info.label}</span>
  );
}
