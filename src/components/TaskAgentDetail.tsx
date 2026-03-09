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
  GitCommitHorizontalIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  ListChecksIcon,
} from 'lucide-react';
import type { Task, FollowUpDraft } from '@/lib/types';
import { attachmentUrl } from '@/lib/upload';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { TerminalPane } from './TerminalPane';
import { StructuredPane } from './StructuredPane';
import { ConflictModal } from './ConflictModal';
import { CommitDiffModal } from './CommitDiffModal';

// ── Shared markdown components ──────────────────────────
const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-text-secondary">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="text-text-tertiary">{children}</em>,
  code: ({ children, className: cn }: { children?: React.ReactNode; className?: string }) => {
    const isBlock = cn?.includes('language-');
    if (isBlock) {
      return <code className={`${cn} block bg-surface-base rounded px-3 py-2 text-xs font-mono text-text-secondary overflow-x-auto my-2`}>{children}</code>;
    }
    return <code className="bg-border-default/70 text-text-secondary rounded px-1 py-0.5 text-xs font-mono">{children}</code>;
  },
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="bg-surface-base rounded-md overflow-x-auto my-2">{children}</pre>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => <a href={href} className="text-lazuli hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-sm font-semibold text-text-secondary mt-3 mb-1.5 first:mt-0">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-sm font-semibold text-text-secondary mt-2.5 mb-1 first:mt-0">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-xs font-semibold text-text-secondary mt-2 mb-1 first:mt-0">{children}</h3>,
};

