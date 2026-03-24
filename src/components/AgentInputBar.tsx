'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { SquareIcon, SendIcon, PaperclipIcon, XIcon, FileIcon, ChevronDownIcon } from 'lucide-react';
import type { TaskAttachment, TaskMode } from '@/lib/types';
import { uploadFiles, attachmentUrl } from '@/lib/upload';
import { formatSize } from '@/lib/agent-blocks';
import { SmallModal } from '@/components/Modal';

export interface AgentInputBarProps {
  isRunning: boolean;
  value: string;
  onChange: (value: string) => void;
  attachments: TaskAttachment[];
  onAttachmentsChange: (attachments: TaskAttachment[]) => void;
  onSend: () => void;
  onStop: () => void;
  onInterrupt?: () => void;
  mode?: TaskMode;
  onModeChange?: (mode: TaskMode) => void;
  readOnlyMessage?: React.ReactNode;
  maxHeight?: number;
}

export function AgentInputBar({
  isRunning,
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  onSend,
  onStop,
  onInterrupt,
  mode,
  onModeChange,
  readOnlyMessage,
  maxHeight = 160,
}: AgentInputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  // Interrupt confirmation
  const [allowInterrupts, setAllowInterrupts] = useState(false);
  const [showInterruptModal, setShowInterruptModal] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  // Fetch interrupt setting on mount
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => { setAllowInterrupts(!!s.allowAgentInterrupts); })
      .catch(() => {});
  }, []);

  // Close mode menu on outside click
  useEffect(() => {
    if (!showModeMenu) return;
    const handler = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setShowModeMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModeMenu]);

  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = '0';
    const sh = ta.scrollHeight;
    const h = Math.max(36, Math.min(sh, maxHeight));
    ta.style.height = h + 'px';
    ta.style.overflowY = sh > maxHeight ? 'auto' : 'hidden';
  }, [maxHeight]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const uploaded = await uploadFiles(files);
    onAttachmentsChange([...attachments, ...uploaded]);
  }, [attachments, onAttachmentsChange]);

  const removeAttachment = useCallback((id: string) => {
    onAttachmentsChange(attachments.filter((a) => a.id !== id));
  }, [attachments, onAttachmentsChange]);

  const hasContent = value.trim() || attachments.length > 0;

  const handleInterruptAttempt = () => {
    if (!hasContent) return;
    if (!onInterrupt) return;
    if (allowInterrupts) {
      onInterrupt();
    } else {
      setShowInterruptModal(true);
    }
  };

  const confirmInterrupt = () => {
    if (dontAskAgain) {
      setAllowInterrupts(true);
      fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowAgentInterrupts: true }),
      }).catch(() => {});
    }
    setShowInterruptModal(false);
    setDontAskAgain(false);
    onInterrupt?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isRunning) {
        handleInterruptAttempt();
        return;
      }
      onSend();
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  // Resize whenever value changes (handles send clearing, draft restore, etc.)
  useEffect(() => {
    resizeTextarea();
  }, [value, resizeTextarea]);

  if (readOnlyMessage) {
    return (
      <div className="shrink-0 px-3 py-2.5">
        {readOnlyMessage}
      </div>
    );
  }

  return (
    <>
      <div
        className="shrink-0 px-3 py-2.5 relative"
        onDrop={handleDrop}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* Drop overlay */}
        {isDragOver && (
          <div className="absolute inset-0 bg-bronze-600/20 dark:bg-bronze-600/15 border-2 border-bronze-600/50 flex items-center justify-center pointer-events-none z-20 rounded-md m-1">
            <div className="text-sm text-text-secondary font-medium bg-bronze-400 dark:bg-bronze-800 border border-bronze-500 dark:border-bronze-700 px-4 py-2 rounded-md shadow-sm">Drop files here</div>
          </div>
        )}

        <div className="rounded-xl border border-border-strong/40 focus-within:border-border-strong bg-surface-topbar transition-colors">
          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {attachments.map((att) => {
                const url = att.filePath ? attachmentUrl(att.filePath) : undefined;
                const isImage = att.type?.startsWith('image/') && url;
                return isImage ? (
                  <div
                    key={att.id}
                    className="relative group rounded-lg overflow-hidden border border-border-strong/50 bg-surface-hover/60"
                  >
                    <img
                      src={url}
                      alt={att.name}
                      className="h-16 w-auto max-w-[100px] object-cover block cursor-pointer"
                      onClick={() => window.open(url, '_blank')}
                    />
                    <button
                      onClick={() => removeAttachment(att.id)}
                      className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white/80 hover:text-crimson opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    >
                      <XIcon className="w-2.5 h-2.5" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1 py-0.5">
                      <span className="text-[9px] text-text-secondary truncate block">{att.name}</span>
                    </div>
                  </div>
                ) : (
                  <div
                    key={att.id}
                    className="flex items-center gap-1.5 bg-surface-hover/60 border border-border-strong/50 rounded-lg px-2.5 py-2 group"
                  >
                    <FileIcon className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] text-text-secondary truncate max-w-[120px] leading-tight">{att.name}</span>
                      <span className="text-[9px] text-text-placeholder leading-tight">{formatSize(att.size)}</span>
                    </div>
                    <button
                      onClick={() => removeAttachment(att.id)}
                      className="text-text-placeholder hover:text-crimson ml-0.5 opacity-0 group-hover:opacity-100"
                    >
                      <XIcon className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            rows={1}
            style={{ height: '36px', maxHeight: `${maxHeight}px` }}
            className="w-full min-h-[36px] resize-none overflow-hidden bg-transparent px-3 pt-3 pb-2 text-sm leading-[20px] text-text-secondary placeholder:text-text-placeholder focus:outline-none"
          />

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-1.5 pb-1.5">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-chrome-hover hover:bg-surface-hover"
                title="Attach file"
              >
                <PaperclipIcon className="w-3.5 h-3.5" />
              </button>

              {/* Mode switcher (only when mode/onModeChange provided) */}
              {mode !== undefined && onModeChange && (
                <div className="relative" ref={modeMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowModeMenu((v) => !v)}
                    className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11px] font-medium text-text-tertiary hover:text-text-chrome-hover hover:bg-surface-hover"
                    title="Agent mode"
                  >
                    <span className="capitalize">{mode}</span>
                    <ChevronDownIcon className="w-3 h-3" />
                  </button>
                  {showModeMenu && (
                    <div className="absolute bottom-full left-0 mb-1 py-1 rounded-lg border border-border-strong bg-surface-detail shadow-lg z-30 min-w-[160px]">
                      {(['auto', 'plan', 'build', 'answer'] as TaskMode[]).map((m) => (
                        <button
                          key={m}
                          onClick={() => {
                            onModeChange(m);
                            setShowModeMenu(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover ${m === mode ? 'text-text-primary font-medium' : 'text-text-secondary'}`}
                        >
                          <span className="capitalize">{m}</span>
                          <span className="text-text-placeholder ml-1.5">
                            {m === 'auto' && '— default'}
                            {m === 'plan' && '— plan first'}
                            {m === 'build' && '— code only'}
                            {m === 'answer' && '— research'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {isRunning ? (
              <div className="flex items-center gap-1">
                {hasContent && onInterrupt && (
                  <button
                    onClick={handleInterruptAttempt}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-chrome bg-bronze-400/30 dark:bg-surface-hover"
                    title="Send (interrupts agent)"
                  >
                    <SendIcon className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={onStop}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/10 hover:bg-red-500/20"
                  title="Stop agent"
                >
                  <SquareIcon className="w-3.5 h-3.5 text-red-400 fill-red-400" />
                </button>
              </div>
            ) : (
              <button
                onClick={onSend}
                disabled={!hasContent}
                className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg ${hasContent ? 'text-text-chrome bg-bronze-400/30 dark:bg-surface-hover' : 'text-text-tertiary disabled:opacity-30'}`}
                title="Send message"
              >
                <SendIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              addFiles(e.target.files);
              e.target.value = '';
            }
          }}
        />
      </div>

      {/* Interrupt confirmation modal */}
      {onInterrupt && (
        <SmallModal
          isOpen={showInterruptModal}
          onClose={() => { setShowInterruptModal(false); setDontAskAgain(false); }}
          onPrimary={confirmInterrupt}
          title="Send while agent is thinking"
          className="max-w-sm"
          actions={<>
            <button onClick={() => { setShowInterruptModal(false); setDontAskAgain(false); }} className="btn-secondary">Cancel</button>
            <button onClick={confirmInterrupt} className="btn-primary">Send</button>
          </>}
        >
          <p className="text-xs text-text-tertiary mb-4">
            This will stop the current run and restart with your message. The agent keeps its full conversation history.
          </p>
          <label className="flex items-center gap-2 text-xs text-text-secondary mb-5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
              className="rounded border-border-strong"
            />
            Don&apos;t ask again
          </label>
        </SmallModal>
      )}
    </>
  );
}
