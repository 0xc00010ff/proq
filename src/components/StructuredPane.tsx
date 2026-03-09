'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { SquareIcon, ArrowDownIcon, SendIcon, PaperclipIcon, XIcon, FileIcon, Loader2Icon, RotateCcwIcon } from 'lucide-react';
import type { AgentBlock, TaskAttachment, FollowUpDraft } from '@/lib/types';
import { uploadFiles, attachmentUrl } from '@/lib/upload';
import { useAgentSession } from '@/hooks/useAgentSession';
import { ScrambleText } from './ScrambleText';
import { TextBlock } from './blocks/TextBlock';
import { ThinkingBlock } from './blocks/ThinkingBlock';
import { ToolBlock } from './blocks/ToolBlock';
import { ToolGroupBlock } from './blocks/ToolGroupBlock';
import type { ToolGroupItem } from './blocks/ToolGroupBlock';
import { StatusBlock } from './blocks/StatusBlock';
import { TaskUpdateBlock } from './blocks/TaskUpdateBlock';
import { UserBlock } from './blocks/UserBlock';
import { AskQuestionBlock } from './blocks/AskQuestionBlock';
import { PlanApprovalBlock } from './blocks/PlanApprovalBlock';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface StructuredPaneProps {
  taskId: string;
  projectId: string;
  visible: boolean;
  taskStatus?: string;
  agentBlocks?: AgentBlock[];
  followUpDraft?: FollowUpDraft;
  onFollowUpDraftChange?: (draft: FollowUpDraft | null) => void;
  onTaskStatusChange?: (status: string) => void;
}