// ── Accordion section ───────────────────────────────────
function AccordionSection({
  icon,
  title,
  defaultOpen = false,
  open: controlledOpen,
  storageKey,
  rightContent,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  defaultOpen?: boolean;
  open?: boolean;
  storageKey?: string;
  rightContent?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(() => {
    if (storageKey) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored !== null) return stored === '1';
      } catch {}
    }
    return defaultOpen;
  });
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  const toggle = useCallback(() => {
    setInternalOpen((v) => {
      const next = !v;
      if (storageKey) {
        try { localStorage.setItem(storageKey, next ? '1' : '0'); } catch {}
      }
      return next;
    });
  }, [storageKey]);

  return (
    <div className="border-b border-border-default last:border-b-0">
      <button
        onClick={toggle}
        className="flex items-center gap-2 w-full px-4 py-3.5 text-left hover:bg-surface-hover/50 transition-colors"
      >
        <ChevronRightIcon className={`w-3 h-3 text-text-placeholder shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`} />
        {icon}
        <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">{title}</span>
        {rightContent && (
          <span className="ml-auto flex items-center" onClick={(e) => e.stopPropagation()}>
            {rightContent}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="px-4 pb-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Commit info type ────────────────────────────────────
interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

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
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [selectedCommitMessage, setSelectedCommitMessage] = useState<string | undefined>(undefined);
  const canEditTitle = !!onUpdateTitle;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [rightPanelPercent, setRightPanelPercent] = useState(33);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const finishDrag = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

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

  // Fetch commits for this task
  useEffect(() => {
    if (task.status === 'todo') return;
    if (!task.branch && !task.startCommit) return;

    const fetchCommits = () => {
      fetch(`/api/projects/${projectId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'task-commits', taskId: task.id }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.commits) setCommits(data.commits);
        })
        .catch(() => {});
    };

    fetchCommits();

    // Poll while agent is running to pick up new commits
    if (isDispatched) {
      const interval = setInterval(fetchCommits, 15_000);
      return () => clearInterval(interval);
    }
  }, [projectId, task.id, task.status, task.branch, task.startCommit, isDispatched]);

  const commitTitle = () => {
    const trimmed = (titleRef.current?.textContent || '').trim();
    if (trimmed && trimmed !== task.title) {
      onUpdateTitle?.(task.id, trimmed);
    }
  };

  const hasLeftPanel = showTerminal || showStructuredPane || isQueued;

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
      {hasLeftPanel && (
        <div
          onMouseDown={handleHorizontalResizeMouseDown}
          className="shrink-0 w-px cursor-col-resize bg-border-default hover:bg-border-hover transition-colors relative"
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>
      )}

      {/* Right panel: task details */}
      <div className={`${hasLeftPanel ? '' : 'w-full'} shrink-0 flex flex-col overflow-hidden bg-surface-topbar`} style={hasLeftPanel ? { width: `${rightPanelPercent}%` } : undefined}>
        {/* Fixed nav bar — status + task ID */}
        <div className="shrink-0 h-10 flex items-center gap-1.5 px-4 border-b border-border-default">
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

        {/* Scrollable accordion area */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Initial Task */}
          <AccordionSection
            icon={<FileTextIcon className="w-3.5 h-3.5 text-text-tertiary" />}
            title="Initial Task"
            defaultOpen={true}
            storageKey={`task-accordion:${task.id}:task`}
          >
            {/* Title */}
            <h2
              ref={titleRef}
              contentEditable={canEditTitle}
              suppressContentEditableWarning
              onBlur={canEditTitle ? commitTitle : undefined}
              onKeyDown={canEditTitle ? (e) => {
                if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); }
              } : undefined}
              className={`relative text-base font-semibold text-text-primary leading-snug outline-none mb-2 ${canEditTitle ? 'cursor-text after:absolute after:left-0 after:right-0 after:bottom-[-3px] after:h-px after:bg-transparent focus:after:bg-bronze-500/40' : ''}`}
            >
              {task.title || 'Untitled task'}
            </h2>

            {task.description && (
              <div className="text-sm leading-relaxed text-text-secondary">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {task.description}
                </ReactMarkdown>
              </div>
            )}

            {/* Attachments */}
            {task.attachments && task.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
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
          </AccordionSection>

          {/* Agent Summary */}
          <AccordionSection
            icon={<ClipboardListIcon className="w-3.5 h-3.5 text-text-tertiary" />}
            title="Agent Summary"
            defaultOpen={true}
            storageKey={`task-accordion:${task.id}:summary`}
            rightContent={
              summaryLines.length > 0 ? (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(task.summary || '');
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="text-text-chrome hover:text-text-chrome-hover p-0.5"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <CheckIcon className="w-3.5 h-3.5 text-emerald" />
                  ) : (
                    <ClipboardCopyIcon className="w-3.5 h-3.5" />
                  )}
                </button>
              ) : undefined
            }
          >
            {summaryLines.length > 0 ? (
              <div className="text-sm leading-relaxed text-text-secondary">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {task.summary || ''}
                </ReactMarkdown>
              </div>
            ) : isDispatched && !isQueued ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2Icon className="w-4 h-4 text-bronze-500 animate-spin" />
                <span className="text-xs text-text-placeholder italic">
                  Agent is working. Summary will appear here.
                </span>
              </div>
            ) : isQueued ? (
              <p className="text-xs text-text-placeholder italic">
                Task is queued. Summary will appear once the agent starts.
              </p>
            ) : (
              <p className="text-xs text-text-placeholder italic">
                No summary yet.
              </p>
            )}

            {task.agentLog && (
              <div className="mt-3">
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
          </AccordionSection>

          {/* Changes (commits) */}
          <AccordionSection
            icon={<GitCommitHorizontalIcon className="w-3.5 h-3.5 text-text-tertiary" />}
            title={`Changes${commits && commits.length > 0 ? ` (${commits.length})` : ''}`}
            defaultOpen={true}
            storageKey={`task-accordion:${task.id}:changes`}
          >
            {commits === null ? (
              <p className="text-xs text-text-placeholder italic">Loading commits...</p>
            ) : commits.length === 0 ? (
              <p className="text-xs text-text-placeholder italic">
                {task.status === 'todo' ? 'No commits yet.' :
                  !task.branch && !task.startCommit ? 'Commit tracking not available for this task.' :
                  'No commits yet.'}
              </p>
            ) : (
              <div className="space-y-1">
                {commits.map((commit) => (
                  <button
                    key={commit.hash}
                    onClick={() => { setSelectedCommitHash(commit.hash); setSelectedCommitMessage(commit.message); }}
                    className="flex items-start gap-2 py-1 w-full text-left rounded hover:bg-surface-hover/40 px-1 -mx-1 transition-colors cursor-pointer"
                  >
                    <code className="text-[10px] font-mono text-text-placeholder shrink-0 mt-0.5">{commit.hash}</code>
                    <span className="text-xs text-text-secondary leading-snug flex-1 min-w-0 text-left">{commit.message}</span>
                    <span className="text-[10px] text-text-placeholder shrink-0 mt-0.5">{commit.date}</span>
                  </button>
                ))}
              </div>
            )}
          </AccordionSection>

          {/* Next Steps */}
          {steps.length > 0 && (
            <AccordionSection
              icon={<ListChecksIcon className="w-3.5 h-3.5 text-text-tertiary" />}
              title="Next Steps"
              defaultOpen={true}
              storageKey={`task-accordion:${task.id}:steps`}
            >
              <ul className="space-y-1">
                {steps.map((step, idx) => (
                  <li key={idx} className="text-xs text-text-secondary flex items-start">
                    <span className="mr-2 text-text-placeholder">&bull;</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </AccordionSection>
          )}

          {/* Merge conflict banner (not an accordion — it's an alert) */}
          {task.mergeConflict && (
            <div className="px-4 py-3">
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

      {selectedCommitHash && (
        <CommitDiffModal
          isOpen={true}
          onClose={() => { setSelectedCommitHash(null); setSelectedCommitMessage(undefined); }}
          projectId={projectId}
          commitHash={selectedCommitHash}
          commitMessage={selectedCommitMessage}
        />
      )}

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
