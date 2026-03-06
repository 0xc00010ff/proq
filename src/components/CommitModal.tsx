'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2Icon } from 'lucide-react';
import { Modal } from '@/components/Modal';

interface CommitModalProps {
  isOpen: boolean;
  projectId: string;
  onClose: () => void;
  onCommitted: () => void;
}

export function CommitModal({ isOpen, projectId, onClose, onCommitted }: CommitModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userTouchedTitle, setUserTouchedTitle] = useState(false);
  const [userTouchedDescription, setUserTouchedDescription] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-commit-message' }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('Failed to generate');
      const data = await res.json();
      if (ctrl.signal.aborted) return;
      if (!userTouchedTitle && data.title) setTitle(data.title);
      if (!userTouchedDescription && data.description) setDescription(data.description);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // Silently fail — user can type manually
    } finally {
      if (!ctrl.signal.aborted) setGenerating(false);
    }
  }, [projectId, userTouchedTitle, userTouchedDescription]);

  // Auto-resize title textarea when content changes (e.g. from generation)
  useEffect(() => {
    const el = titleRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
  }, [title]);

  // Start generation when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setUserTouchedTitle(false);
      setUserTouchedDescription(false);
      setError(null);
      setCommitting(false);
      generate();
      setTimeout(() => titleRef.current?.focus(), 300);
    } else {
      abortRef.current?.abort();
    }
    return () => { abortRef.current?.abort(); };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (val) {
      setUserTouchedTitle(true);
      // Stop generation if user types
      abortRef.current?.abort();
      setGenerating(false);
    } else {
      // Backspaced to empty — restart generation
      setUserTouchedTitle(false);
      setUserTouchedDescription(false);
      setDescription('');
      generate();
    }
  };

  const handleDescriptionChange = (val: string) => {
    setDescription(val);
    setUserTouchedDescription(true);
  };

  const handleCommit = async () => {
    if (!title.trim() || committing) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commit', title: title.trim(), description: description.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Commit failed');
      }
      onCommitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit failed');
      setCommitting(false);
    }
  };

  // Cmd+Enter to commit
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.metaKey && title.trim() && !committing) {
        e.preventDefault();
        handleCommit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, title, committing]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="w-full max-w-lg flex flex-col">
      {/* Title */}
      <div className="p-6 pb-0">
        <textarea
          ref={titleRef}
          rows={1}
          value={title}
          onChange={(e) => {
            handleTitleChange(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
              e.preventDefault();
              descriptionRef.current?.focus();
            }
          }}
          className="w-full bg-transparent text-base font-semibold text-text-primary placeholder-text-placeholder focus:outline-none focus-visible:ring-0 pr-8 resize-none overflow-hidden leading-snug"
          placeholder={generating ? 'Generating commit message...' : 'Commit title'}
        />
      </div>

      {/* Description */}
      <div className="px-6 py-4 min-h-[120px] relative">
        {generating && !userTouchedDescription && !description ? (
          <div className="flex items-center justify-center h-[100px]">
            <Loader2Icon className="w-5 h-5 animate-spin text-text-placeholder" />
          </div>
        ) : (
          <textarea
            ref={descriptionRef}
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            className="w-full h-full min-h-[100px] bg-transparent text-sm text-text-secondary placeholder-text-placeholder focus:outline-none focus-visible:ring-0 resize-none leading-relaxed"
            placeholder="Description (optional)"
          />
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-6 pb-2 text-xs text-crimson">{error}</div>
      )}

      {/* Footer */}
      <div className="border-t border-border-default/60 flex items-center justify-end px-4 py-3">
        <button
          onClick={handleCommit}
          disabled={!title.trim() || committing}
          className="btn-primary flex items-center gap-1.5 disabled:opacity-30 disabled:pointer-events-none"
        >
          {committing && <Loader2Icon className="w-3 h-3 animate-spin" />}
          Commit
        </button>
      </div>
    </Modal>
  );
}