export function StructuredPane({ taskId, projectId, visible, taskStatus, agentBlocks, followUpDraft, onFollowUpDraftChange, onTaskStatusChange }: StructuredPaneProps) {
  const { blocks, sessionDone, sendFollowUp, approvePlan, stop } = useAgentSession(taskId, projectId, agentBlocks);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const [inputValue, setInputValue] = useState(followUpDraft?.text ?? '');
  const [attachments, setAttachments] = useState<TaskAttachment[]>(followUpDraft?.attachments ?? []);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const [showCosts, setShowCosts] = useState(false);
  // Track user-originated input changes to avoid external sync overwriting them
  const localChangeRef = useRef(false);

  // Fetch showCosts setting once on mount
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => setShowCosts(!!s.showCosts))
      .catch(() => {});
  }, []);

  // Auto-scroll to bottom on new blocks unless user scrolled up
  useEffect(() => {
    if (!userScrolledUp && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [blocks, userScrolledUp]);

  // Track scroll position
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setUserScrolledUp(!isAtBottom);
  };

  const jumpToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setUserScrolledUp(false);
    }
  };

  // Auto-resize textarea
  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Reset to 0 to get true scrollHeight, then clamp
    ta.style.height = '0';
    const sh = ta.scrollHeight;
    ta.style.height = Math.max(36, Math.min(sh, 160)) + 'px';
  }, []);

  // Resize textarea on mount when restoring a draft
  useEffect(() => {
    if (followUpDraft?.text) resizeTextarea();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync input when draft is set externally (e.g., conflict resolution prompt)
  // Skip if the change originated from user typing (localChangeRef)
  const prevDraftRef = useRef(followUpDraft?.text);
  useEffect(() => {
    if (localChangeRef.current) {
      localChangeRef.current = false;
      prevDraftRef.current = followUpDraft?.text;
      return;
    }
    if (followUpDraft?.text && followUpDraft.text !== prevDraftRef.current) {
      setInputValue(followUpDraft.text);
      setAttachments(followUpDraft.attachments ?? []);
      setTimeout(resizeTextarea, 0);
      textareaRef.current?.focus();
    }
    prevDraftRef.current = followUpDraft?.text;
  }, [followUpDraft, resizeTextarea]);

  const syncDraft = useCallback((text: string, atts: TaskAttachment[]) => {
    if (text || atts.length > 0) {
      onFollowUpDraftChange?.({ text, attachments: atts });
    } else {
      onFollowUpDraftChange?.(null);
    }
  }, [onFollowUpDraftChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    localChangeRef.current = true;
    setInputValue(val);
    syncDraft(val, attachments);
    resizeTextarea();
  };

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const uploaded = await uploadFiles(files);
    localChangeRef.current = true;
    setAttachments((prev) => {
      const updated = [...prev, ...uploaded];
      syncDraft(inputValue, updated);
      return updated;
    });
  }, [inputValue, syncDraft]);

  const removeAttachment = useCallback((id: string) => {
    localChangeRef.current = true;
    setAttachments((prev) => {
      const updated = prev.filter((a) => a.id !== id);
      syncDraft(inputValue, updated);
      return updated;
    });
  }, [inputValue, syncDraft]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text && attachments.length === 0) return;
    sendFollowUp(text, attachments.length > 0 ? attachments : undefined);
    setInputValue('');
    setAttachments([]);
    onFollowUpDraftChange?.(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isRunning) return;
      handleSend();
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  if (!visible) return null;

  // Build a map of tool_use toolId -> tool_result for pairing
  const toolResultMap = new Map<string, Extract<AgentBlock, { type: 'tool_result' }>>();
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      toolResultMap.set(block.toolId, block);
    }
  }

  // Check if agent is actively thinking (last non-status block has no result yet)
  const isRunning = !sessionDone;
  const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
  const isThinking = isRunning && blocks.length > 0 && (
    (lastBlock?.type === 'status' && lastBlock.subtype === 'init') ||
    (lastBlock?.type === 'tool_result') ||
    (lastBlock?.type === 'text') ||
    (lastBlock?.type === 'user')
  );

  // Group consecutive tool_use blocks of the same type into render items
  type RenderItem =
    | { kind: 'block'; block: AgentBlock; idx: number }
    | { kind: 'tool_group'; toolName: string; items: (ToolGroupItem & { idx: number })[] }
    | { kind: 'ask_question'; toolId: string; input: Record<string, unknown>; result?: Extract<AgentBlock, { type: 'tool_result' }>; idx: number }
    | { kind: 'plan_approval'; toolId: string; input: Record<string, unknown>; result?: Extract<AgentBlock, { type: 'tool_result' }>; planContent?: string; planFilePath?: string; alreadyResponded: boolean; idx: number };

  const renderItems: RenderItem[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === 'tool_result') continue;

    if (block.type === 'tool_use') {
      // Render AskUserQuestion as interactive question card
      if (block.name === 'AskUserQuestion') {
        renderItems.push({
          kind: 'ask_question',
          toolId: block.toolId,
          input: block.input,
          result: toolResultMap.get(block.toolId),
          idx: i,
        });
        continue;
      }

      // Render ExitPlanMode as plan approval card
      if (block.name === 'ExitPlanMode') {
        // Plan content and path are enriched server-side (agent-session.ts reads the
        // plan file from disk when ExitPlanMode is detected). Fall back to backward
        // scan for older sessions where the enrichment wasn't available.
        let planContent = block.input._planContent as string | undefined;
        let planFilePath = block.input._planFilePath as string | undefined;
        if (!planContent) {
          for (let j = i - 1; j >= 0; j--) {
            if (i - j > 50) break;
            const prev = blocks[j];
            if (prev.type === 'tool_use' && prev.name === 'Write') {
              const fp = prev.input.file_path as string;
              if (fp && fp.endsWith('.md')) {
                planContent = prev.input.content as string;
                planFilePath = fp;
                break;
              }
            }
            if (prev.type === 'tool_use' && prev.name === 'Edit') {
              const fp = prev.input.file_path as string;
              if (fp && fp.endsWith('.md') && prev.input.new_string) {
                planContent = prev.input.new_string as string;
                planFilePath = fp;
                break;
              }
            }
          }
        }
        // Check if the user already responded (a user block exists after this one)
        let alreadyResponded = false;
        for (let j = i + 1; j < blocks.length; j++) {
          if (blocks[j].type === 'user') { alreadyResponded = true; break; }
        }
        renderItems.push({
          kind: 'plan_approval',
          toolId: block.toolId,
          input: block.input,
          result: toolResultMap.get(block.toolId),
          planContent,
          planFilePath,
          alreadyResponded,
          idx: i,
        });
        continue;
      }

      // Render proq update_task as TaskUpdateBlock instead of ToolBlock
      const isProqUpdate = block.name === 'mcp__proq__update_task';
      if (isProqUpdate && typeof block.input.summary === 'string') {
        renderItems.push({
          kind: 'block',
          block: {
            type: 'task_update',
            summary: block.input.summary as string,
            humanSteps: block.input.humanSteps as string | undefined,
            timestamp: new Date().toISOString(),
          },
          idx: i,
        });
        continue;
      }

      // Check if this extends an existing group at the end
      const last = renderItems[renderItems.length - 1];
      if (last?.kind === 'tool_group' && last.toolName === block.name) {
        last.items.push({
          toolId: block.toolId,
          name: block.name,
          input: block.input,
          result: toolResultMap.get(block.toolId),
          idx: i,
        });
      } else {
        // Start a new potential group
        renderItems.push({
          kind: 'tool_group',
          toolName: block.name,
          items: [{
            toolId: block.toolId,
            name: block.name,
            input: block.input,
            result: toolResultMap.get(block.toolId),
            idx: i,
          }],
        });
      }
    } else {
      renderItems.push({ kind: 'block', block, idx: i });
    }
  }

  return (
    <div
      className="flex-1 flex flex-col min-h-0 bg-surface-deep relative"
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

      {/* Message list */}
      <div className="relative flex-1 min-h-0">

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-y-auto px-5 py-4 space-y-1"
        >
          {/* Starting session placeholder — shown before any blocks arrive */}
          {blocks.length === 0 && !sessionDone && (
            <div className="flex items-center gap-2 py-2 text-xs text-text-tertiary">
              <Loader2Icon className="w-3.5 h-3.5 text-bronze-500 animate-spin" />
              <span>Starting session...</span>
            </div>
          )}

          {renderItems.map((item, ri) => {
            if (item.kind === 'ask_question') {
              const questions = Array.isArray(item.input.questions) ? item.input.questions as { question: string; header?: string; options: { label: string; description: string }[]; multiSelect?: boolean }[] : [];
              return (
                <AskQuestionBlock
                  key={`ask-${item.idx}`}
                  questions={questions}
                  hasResult={!!item.result}
                  resultText={item.result?.output}
                  isOld={blocks.slice(item.idx + 1).some(b => b.type === 'user')}
                  onAnswer={(answer) => {
                    sendFollowUp(answer);
                  }}
                />
              );
            }
            if (item.kind === 'plan_approval') {
              return (
                <PlanApprovalBlock
                  key={`plan-${item.idx}`}
                  input={item.input}
                  planContent={item.planContent}
                  planFilePath={item.planFilePath}
                  alreadyResponded={item.alreadyResponded}
                  onApprove={() => approvePlan('Plan approved. Proceed with implementation.')}
                  onReject={(feedback) => sendFollowUp(`Plan rejected. ${feedback}`)}
                />
              );
            }
            if (item.kind === 'tool_group') {
              // Single tool call — render inline without group wrapper
              if (item.items.length === 1) {
                const t = item.items[0];
                return (
                  <ToolBlock
                    key={`tool-${t.idx}`}
                    toolId={t.toolId}
                    name={t.name}
                    input={t.input}
                    result={t.result}
                    forceCollapsed={undefined}
                  />
                );
              }
              // Multiple consecutive same-type tools — aggregate
              return (
                <ToolGroupBlock
                  key={`tg-${ri}`}
                  toolName={item.toolName}
                  items={item.items}
                  forceCollapsed={undefined}
                />
              );
            }

            const block = item.block;
            const idx = item.idx;

            switch (block.type) {
              case 'text':
                return <TextBlock key={idx} text={block.text} />;
              case 'thinking':
                return <ThinkingBlock key={idx} thinking={block.thinking} forceCollapsed={undefined} />;
              case 'user':
                return <UserBlock key={idx} text={block.text} attachments={block.attachments} />;
              case 'status':
                return (
                  <StatusBlock
                    key={idx}
                    subtype={block.subtype}
                    sessionId={block.sessionId}
                    model={block.model}
                    costUsd={showCosts ? block.costUsd : undefined}
                    durationMs={block.durationMs}
                    turns={block.turns}
                    error={block.error}
                  />
                );
              case 'task_update':
                return (
                  <TaskUpdateBlock
                    key={idx}
                    summary={block.summary}
                    humanSteps={block.humanSteps}
                  />
                );
              case 'stream_delta':
                return (
                  <span key={idx} className="text-sm text-text-secondary">
                    {block.text}
                  </span>
                );
              default:
                return null;
            }
          })}

          {/* Thinking indicator */}
          {isThinking && (
            <div className="py-2">
              <ScrambleText text="Thinking..." />
            </div>
          )}
        </div>

        {/* Jump to bottom */}
        {userScrolledUp && (
          <button
            onClick={jumpToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1.5 text-[10px] font-medium text-text-secondary bg-surface-hover border border-border-strong rounded-full shadow-lg hover:bg-border-strong z-10"
          >
            <ArrowDownIcon className="w-3 h-3" />
            Jump to bottom
          </button>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 px-3 py-2.5">
        {taskStatus === 'done' ? (
          <div className="flex items-center justify-between rounded-xl border border-border-strong bg-surface-detail px-4 py-3">
            <span className="text-xs text-text-tertiary">This task is read-only. Move back to Verify to resume editing.</span>
            <button
              onClick={() => onTaskStatusChange?.('verify')}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary bg-surface-hover border border-border-strong rounded-lg hover:bg-border-strong"
            >
              <RotateCcwIcon className="w-3 h-3" />
              Resume editing
            </button>
          </div>
        ) : (
        <>
        <div className="rounded-xl border border-border-strong/40 focus-within:border-border-strong bg-surface-topbar overflow-hidden transition-colors">
          {/* Attachment previews inside container */}
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
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            rows={1}
            style={{ height: '36px' }}
            className="w-full min-h-[36px] max-h-[160px] resize-none overflow-hidden bg-transparent px-3 pt-3 pb-2 text-sm leading-[20px] text-text-secondary placeholder:text-text-placeholder focus:outline-none"
          />

          {/* Bottom bar: attach left, send right */}
          <div className="flex items-center justify-between px-1.5 pb-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-chrome-hover hover:bg-surface-hover"
              title="Attach file"
            >
              <PaperclipIcon className="w-4 h-4" />
            </button>
            {isRunning ? (
              <button
                onClick={stop}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/10 hover:bg-red-500/20"
                title="Stop agent"
              >
                <SquareIcon className="w-3.5 h-3.5 text-red-400 fill-red-400" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() && attachments.length === 0}
                className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg ${inputValue.trim() || attachments.length > 0 ? 'text-text-chrome bg-bronze-400/30 dark:bg-surface-hover' : 'text-text-tertiary disabled:opacity-30'}`}
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
        </>
        )}
      </div>
    </div>
  );
}
