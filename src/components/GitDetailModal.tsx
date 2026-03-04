'use client';

import React, { useState, useCallback } from 'react';
import { ArrowLeftIcon, Loader2Icon } from 'lucide-react';
import { Modal } from '@/components/Modal';

interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

type GitDetailModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
} & (
  | { type: 'diff'; content: string; commits?: never; projectId?: never }
  | { type: 'log'; commits: CommitInfo[]; projectId: string; content?: never }
);

function colorDiffLine(line: string): string | null {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-green-400';
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-red-400';
  if (line.startsWith('@@')) return 'text-blue-400';
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) return 'text-zinc-500';
  return null;
}

function DiffView({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words">
      {lines.map((line, i) => {
        const color = colorDiffLine(line);
        return (
          <div key={i} className={color || 'text-zinc-400'}>
            {line || '\u00A0'}
          </div>
        );
      })}
    </pre>
  );
}

function CommitListView({ commits, onSelectCommit }: { commits: CommitInfo[]; onSelectCommit: (hash: string) => void }) {
  return (
    <div className="divide-y divide-zinc-800/50">
      {commits.map((c) => (
        <button
          key={c.hash}
          onClick={() => onSelectCommit(c.hash)}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-800/40 transition-colors group"
        >
          <span className="font-mono text-xs text-bronze-500 shrink-0">{c.hash}</span>
          <span className="text-xs text-zinc-200 truncate flex-1">{c.message}</span>
          <span className="text-[10px] text-zinc-500 shrink-0 hidden sm:block">{c.author}</span>
          <span className="text-[10px] text-zinc-600 shrink-0">{c.date}</span>
        </button>
      ))}
    </div>
  );
}

export function GitDetailModal(props: GitDetailModalProps) {
  const { isOpen, onClose, title, type } = props;

  const [selectedCommit, setSelectedCommit] = useState<{ hash: string; diff: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSelectCommit = useCallback(async (hash: string) => {
    if (type !== 'log' || !props.projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${props.projectId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'show-commit', hash }),
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedCommit({ hash, diff: data.diff || 'No diff available.' });
      }
    } catch { /* best effort */ }
    setLoading(false);
  }, [type, props]);

  const handleClose = useCallback(() => {
    setSelectedCommit(null);
    setLoading(false);
    onClose();
  }, [onClose]);

  const handleBack = useCallback(() => {
    setSelectedCommit(null);
  }, []);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      className="w-[60vw] min-w-[50vw] max-w-[80vw] min-h-[50vh] max-h-[80vh] flex flex-col resize overflow-auto"
    >
      <div className="px-5 pt-4 pb-3 border-b border-zinc-800 flex items-center gap-3 shrink-0">
        {type === 'log' && selectedCommit && (
          <button
            onClick={handleBack}
            className="text-zinc-400 hover:text-zinc-200 transition-colors p-0.5 -ml-1"
          >
            <ArrowLeftIcon className="w-4 h-4" />
          </button>
        )}
        <h3 className="text-sm font-semibold text-zinc-100">
          {type === 'log' && selectedCommit
            ? <><span className="font-mono text-bronze-500">{selectedCommit.hash}</span></>
            : title
          }
        </h3>
      </div>
      <div className="flex-1 overflow-auto p-4 min-h-0">
        {type === 'diff' && (
          <DiffView content={props.content} />
        )}
        {type === 'log' && !selectedCommit && !loading && (
          <CommitListView commits={props.commits} onSelectCommit={handleSelectCommit} />
        )}
        {type === 'log' && loading && (
          <div className="flex items-center justify-center py-12 text-zinc-500">
            <Loader2Icon className="w-5 h-5 animate-spin mr-2" />
            <span className="text-xs">Loading diff...</span>
          </div>
        )}
        {type === 'log' && selectedCommit && !loading && (
          <DiffView content={selectedCommit.diff} />
        )}
      </div>
    </Modal>
  );
}
