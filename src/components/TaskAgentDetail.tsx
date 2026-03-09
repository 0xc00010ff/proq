'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { parseLines } from '@/lib/utils';
import {
  AlertTriangleIcon,
  Loader2Icon,
  FileTextIcon,
  FileIcon,
  ClipboardListIcon,
  ClipboardCopyIcon,
  CheckIcon,
  CheckCircle2Icon,
  ClockIcon,
  PlayIcon,
  GitBranchIcon,
  ArrowRightIcon,
} from 'lucide-react';
import type { Task, FollowUpDraft } from '@/lib/types';
import { attachmentUrl } from '@/lib/upload';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { TerminalPane } from './TerminalPane';
import { StructuredPane } from './StructuredPane';
import { ConflictModal } from './ConflictModal';

interface TaskAgentDetailProps {
  task: Task;
  projectId: string;
  isQueued?: boolean;
  cleanupExpiresAt?: number;
  followUpDraft?: FollowUpDraft;
  onFollowUpDraftChange?: (draft: FollowUpDraft | null) => void;
  onComplete?: (taskId: string) => void | Promise<void>;
  onResumeEditing?: (taskId: string) => void;
  onUpdateTitle?: (taskId: string, title: string) => void;
  parallelMode?: boolean;
  currentBranch?: string;
  onSwitchBranch?: (branch: string) => void;
  defaultBranch?: string;
  className?: string;
}

