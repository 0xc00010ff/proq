'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2Icon, XIcon, FileIcon, GitCommitHorizontalIcon } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { FileDiffAccordion } from '@/components/FileDiffAccordion';
import { parseCommitShow } from '@/lib/diff-parser';
import type { FileDiff } from '@/lib/diff-parser';

interface CommitDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  commitHash: string;
  commitMessage?: string;
}

export function CommitDiffModal({ isOpen, onClose, projectId, commitHash, commitMessage }: CommitDiffModalProps) {
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [parsedMessage, setParsedMessage] = useState('');
  const [parsedHash, setParsedHash] = useState('');
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen || !commitHash) return;
    setLoading(true);
    setFiles([]);
    setOpenFiles(new Set());
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/git`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'show-commit', hash: commitHash }),
        });
        if (res.ok) {
          const data = await res.json();
          const parsed = parseCommitShow(data.diff || '');
          setFiles(parsed.files);
          setParsedMessage(parsed.message || commitMessage || '');
          setParsedHash(parsed.hash || commitHash.slice(0, 7));
          setOpenFiles(new Set(parsed.files.map((f, i) => `${i}:${f.fileName}`)));
        }
      } catch { /* best effort */ }
      setLoading(false);
    })();
  }, [isOpen, commitHash, projectId, commitMessage]);

  const handleClose = useCallback(() => {
    setFiles([]);
    setOpenFiles(new Set());
    setLoading(false);
    onClose();
  }, [onClose]);

  const toggleFile = useCallback((key: string) => {
    setOpenFiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const allExpanded = files.length > 0 && openFiles.size >= files.length;

  const handleExpandCollapseAll = useCallback(() => {
    if (allExpanded) {
      setOpenFiles(new Set());
    } else {
      setOpenFiles(new Set(files.map((f, i) => `${i}:${f.fileName}`)));
    }
  }, [allExpanded, files]);

  const messageLines = parsedMessage.split('\n');
  const title = messageLines[0];
  const body = messageLines.slice(1).join('\n').replace(/^\n+/, '');

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      showClose={false}
      className="w-[50vw] min-w-[40vw] max-w-[80vw] h-[80vh] flex flex-col resize overflow-auto"
    >
      <div className="px-3 border-b border-border-default flex items-center gap-2 shrink-0 h-[48px]">
        <h3 className="flex-1 min-w-0 truncate flex items-center">
          <span className="text-sm font-semibold">
            <span className="text-[10px] text-text-tertiary font-semibold uppercase tracking-wide leading-none mr-1.5">commit</span>
            <span className="font-mono text-text-chrome leading-none">{parsedHash || commitHash.slice(0, 7)}</span>
          </span>
        </h3>
        <button
          onClick={handleClose}
          className="text-text-chrome hover:text-text-chrome-hover p-1 rounded hover:bg-surface-hover/50"
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto min-h-0">
        {loading && (
          <div className="flex items-center justify-center py-12 text-text-tertiary">
            <Loader2Icon className="w-5 h-5 animate-spin mr-2" />
            <span className="text-xs">Loading diff...</span>
          </div>
        )}
        {!loading && files.length > 0 && (
          <>
            <div className="px-5 py-3 border-b border-border-default space-y-3">
              <p className="text-sm text-text-primary font-medium">{title}</p>
              {body && (
                <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">{body}</p>
              )}
              <div className="flex items-center justify-between">
                <FileStatSummary files={files} />
                <button
                  onClick={handleExpandCollapseAll}
                  className="text-xs text-text-chrome hover:text-text-chrome-hover px-2 py-1 rounded border border-border-strong/50 shrink-0"
                >
                  {allExpanded ? 'Collapse All' : 'Expand All'}
                </button>
              </div>
            </div>
            {files.map((file, i) => {
              const key = `${i}:${file.fileName}`;
              return (
                <FileDiffAccordion key={key} file={file} isOpen={openFiles.has(key)} onToggle={() => toggleFile(key)} />
              );
            })}
          </>
        )}
        {!loading && files.length === 0 && (
          <div className="flex items-center justify-center py-12 text-text-tertiary text-xs">
            No file changes
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── All Commits Diff Modal (drill-down) ──────────────────────────────

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

interface AllCommitsDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  commits: { hash: string; message: string; author: string; date: string }[];
}

export function AllCommitsDiffModal({ isOpen, onClose, projectId, commits }: AllCommitsDiffModalProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(false);
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());
  const [parsedMessage, setParsedMessage] = useState('');
  const abortRef = useRef(false);

  // Cache fetched diffs so navigating back/forth doesn't re-fetch
  const cacheRef = useRef<Map<string, { files: FileDiff[]; message: string }>>(new Map());

  // Reset when modal closes/opens
  useEffect(() => {
    if (!isOpen) {
      setSelectedIdx(null);
      setFiles([]);
      setOpenFiles(new Set());
      setLoading(false);
      cacheRef.current.clear();
    }
  }, [isOpen]);

  const selectCommit = useCallback(async (idx: number) => {
    const commit = commits[idx];
    if (!commit) return;
    setSelectedIdx(idx);
    setOpenFiles(new Set());

    // Check cache first
    const cached = cacheRef.current.get(commit.hash);
    if (cached) {
      setFiles(cached.files);
      setParsedMessage(cached.message);
      setOpenFiles(new Set(cached.files.map((f, i) => `${i}:${f.fileName}`)));
      setLoading(false);
      return;
    }

    setLoading(true);
    setFiles([]);
    try {
      const res = await fetch(`/api/projects/${projectId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'show-commit', hash: commit.hash }),
      });
      if (res.ok) {
        const data = await res.json();
        const parsed = parseCommitShow(data.diff || '');
        cacheRef.current.set(commit.hash, { files: parsed.files, message: parsed.message || commit.message });
        setFiles(parsed.files);
        setParsedMessage(parsed.message || commit.message);
        setOpenFiles(new Set(parsed.files.map((f, i) => `${i}:${f.fileName}`)));
      }
    } catch { /* best effort */ }
    setLoading(false);
  }, [commits, projectId]);

  const handleClose = useCallback(() => {
    abortRef.current = true;
    setSelectedIdx(null);
    setFiles([]);
    setOpenFiles(new Set());
    onClose();
  }, [onClose]);

  const handleBack = useCallback(() => {
    setSelectedIdx(null);
    setFiles([]);
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

  const allExpanded = files.length > 0 && openFiles.size >= files.length;

  const handleExpandCollapseAll = useCallback(() => {
    if (allExpanded) {
      setOpenFiles(new Set());
    } else {
      setOpenFiles(new Set(files.map((f, i) => `${i}:${f.fileName}`)));
    }
  }, [allExpanded, files]);

  const selectedCommit = selectedIdx !== null ? commits[selectedIdx] : null;
  const messageLines = parsedMessage.split('\n');
  const title = messageLines[0];
  const body = messageLines.slice(1).join('\n').replace(/^\n+/, '');

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      showClose={false}
      className="w-[50vw] min-w-[40vw] max-w-[80vw] h-[80vh] flex flex-col resize overflow-auto"
    >
      {selectedIdx === null ? (
        /* ── Commit list view ── */
        <>
          <div className="px-3 border-b border-border-default flex items-center gap-2 shrink-0 h-[48px]">
            <h3 className="flex-1 min-w-0 truncate flex items-center">
              <span className="text-[10px] text-text-tertiary font-semibold uppercase tracking-wide leading-none">
                All Changes
                <span className="ml-1.5 normal-case tracking-normal text-text-placeholder font-normal">
                  ({commits.length} {commits.length === 1 ? 'commit' : 'commits'})
                </span>
              </span>
            </h3>
            <button
              onClick={handleClose}
              className="text-text-chrome hover:text-text-chrome-hover p-1 rounded hover:bg-surface-hover/50"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            {commits.map((commit, idx) => (
              <button
                key={commit.hash}
                onClick={() => selectCommit(idx)}
                className="flex items-center gap-2 px-4 py-2.5 w-full text-left border-b border-border-default hover:bg-surface-hover/40 transition-colors cursor-pointer"
              >
                <GitCommitHorizontalIcon className="w-3.5 h-3.5 text-text-placeholder shrink-0" />
                <code className="text-[10px] font-mono text-text-chrome shrink-0">{commit.hash}</code>
                <span className="text-xs text-text-secondary truncate flex-1 min-w-0">{commit.message.split('\n')[0]}</span>
                <span className="text-[10px] text-text-placeholder shrink-0">{commit.date}</span>
                <ChevronRightIcon className="w-3.5 h-3.5 text-text-placeholder shrink-0" />
              </button>
            ))}
          </div>
        </>
      ) : (
        /* ── Commit detail view (file diffs) ── */
        <>
          <div className="px-3 border-b border-border-default flex items-center gap-2 shrink-0 h-[48px]">
            <button
              onClick={handleBack}
              className="text-text-chrome hover:text-text-chrome-hover p-1 rounded hover:bg-surface-hover/50 shrink-0"
            >
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
            <h3 className="flex-1 min-w-0 truncate flex items-center">
              <span className="text-sm font-semibold">
                <span className="text-[10px] text-text-tertiary font-semibold uppercase tracking-wide leading-none mr-1.5">commit</span>
                <span className="font-mono text-text-chrome leading-none">{selectedCommit?.hash}</span>
              </span>
            </h3>
            <button
              onClick={handleClose}
              className="text-text-chrome hover:text-text-chrome-hover p-1 rounded hover:bg-surface-hover/50"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            {loading && (
              <div className="flex items-center justify-center py-12 text-text-tertiary">
                <Loader2Icon className="w-5 h-5 animate-spin mr-2" />
                <span className="text-xs">Loading diff...</span>
              </div>
            )}
            {!loading && files.length > 0 && (
              <>
                <div className="px-5 py-3 border-b border-border-default space-y-3">
                  <p className="text-sm text-text-primary font-medium">{title}</p>
                  {body && (
                    <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">{body}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <FileStatSummary files={files} />
                    <button
                      onClick={handleExpandCollapseAll}
                      className="text-xs text-text-chrome hover:text-text-chrome-hover px-2 py-1 rounded border border-border-strong/50 shrink-0"
                    >
                      {allExpanded ? 'Collapse All' : 'Expand All'}
                    </button>
                  </div>
                </div>
                {files.map((file, i) => {
                  const key = `${i}:${file.fileName}`;
                  return (
                    <FileDiffAccordion key={key} file={file} isOpen={openFiles.has(key)} onToggle={() => toggleFile(key)} />
                  );
                })}
              </>
            )}
            {!loading && files.length === 0 && (
              <div className="flex items-center justify-center py-12 text-text-tertiary text-xs">
                No file changes
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function FileStatSummary({ files }: { files: FileDiff[] }) {
  if (files.length === 0) return null;
  const counts = { added: 0, modified: 0, deleted: 0, renamed: 0 };
  for (const f of files) counts[f.status]++;
  const parts: { label: string; count: number; color: string }[] = [];
  if (counts.added) parts.push({ label: counts.added === 1 ? 'new file' : 'new files', count: counts.added, color: 'text-green-700 dark:text-green-400' });
  if (counts.modified) parts.push({ label: 'modified', count: counts.modified, color: 'text-text-secondary' });
  if (counts.deleted) parts.push({ label: 'deleted', count: counts.deleted, color: 'text-red-700 dark:text-red-400' });
  if (counts.renamed) parts.push({ label: 'renamed', count: counts.renamed, color: 'text-blue-600 dark:text-blue-400' });
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
