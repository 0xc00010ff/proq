'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeftIcon, Loader2Icon, XIcon, FileIcon, ArrowUpIcon, ArrowDownIcon } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { FileDiffAccordion } from '@/components/FileDiffAccordion';
import { parseDiffIntoFiles, parseCommitShow, colorDiffLine } from '@/lib/diff-parser';
import type { FileDiff } from '@/lib/diff-parser';

interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
  insertions?: number;
  deletions?: number;
}

type GitDetailModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
} & (
  | { type: 'diff'; content: string; commits?: never; behindCommits?: never; projectId?: never; currentBranch?: never; onPush?: never; onPull?: never }
  | { type: 'log'; commits: CommitInfo[]; behindCommits?: CommitInfo[]; projectId: string; currentBranch?: string; onPush?: () => Promise<void>; onPull?: () => Promise<void>; onSyncDone?: () => void; content?: never }
);

export function GitDetailModal(props: GitDetailModalProps) {
  const { isOpen, onClose, title, type } = props;

  const [selectedCommit, setSelectedCommit] = useState<{ hash: string; message: string; files: FileDiff[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());
  const [pushingInline, setPushingInline] = useState(false);
  const [pullingInline, setPullingInline] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  // Paginated history (commits below origin)
  const [historyCommits, setHistoryCommits] = useState<CommitInfo[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);

  // Load initial paginated history when the log modal opens
  useEffect(() => {
    if (type !== 'log' || !isOpen || !props.projectId || initialLoaded) return;
    setInitialLoaded(true);
    (async () => {
      setHistoryLoading(true);
      try {
        const res = await fetch(`/api/projects/${props.projectId}/git`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'log-paginated', skip: props.commits.length, limit: 100 }),
        });
        if (res.ok) {
          const data = await res.json();
          const commits = data.commits || [];
          setHistoryCommits(commits);
          setHasMore(commits.length >= 100);
        }
      } catch { /* best effort */ }
      setHistoryLoading(false);
    })();
  }, [type, isOpen, props.projectId, initialLoaded]);

  const loadMore = useCallback(async () => {
    if (type !== 'log' || !props.projectId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/projects/${props.projectId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'log-paginated', skip: props.commits.length + historyCommits.length, limit: 100 }),
      });
      if (res.ok) {
        const data = await res.json();
        const newCommits = data.commits || [];
        setHistoryCommits((prev) => [...prev, ...newCommits]);
        setHasMore(newCommits.length >= 100);
      }
    } catch { /* best effort */ }
    setHistoryLoading(false);
  }, [type, props.projectId, historyCommits.length]);

  const handleSelectCommit = useCallback(async (hash: string) => {
    if (type !== 'log' || !props.projectId) return;
    setLoading(true);
    setOpenFiles(new Set());
    try {
      const res = await fetch(`/api/projects/${props.projectId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'show-commit', hash }),
      });
      if (res.ok) {
        const data = await res.json();
        const parsed = parseCommitShow(data.diff || '');
        const files = parsed.files;
        setSelectedCommit({ hash: parsed.hash || hash.slice(0, 7), message: parsed.message, files });
        setOpenFiles(new Set(files.map((f, i) => `${i}:${f.fileName}`)));
      }
    } catch { /* best effort */ }
    setLoading(false);
  }, [type, props]);

  const handleClose = useCallback(() => {
    setSelectedCommit(null);
    setLoading(false);
    setOpenFiles(new Set());
    setHistoryCommits([]);
    setInitialLoaded(false);
    setHasMore(true);
    setPullError(null);
    setPushError(null);
    onClose();
  }, [onClose]);

  const handleBack = useCallback(() => {
    setSelectedCommit(null);
    setOpenFiles(new Set());
  }, []);

  const toggleFile = useCallback((key: string) => {
    setOpenFiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Parse diff content into files for the diff view
  const diffFiles = type === 'diff' ? parseDiffIntoFiles(props.content) : [];

  // Default all diff files to expanded when modal opens
  useEffect(() => {
    if (type === 'diff' && isOpen && diffFiles.length > 0 && openFiles.size === 0) {
      setOpenFiles(new Set(diffFiles.map((f, i) => `${i}:${f.fileName}`)));
    }
  }, [type, isOpen, diffFiles.length]);
  const currentFiles = type === 'diff' ? diffFiles : (selectedCommit?.files || []);
  const allExpanded = currentFiles.length > 0 && openFiles.size >= currentFiles.length;

  const handleExpandCollapseAll = useCallback(() => {
    if (allExpanded) {
      setOpenFiles(new Set());
    } else {
      setOpenFiles(new Set(currentFiles.map((f, i) => `${i}:${f.fileName}`)));
    }
  }, [allExpanded, currentFiles]);

  const branchLabel = type === 'log' && props.currentBranch
    ? `origin/${props.currentBranch}`
    : 'origin';

  // Build header summary for log mode
  const behindCount = type === 'log' ? (props.behindCommits?.length ?? 0) : 0;
  const aheadCount = type === 'log' ? props.commits.length : 0;
  const headerSummary = (() => {
    if (type !== 'log') return null;
    const styledBranch = <span className="text-bronze-600">{branchLabel}</span>;
    const parts: React.ReactNode[] = [];
    if (aheadCount > 0) parts.push(<React.Fragment key="ahead">{aheadCount} {aheadCount === 1 ? 'commit' : 'commits'} ahead of {styledBranch}</React.Fragment>);
    if (behindCount > 0) parts.push(<React.Fragment key="behind">{behindCount} {behindCount === 1 ? 'commit' : 'commits'} behind {styledBranch}</React.Fragment>);
    if (parts.length > 0) return <>{parts.reduce<React.ReactNode[]>((acc, p, i) => i === 0 ? [p] : [...acc, ', ', p], [])}</>;
    return <>up to date with {styledBranch}</>;
  })();

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      showClose={false}
      className="w-[50vw] min-w-[40vw] max-w-[80vw] h-[80vh] flex flex-col resize overflow-auto"
    >
      <div className="px-3 border-b border-border-default flex items-center gap-2 shrink-0 h-[48px]">
        {type === 'log' && selectedCommit && (
          <button
            onClick={handleBack}
            className="text-text-chrome hover:text-text-chrome-hover p-1 rounded hover:bg-surface-hover/50"
          >
            <ArrowLeftIcon className="w-4 h-4" />
          </button>
        )}
        <h3 className="flex-1 min-w-0 truncate flex items-center">
          {type === 'log' && selectedCommit
            ? <span className="text-sm font-semibold"><span className="text-[10px] text-text-tertiary font-semibold uppercase tracking-wide leading-none mr-1.5">commit</span><span className="font-mono text-text-chrome leading-none">{selectedCommit.hash}</span></span>
            : type === 'log'
              ? <span className="text-[10px] text-text-tertiary font-semibold leading-none flex items-center gap-1.5"><span className="uppercase tracking-wide">Git Log</span> <span className="text-text-tertiary">·</span> on branch <span className="text-bronze-600">{props.currentBranch || 'main'}</span> <span className="text-text-tertiary">·</span> {headerSummary}</span>
              : <span className="text-[10px] text-text-tertiary font-semibold leading-none uppercase tracking-wide">{title}</span>
          }
        </h3>
        <button
          onClick={handleClose}
          className="text-text-chrome hover:text-text-chrome-hover p-1 rounded hover:bg-surface-hover/50"
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto min-h-0">
        {type === 'diff' && diffFiles.length > 0 && (
          <div className="px-5 py-3 border-b border-border-default flex items-center justify-between">
            <FileStatSummary files={diffFiles} />
            <button
              onClick={handleExpandCollapseAll}
              className="text-xs text-text-chrome hover:text-text-chrome-hover px-2 py-1 rounded border border-border-strong/50 shrink-0"
            >
              {allExpanded ? 'Collapse All' : 'Expand All'}
            </button>
          </div>
        )}
        {type === 'diff' && (
          diffFiles.length > 0 ? (
            diffFiles.map((file, i) => {
              const key = `${i}:${file.fileName}`;
              return (
                <FileDiffAccordion key={key} file={file} isOpen={openFiles.has(key)} onToggle={() => toggleFile(key)} />
              );
            })
          ) : (
            <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words p-4">
              {props.content.split('\n').map((line, i) => {
                const color = colorDiffLine(line);
                return (
                  <div key={i} className={color || 'text-text-secondary'}>
                    {line || '\u00A0'}
                  </div>
                );
              })}
            </pre>
          )
        )}
        {type === 'log' && selectedCommit && !loading && (() => {
          const lines = selectedCommit.message.split('\n');
          const commitTitle = lines[0];
          const body = lines.slice(1).join('\n').replace(/^\n+/, '');
          return (
            <div className="px-5 py-3 border-b border-border-default space-y-3">
              <p className="text-sm text-text-primary font-medium">{commitTitle}</p>
              {body && (
                <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">{body}</p>
              )}
              <div className="flex items-center justify-between">
                <FileStatSummary files={selectedCommit.files} />
                <button
                  onClick={handleExpandCollapseAll}
                  className="text-xs text-text-chrome hover:text-text-chrome-hover px-2 py-1 rounded border border-border-strong/50 shrink-0"
                >
                  {allExpanded ? 'Collapse All' : 'Expand All'}
                </button>
              </div>
            </div>
          );
        })()}
        {type === 'log' && !selectedCommit && !loading && (
          <>
            {/* Behind commits section */}
            {behindCount > 0 && props.behindCommits && (
              <div>
                <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 border-b border-border-default/50">
                  <span className="text-[10px] text-crimson font-semibold uppercase tracking-wide">
                    {behindCount} {behindCount === 1 ? 'commit' : 'commits'} behind
                  </span>
                  {props.onPull && (
                    <button
                      onClick={async () => {
                        if (pullingInline || !props.onPull) return;
                        setPullingInline(true);
                        setPullError(null);
                        try { await props.onPull(); props.onSyncDone?.(); } catch (err) { setPullError(err instanceof Error ? err.message : 'Pull failed'); } finally { setPullingInline(false); }
                      }}
                      disabled={pullingInline}
                      className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border border-crimson/30 text-crimson hover:bg-crimson/10"
                    >
                      Pull
                      {pullingInline
                        ? <Loader2Icon className="w-3 h-3 animate-spin" />
                        : <ArrowDownIcon className="w-3 h-3" />
                      }
                    </button>
                  )}
                </div>
                {pullError && (
                  <div className="px-4 py-1.5 text-xs text-red-400 whitespace-pre-wrap break-words bg-surface-secondary border-b border-border-default/50">
                    {pullError}
                  </div>
                )}
                <div className="divide-y divide-border-default/50">
                  {props.behindCommits.map((c) => (
                    <CommitRow key={c.hash} commit={c} onSelect={handleSelectCommit} />
                  ))}
                </div>
              </div>
            )}

            {/* Ahead commits section */}
            {aheadCount > 0 && (
              <div>
                <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 border-b border-border-default/50">
                  <span className="text-[10px] text-emerald font-semibold uppercase tracking-wide">
                    {aheadCount} {aheadCount === 1 ? 'commit' : 'commits'} ahead
                  </span>
                  {props.onPush && (
                    <button
                      onClick={async () => {
                        if (pushingInline || !props.onPush) return;
                        setPushingInline(true);
                        setPushError(null);
                        try { await props.onPush(); props.onSyncDone?.(); } catch (err) { setPushError(err instanceof Error ? err.message : 'Push failed'); } finally { setPushingInline(false); }
                      }}
                      disabled={pushingInline}
                      className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border border-emerald/30 text-emerald hover:bg-emerald/10"
                    >
                      Push
                      {pushingInline
                        ? <Loader2Icon className="w-3 h-3 animate-spin" />
                        : <ArrowUpIcon className="w-3 h-3" />
                      }
                    </button>
                  )}
                </div>
                {pushError && (
                  <div className="px-4 py-1.5 text-xs text-red-400 whitespace-pre-wrap break-words bg-surface-secondary border-b border-border-default/50">
                    {pushError}
                  </div>
                )}
                <div className="divide-y divide-border-default/50">
                  {props.commits.map((c) => (
                    <CommitRow key={c.hash} commit={c} onSelect={handleSelectCommit} />
                  ))}
                </div>
              </div>
            )}

            {/* Origin separator — always shown */}
            <div className="flex items-center gap-3 px-4 py-2 text-[10px] text-text-chrome font-mono">
              <div className="flex-1 border-t border-bronze-600/30" />
              <span>{branchLabel}</span>
              <div className="flex-1 border-t border-bronze-600/30" />
            </div>

            {/* Paginated history */}
            {historyCommits.length > 0 && (
              <div className="divide-y divide-border-default/50">
                {historyCommits.map((c) => (
                  <CommitRow key={c.hash} commit={c} onSelect={handleSelectCommit} />
                ))}
              </div>
            )}

            {/* Show more / loading */}
            {historyLoading && (
              <div className="flex items-center justify-center py-4 text-text-tertiary">
                <Loader2Icon className="w-4 h-4 animate-spin mr-2" />
                <span className="text-xs">Loading...</span>
              </div>
            )}
            {!historyLoading && hasMore && historyCommits.length > 0 && (
              <div className="flex justify-center py-4">
                <button
                  onClick={loadMore}
                  className="text-xs text-text-chrome hover:text-text-chrome-hover px-3 py-1.5 rounded border border-border-strong/50 hover:border-border-hover"
                >
                  Show more
                </button>
              </div>
            )}

            {aheadCount === 0 && behindCount === 0 && historyCommits.length === 0 && !historyLoading && (
              <div className="flex items-center justify-center py-12 text-text-tertiary text-xs">
                No commits found
              </div>
            )}
          </>
        )}
        {type === 'log' && loading && (
          <div className="flex items-center justify-center py-12 text-text-tertiary">
            <Loader2Icon className="w-5 h-5 animate-spin mr-2" />
            <span className="text-xs">Loading diff...</span>
          </div>
        )}
        {type === 'log' && selectedCommit && !loading && (
          selectedCommit.files.length > 0 ? (
            selectedCommit.files.map((file, i) => {
              const key = `${i}:${file.fileName}`;
              return (
                <FileDiffAccordion key={key} file={file} isOpen={openFiles.has(key)} onToggle={() => toggleFile(key)} />
              );
            })
          ) : (
            <div className="flex items-center justify-center py-12 text-text-tertiary text-xs">
              No file changes
            </div>
          )
        )}
      </div>
    </Modal>
  );
}

function FileStatSummary({ files }: { files: FileDiff[] }) {
  if (files.length === 0) return null;
  const counts = { added: 0, modified: 0, deleted: 0, renamed: 0 };
  for (const f of files) counts[f.status]++;
  const parts: { label: string; count: number; color: string }[] = [];
  if (counts.added) parts.push({ label: counts.added === 1 ? 'new file' : 'new files', count: counts.added, color: 'text-green-400' });
  if (counts.modified) parts.push({ label: 'modified', count: counts.modified, color: 'text-text-secondary' });
  if (counts.deleted) parts.push({ label: 'deleted', count: counts.deleted, color: 'text-red-400' });
  if (counts.renamed) parts.push({ label: 'renamed', count: counts.renamed, color: 'text-blue-400' });
  return (
    <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
      <FileIcon className="w-3 h-3 text-text-tertiary shrink-0" />
      {parts.map((p, i) => (
        <span key={i} className={p.color}>
          {p.count} {p.label}
        </span>
      ))}
    </div>
  );
}


function CommitRow({ commit, onSelect }: { commit: CommitInfo; onSelect: (hash: string) => void }) {
  return (
    <button
      onClick={() => onSelect(commit.hash)}
      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-hover/40 group"
    >
      <span className="font-mono text-xs text-text-chrome shrink-0">{commit.hash}</span>
      <span className="text-xs text-text-primary truncate flex-1 flex items-center gap-2">
        <span className="truncate">{commit.message}</span>
        {(commit.insertions != null || commit.deletions != null) && (
          <span className="flex items-center gap-1 font-mono text-[10px] shrink-0">
            {commit.insertions != null && commit.insertions > 0 && <span className="text-green-400">+{commit.insertions}</span>}
            {commit.deletions != null && commit.deletions > 0 && <span className="text-red-400">-{commit.deletions}</span>}
          </span>
        )}
      </span>
      <span className="text-[10px] text-text-tertiary w-20 text-right truncate hidden sm:block">{commit.author}</span>
      <span className="text-[10px] text-text-tertiary w-20 text-right truncate">{commit.date}</span>
    </button>
  );
}