export function TaskAgentDetail({ task, projectId, isQueued, cleanupExpiresAt, followUpDraft, onFollowUpDraftChange, onComplete, onResumeEditing, onUpdateTitle, parallelMode, currentBranch, onSwitchBranch, defaultBranch = 'main', className }: TaskAgentDetailProps) {
  const shortId = task.id.slice(0, 8);
  const terminalTabId = `task-${shortId}`;
  const steps = parseLines(task.humanSteps);
  const summaryLines = parseLines(task.summary);
  const isDispatched = task.agentStatus === 'running' || task.agentStatus === 'starting';
  const isStructured = task.renderMode !== 'cli';
  const showStructuredPane = isStructured && !isQueued && (task.status === 'in-progress' || task.status === 'verify' || task.status === 'done');
  const showStructuredStatic = isStructured && task.status === 'done' && !!task.agentBlocks;
  const showStaticLog = !isStructured && task.status === 'done' && !cleanupExpiresAt && !!task.agentLog;
  const showTerminal = !isStructured && (task.status === 'in-progress' || task.status === 'verify' || (task.status === 'done' && !showStaticLog)) && !isQueued;
  const [countdownText, setCountdownText] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [merging, setMerging] = useState(false);
  const canEditTitle = !!onUpdateTitle;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [topPanelPercent, setTopPanelPercent] = useState(30);
  const [rightPanelPercent, setRightPanelPercent] = useState(33);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const bottomPanelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const finishDrag = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const panel = rightPanelRef.current;
    if (!panel) return;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current || !panel) return;
      const rect = panel.getBoundingClientRect();
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      setTopPanelPercent(Math.min(Math.max(pct, 15), 85));
    };
    const onMouseUp = () => {
      finishDrag();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [finishDrag]);

  const handleHorizontalResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const container = containerRef.current;
    if (!container) return;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current || !container) return;
      const rect = container.getBoundingClientRect();
      const pct = ((rect.right - ev.clientX) / rect.width) * 100;
      setRightPanelPercent(Math.min(Math.max(pct, 20), 60));
    };
    const onMouseUp = () => {
      finishDrag();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [finishDrag]);

  const handleCrossResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const container = containerRef.current;
    const panel = rightPanelRef.current;
    if (!container || !panel) return;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const containerRect = container.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const rightPct = ((containerRect.right - ev.clientX) / containerRect.width) * 100;
      setRightPanelPercent(Math.min(Math.max(rightPct, 20), 60));
      const topPct = ((ev.clientY - panelRect.top) / panelRect.height) * 100;
      setTopPanelPercent(Math.min(Math.max(topPct, 15), 85));
    };
    const onMouseUp = () => {
      finishDrag();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'move';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [finishDrag]);

  // Scroll agent summary to bottom on first load
  useEffect(() => {
    if (bottomPanelRef.current) {
      bottomPanelRef.current.scrollTop = bottomPanelRef.current.scrollHeight;
    }
  }, []);

  // Countdown timer for cleanup
  useEffect(() => {
    if (!cleanupExpiresAt) {
      setCountdownText('');
      return;
    }
    const update = () => {
      const remaining = Math.max(0, cleanupExpiresAt - Date.now());
      const minutes = Math.ceil(remaining / 60_000);
      setCountdownText(remaining > 0 ? `Session will be cleared in ${minutes}m` : 'Session ended');
    };
    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, [cleanupExpiresAt]);

  // Load xterm CSS
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

  // Sync contentEditable text when task.title changes externally (only if not focused)
  useEffect(() => {
    if (titleRef.current && document.activeElement !== titleRef.current) {
      titleRef.current.textContent = task.title || 'Untitled task';
    }
  }, [task.title]);

  const commitTitle = () => {
    const trimmed = (titleRef.current?.textContent || '').trim();
    if (trimmed && trimmed !== task.title) {
      onUpdateTitle?.(task.id, trimmed);
    }
  };

  return (
    <div ref={containerRef} className={`flex flex-row h-full w-full overflow-hidden ${className || ''}`}>
      {/* Left panel: terminal or queued state */}
      <div className={`flex-1 min-h-0 flex flex-col${showStructuredPane ? ' bg-surface-deep' : ''}`}>
        {/* Worktree status — only in parallel mode */}
        {parallelMode && (
          <div className="shrink-0 h-10 flex items-center gap-2 px-3 border-b border-border-default bg-surface-topbar">
            {task.status === 'verify' && task.branch && onSwitchBranch && currentBranch === task.branch ? (
              <>
                <span className="text-xs text-lazuli font-medium">viewing</span>
                {task.baseBranch && task.baseBranch !== defaultBranch && (
                  <>
                    <span className="inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded border border-border-hover/40 bg-surface-hover/60 text-text-tertiary">
                      <GitBranchIcon className="w-3 h-3" />
                      {task.baseBranch}
                    </span>
                    <ArrowRightIcon className="w-3 h-3 text-text-placeholder shrink-0" />
                  </>
                )}
                <span className="inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded border border-lazuli/30 bg-lazuli/10 text-lazuli">
                  <GitBranchIcon className="w-3 h-3" />
                  {task.branch}
                </span>
                <button
                  onClick={() => onSwitchBranch(task.baseBranch || defaultBranch)}
                  className="text-[10px] font-medium text-text-chrome hover:text-text-chrome-hover px-1.5 py-0.5 rounded border border-border-default hover:bg-surface-hover"
                >
                  Back to {task.baseBranch || defaultBranch}
                </button>
              </>
            ) : (
              <>
                {task.baseBranch && task.baseBranch !== defaultBranch && (
                  <>
                    <span className="inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded border border-border-hover/40 bg-surface-hover/60 text-text-tertiary">
                      <GitBranchIcon className="w-3 h-3" />
                      {task.baseBranch}
                    </span>
                    <ArrowRightIcon className="w-3 h-3 text-text-placeholder shrink-0" />
                  </>
                )}
                <span className={`inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded border ${
                  task.mergeConflict
                    ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
                    : 'border-border-hover/40 bg-surface-hover/60 text-text-chrome'
                }`}>
                  <GitBranchIcon className="w-3 h-3" />
                  {task.mergeConflict ? task.mergeConflict.branch : (task.branch || defaultBranch)}
                </span>
                {task.status === 'verify' && task.branch && onSwitchBranch && (
                  <button
                    onClick={() => onSwitchBranch(task.branch!)}
                    className="text-[10px] font-medium text-lazuli hover:text-lazuli/80 px-1.5 py-0.5 rounded border border-lazuli/30 hover:bg-lazuli/10"
                  >
                    Preview
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {isQueued ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
            <ClockIcon className="w-8 h-8 text-text-placeholder" />
            <div>
              <p className="text-sm font-medium text-text-secondary">Queued</p>
              <p className="text-xs text-text-placeholder mt-1">
                Waiting for the current task to finish before starting.
              </p>
            </div>
            <button
              onClick={async () => {
                setDispatching(true);
                try {
                  await fetch(`/api/projects/${projectId}/tasks/${task.id}/dispatch`, { method: 'POST' });
                } catch {
                  setDispatching(false);
                }
              }}
              disabled={dispatching}
              className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
            >
              {dispatching ? (
                <Loader2Icon className="w-3 h-3 animate-spin" />
              ) : (
                <PlayIcon className="w-3 h-3" />
              )}
              Start Now
            </button>
          </div>
        ) : showStructuredPane ? (
          <StructuredPane
            taskId={task.id}
            projectId={projectId}
            visible={true}
            taskStatus={task.status}
            agentBlocks={showStructuredStatic ? task.agentBlocks : undefined}
            followUpDraft={followUpDraft}
            onFollowUpDraftChange={onFollowUpDraftChange}
            onTaskStatusChange={(status) => {
              if (status === 'verify' && onResumeEditing) onResumeEditing(task.id);
            }}
          />
        ) : showTerminal ? (
          <div className="flex-1 relative min-h-0 flex flex-col">
            <div className="flex-1 min-h-0">
              <TerminalPane tabId={terminalTabId} visible={true} enableDrop />
            </div>
            {countdownText && (
              <div className="shrink-0 px-3 py-1.5 text-[11px] text-zinc-600 font-mono border-t border-zinc-800 bg-[#0a0a0a]">
                {countdownText}
              </div>
            )}
          </div>
        ) : showStaticLog ? (
          <div className="flex-1 relative min-h-0 flex flex-col bg-black">
            <pre className="flex-1 min-h-0 overflow-y-auto p-4 text-[12px] font-mono text-zinc-400 whitespace-pre-wrap leading-relaxed">
              {task.agentLog}
            </pre>
            <div className="shrink-0 px-3 py-1.5 text-[11px] text-zinc-600 font-mono border-t border-zinc-800">
              Session ended
            </div>
          </div>
        ) : null}
      </div>

      {/* Horizontal resize handle */}
      {(showTerminal || showStructuredPane || isQueued) && (
        <div
          onMouseDown={handleHorizontalResizeMouseDown}
          className="shrink-0 w-px cursor-col-resize bg-border-default hover:bg-border-hover transition-colors relative"
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>
      )}

      {/* Right panel: task details */}
      <div ref={rightPanelRef} className={`${showTerminal || showStructuredPane || isQueued ? '' : 'w-full'} shrink-0 flex flex-col overflow-hidden bg-surface-topbar`} style={(showTerminal || showStructuredPane || isQueued) ? { width: `${rightPanelPercent}%` } : undefined}>
        {/* Top half: title, status, description */}
        <div className="overflow-y-auto p-5 pt-5 space-y-4 shrink-0" style={{ height: `${topPanelPercent}%` }}>
          {/* Status badge */}
          <div className="flex items-center gap-1.5">
            {isQueued ? (
              <span className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium uppercase tracking-wide">
                <ClockIcon className="w-3 h-3" />
                Queued
              </span>
            ) : isDispatched ? (
              <span className="flex items-center gap-1.5 text-xs text-bronze-500 font-medium uppercase tracking-wide">
                <Loader2Icon className="w-3 h-3 animate-spin" />
                Agent working
              </span>
            ) : task.status === 'verify' ? (
              <span className="flex items-center gap-1.5 text-xs text-lazuli-dark dark:text-lazuli font-medium uppercase tracking-wide">
                <ClockIcon className="w-3 h-3" />
                Awaiting review
              </span>
            ) : task.status === 'done' ? (
              <span className="flex items-center gap-1.5 text-xs text-emerald-dark dark:text-emerald font-medium uppercase tracking-wide">
                <CheckCircle2Icon className="w-3 h-3" />
                Completed
              </span>
            ) : (
              <span className="text-xs text-text-tertiary font-medium uppercase tracking-wide">
                {task.status}
              </span>
            )}
            <span className="ml-auto text-[10px] text-text-placeholder font-mono">{shortId}</span>
          </div>

          {/* Title */}
          <h2
            ref={titleRef}
            contentEditable={canEditTitle}
            suppressContentEditableWarning
            onBlur={canEditTitle ? commitTitle : undefined}
            onKeyDown={canEditTitle ? (e) => {
              if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); }
            } : undefined}
            className={`relative text-base font-semibold text-text-primary leading-snug outline-none ${canEditTitle ? 'cursor-text after:absolute after:left-0 after:right-0 after:bottom-[-3px] after:h-px after:bg-transparent focus:after:bg-bronze-500/40' : ''}`}
          >
            {task.title || 'Untitled task'}
          </h2>

          {/* Description */}
          {task.description && (
            <div className="text-sm leading-relaxed text-text-secondary">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold text-text-secondary">{children}</strong>,
                  em: ({ children }) => <em className="text-text-tertiary">{children}</em>,
                  code: ({ children, className: cn }) => {
                    const isBlock = cn?.includes('language-');
                    if (isBlock) {
                      return <code className={`${cn} block bg-surface-base rounded px-3 py-2 text-xs font-mono text-text-secondary overflow-x-auto my-2`}>{children}</code>;
                    }
                    return <code className="bg-border-default/70 text-text-secondary rounded px-1 py-0.5 text-xs font-mono">{children}</code>;
                  },
                  pre: ({ children }) => <pre className="bg-surface-base rounded-md overflow-x-auto my-2">{children}</pre>,
                  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                  li: ({ children }) => <li>{children}</li>,
                  a: ({ href, children }) => <a href={href} className="text-lazuli hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                  h1: ({ children }) => <h1 className="text-sm font-semibold text-text-secondary mt-3 mb-1.5 first:mt-0">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-sm font-semibold text-text-secondary mt-2.5 mb-1 first:mt-0">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-xs font-semibold text-text-secondary mt-2 mb-1 first:mt-0">{children}</h3>,
                }}
              >
                {task.description}
              </ReactMarkdown>
            </div>
          )}

          {/* Attachments */}
          {task.attachments && task.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {task.attachments.map((att) => {
                const url = att.filePath ? attachmentUrl(att.filePath) : undefined;
                const isImage = att.type?.startsWith('image/') || false;
                return isImage && url ? (
                  <div
                    key={att.id}
                    className="relative group rounded-md overflow-hidden border border-border-default/50 bg-surface-hover/60 cursor-pointer"
                    onClick={() => window.open(url, '_blank')}
                  >
                    <img
                      src={url}
                      alt={att.name}
                      className="h-20 w-auto max-w-[120px] object-cover block"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[10px] text-zinc-300 truncate block">
                        {att.name}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    key={att.id}
                    className="flex items-center gap-2 bg-surface-hover/60 border border-border-default/50 rounded-md px-3 py-2.5"
                  >
                    <FileIcon className="w-4 h-4 text-zinc-500 shrink-0" />
                    <span className="text-[11px] text-text-secondary truncate max-w-[140px]">
                      {att.name}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

        </div>

        {/* Resize handle */}
        <div
          onMouseDown={handleResizeMouseDown}
          className="shrink-0 h-px cursor-row-resize bg-border-default hover:bg-border-hover transition-colors relative"
        >
          <div className="absolute inset-x-0 -top-1.5 -bottom-1.5" />
          {/* Cross-resize at intersection with vertical divider */}
          {(showTerminal || showStructuredPane || isQueued) && (
            <div
              onMouseDown={(e) => { e.stopPropagation(); handleCrossResizeMouseDown(e); }}
              className="absolute -left-3 -top-3 w-6 h-6 cursor-move z-10"
            />
          )}
        </div>

        {/* Bottom half: agent summary */}
        <div ref={bottomPanelRef} className={`flex-1 min-h-0 overflow-y-auto ${isDispatched && !isQueued && summaryLines.length === 0 ? 'flex flex-col items-center justify-center p-5' : 'p-5 space-y-4'}`}>
          {summaryLines.length > 0 || !isDispatched || isQueued ? (
            <div className="flex items-center gap-2">
              <ClipboardListIcon className="w-3.5 h-3.5 text-text-tertiary" />
              <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">
                Agent Summary
              </span>
              {summaryLines.length > 0 && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(task.summary || '');
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="ml-auto text-text-chrome hover:text-text-chrome-hover p-0.5"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <CheckIcon className="w-3.5 h-3.5 text-emerald" />
                  ) : (
                    <ClipboardCopyIcon className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
          ) : null}

          {summaryLines.length > 0 ? (
            <div className="text-sm leading-relaxed text-text-secondary">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold text-text-secondary">{children}</strong>,
                  em: ({ children }) => <em className="text-text-tertiary">{children}</em>,
                  code: ({ children, className: cn }) => {
                    const isBlock = cn?.includes('language-');
                    if (isBlock) {
                      return <code className={`${cn} block bg-surface-base rounded px-3 py-2 text-xs font-mono text-text-secondary overflow-x-auto my-2`}>{children}</code>;
                    }
                    return <code className="bg-border-default/70 text-text-secondary rounded px-1 py-0.5 text-xs font-mono">{children}</code>;
                  },
                  pre: ({ children }) => <pre className="bg-surface-base rounded-md overflow-x-auto my-2">{children}</pre>,
                  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                  li: ({ children }) => <li>{children}</li>,
                  a: ({ href, children }) => <a href={href} className="text-lazuli hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                  h1: ({ children }) => <h1 className="text-sm font-semibold text-text-secondary mt-3 mb-1.5 first:mt-0">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-sm font-semibold text-text-secondary mt-2.5 mb-1 first:mt-0">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-xs font-semibold text-text-secondary mt-2 mb-1 first:mt-0">{children}</h3>,
                }}
              >
                {task.summary || ''}
              </ReactMarkdown>
            </div>
          ) : isDispatched && !isQueued ? (
            <div className="flex flex-col items-center justify-center gap-3">
              <Loader2Icon className="w-5 h-5 text-bronze-500 animate-spin" />
              <span className="text-xs text-bronze-500 font-medium uppercase tracking-wide">
                Agent working
              </span>
              <p className="text-xs text-text-placeholder italic text-center mt-1">
                Agent is still working. Summary will appear here when complete.
              </p>
            </div>
          ) : isQueued ? (
            <p className="text-xs text-text-placeholder italic">
              Task is queued. Summary will appear here once the agent starts working.
            </p>
          ) : (
            <p className="text-xs text-text-placeholder italic">
              No summary yet.
            </p>
          )}

          {task.agentLog && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileTextIcon className="w-3.5 h-3.5 text-text-placeholder" />
                <span className="text-[10px] font-medium text-text-placeholder uppercase tracking-wide">
                  Log
                </span>
              </div>
              <pre className="text-[11px] text-text-tertiary font-mono bg-surface-base border border-border-default rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                {task.agentLog}
              </pre>
            </div>
          )}

          {/* Merge conflict banner */}
          {task.mergeConflict && (
            <div className="bg-red-500/8 border border-red-500/20 rounded-md p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangleIcon className="w-3.5 h-3.5 text-red-400" />
                <span className="text-xs font-medium text-red-400 uppercase tracking-wide">
                  Merge conflict
                </span>
                <span className="text-xs font-mono text-red-400/70">
                  {task.mergeConflict.branch}
                </span>
              </div>
              {task.mergeConflict.files.length > 0 && (
                <ul className="space-y-0.5 mb-2">
                  {task.mergeConflict.files.map((file) => (
                    <li key={file} className="text-xs font-mono text-text-secondary flex items-start">
                      <span className="mr-2 text-red-400 shrink-0">-</span>
                      <span>{file}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={() => setShowConflictModal(true)}
                className="text-[11px] font-medium text-red-400 hover:text-red-300"
              >
                View Details
              </button>
            </div>
          )}

          {/* Human steps banner */}
          {steps.length > 0 && (
            <div className="bg-gold/8 border border-gold/20 rounded-md p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangleIcon className="w-3.5 h-3.5 text-gold" />
                <span className="text-xs font-medium text-gold uppercase tracking-wide">
                  Steps for you
                </span>
              </div>
              <ul className="space-y-1">
                {steps.map((step, idx) => (
                  <li key={idx} className="text-xs text-text-secondary flex items-start">
                    <span className="mr-2 text-text-placeholder">&bull;</span>
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Complete button pinned to bottom */}
        {task.status === 'verify' && onComplete && (
          <div className="shrink-0 group/complete">
            <div className={`h-px ${merging ? 'bg-emerald/30' : 'bg-border-default group-hover/complete:bg-emerald/40'}`} />
            <button
              onClick={async () => {
                setMerging(true);
                try {
                  await onComplete(task.id);
                } finally {
                  setMerging(false);
                }
              }}
              disabled={merging}
              className="flex items-center justify-center gap-1.5 w-full px-3 py-5 text-xs font-medium text-emerald/80 hover:text-emerald hover:bg-emerald/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {merging ? (
                <Loader2Icon className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2Icon className="w-3.5 h-3.5" />
              )}
              {merging ? 'Merging...' : (task.branch ? 'Merge & Complete' : 'Complete')}
            </button>
          </div>
        )}
      </div>

      {showConflictModal && task.mergeConflict && (
        <ConflictModal
          branch={task.mergeConflict.branch}
          baseBranch={task.baseBranch || defaultBranch}
          files={task.mergeConflict.files}
          diff={task.mergeConflict.diff}
          onResolve={async () => {
            setShowConflictModal(false);
            const res = await fetch(`/api/projects/${projectId}/tasks/${task.id}/resolve`, {
              method: 'POST',
            });
            if (res.ok) {
              const data = await res.json();
              if (data.prompt && onFollowUpDraftChange) {
                onFollowUpDraftChange({ text: data.prompt, attachments: [] });
              }
            }
          }}
          onDismiss={() => setShowConflictModal(false)}
        />
      )}
    </div>
  );
}
