'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { SquareIcon, ArrowDownIcon, ChevronsUpDownIcon, SendIcon, PaperclipIcon, XIcon, FileIcon } from 'lucide-react';
import type { PrettyBlock, TaskAttachment } from '@/lib/types';
import { usePrettySession } from '@/hooks/usePrettySession';
import { ScrambleText } from './ScrambleText';
import { TextBlock } from './pretty/TextBlock';
import { ThinkingBlock } from './pretty/ThinkingBlock';
import { ToolBlock } from './pretty/ToolBlock';
import { ToolGroupBlock } from './pretty/ToolGroupBlock';
import type { ToolGroupItem } from './pretty/ToolGroupBlock';
import { StatusBlock } from './pretty/StatusBlock';
import { TaskUpdateBlock } from './pretty/TaskUpdateBlock';
import { UserBlock } from './pretty/UserBlock';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PrettyPaneProps {
  taskId: string;
  projectId: string;
  visible: boolean;
  prettyLog?: PrettyBlock[];
}

export function PrettyPane({ taskId, projectId, visible, prettyLog }: PrettyPaneProps) {
  const { blocks, sessionDone, sendFollowUp, stop } = usePrettySession(taskId, projectId, prettyLog);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

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

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    resizeTextarea();
  };

  const addFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((f) => {
      const att: TaskAttachment = {
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: f.name,
        size: f.size,
        type: f.type,
      };
      if (f.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          att.dataUrl = e.target?.result as string;
          setAttachments((prev) => [...prev, att]);
        };
        reader.readAsDataURL(f);
      } else {
        setAttachments((prev) => [...prev, att]);
      }
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text && attachments.length === 0) return;
    sendFollowUp(text, attachments.length > 0 ? attachments : undefined);
    setInputValue('');
    setAttachments([]);
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
  const toolResultMap = new Map<string, Extract<PrettyBlock, { type: 'tool_result' }>>();
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      toolResultMap.set(block.toolId, block);
    }
  }

  // Check if agent is actively thinking (last non-status block has no result yet)
  const isRunning = !sessionDone;
  const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
  const isThinking = isRunning && (
    blocks.length === 0 ||
    (lastBlock?.type === 'status' && lastBlock.subtype === 'init') ||
    (lastBlock?.type === 'tool_result') ||
    (lastBlock?.type === 'text') ||
    (lastBlock?.type === 'user')
  );

  // Group consecutive tool_use blocks of the same type into render items
  type RenderItem =
    | { kind: 'block'; block: PrettyBlock; idx: number }
    | { kind: 'tool_group'; toolName: string; items: (ToolGroupItem & { idx: number })[] };

  const renderItems: RenderItem[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === 'tool_result') continue;

    if (block.type === 'tool_use') {
      // Render proq update_task as TaskUpdateBlock instead of ToolBlock
      const isProqUpdate = block.name === 'mcp__proq__update_task';
      if (isProqUpdate && typeof block.input.findings === 'string') {
        renderItems.push({
          kind: 'block',
          block: {
            type: 'task_update',
            findings: block.input.findings as string,
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
      className="flex-1 flex flex-col min-h-0 bg-bronze-50 dark:bg-[#0d0d0d] relative"
      onDrop={handleDrop}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-bronze-500/25 dark:bg-bronze-500/20 border-2 border-bronze-500/50 flex items-center justify-center pointer-events-none z-20 rounded-md m-1">
          <div className="text-sm text-zinc-700 dark:text-zinc-300 font-medium bg-bronze-300 dark:bg-bronze-800 border border-bronze-400 dark:border-bronze-700 px-4 py-2 rounded-md shadow-sm">Drop files here</div>
        </div>
      )}

      {/* Message list */}
      <div className="relative flex-1 min-h-0">
        {/* Expand/Collapse toggle — floating top-right */}
        <div className="absolute top-2 right-3 z-10">
          <button
            onClick={() => setAllCollapsed(!allCollapsed)}
            className="flex items-center gap-1 text-[10px] text-bronze-500 dark:text-zinc-500 hover:text-bronze-700 dark:hover:text-zinc-300 transition-colors px-1.5 py-0.5 rounded border border-bronze-300 dark:border-zinc-800 hover:bg-bronze-200 dark:hover:bg-zinc-800 bg-bronze-50/90 dark:bg-[#0d0d0d]/90 backdrop-blur-sm"
          >
            <ChevronsUpDownIcon className="w-3 h-3" />
            {allCollapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-y-auto px-5 py-4 space-y-1"
        >
          {renderItems.map((item, ri) => {
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
                    forceCollapsed={allCollapsed || undefined}
                  />
                );
              }
              // Multiple consecutive same-type tools — aggregate
              return (
                <ToolGroupBlock
                  key={`tg-${ri}`}
                  toolName={item.toolName}
                  items={item.items}
                  forceCollapsed={allCollapsed || undefined}
                />
              );
            }

            const block = item.block;
            const idx = item.idx;

            switch (block.type) {
              case 'text':
                return <TextBlock key={idx} text={block.text} />;
              case 'thinking':
                return <ThinkingBlock key={idx} thinking={block.thinking} forceCollapsed={allCollapsed || undefined} />;
              case 'user':
                return <UserBlock key={idx} text={block.text} attachments={block.attachments} />;
              case 'status':
                return (
                  <StatusBlock
                    key={idx}
                    subtype={block.subtype}
                    sessionId={block.sessionId}
                    model={block.model}
                    costUsd={block.costUsd}
                    durationMs={block.durationMs}
                    turns={block.turns}
                    error={block.error}
                  />
                );
              case 'task_update':
                return (
                  <TaskUpdateBlock
                    key={idx}
                    findings={block.findings}
                    humanSteps={block.humanSteps}
                  />
                );
              case 'stream_delta':
                return (
                  <span key={idx} className="text-sm text-bronze-800 dark:text-zinc-300">
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
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1.5 text-[10px] font-medium text-bronze-600 dark:text-zinc-400 bg-bronze-200 dark:bg-zinc-800 border border-bronze-400 dark:border-zinc-700 rounded-full shadow-lg hover:bg-bronze-300 dark:hover:bg-zinc-700 transition-colors z-10"
          >
            <ArrowDownIcon className="w-3 h-3" />
            Jump to bottom
          </button>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 px-3 py-2.5">
        <div className="rounded-xl border border-bronze-300 dark:border-zinc-700 bg-bronze-50 dark:bg-zinc-900 focus-within:border-bronze-400 dark:focus-within:border-bronze-600 transition-colors overflow-hidden">
          {/* Attachment previews inside container */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {attachments.map((att) => {
                const isImage = att.type?.startsWith('image/') && att.dataUrl;
                return isImage ? (
                  <div
                    key={att.id}
                    className="relative group rounded-lg overflow-hidden border border-bronze-400/50 dark:border-zinc-700/50 bg-bronze-200/60 dark:bg-zinc-800/60"
                  >
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      className="h-16 w-auto max-w-[100px] object-cover block cursor-pointer"
                      onClick={() => {
                        if (att.dataUrl) {
                          const res = fetch(att.dataUrl);
                          res.then(r => r.blob()).then(blob => {
                            window.open(URL.createObjectURL(blob), '_blank');
                          });
                        }
                      }}
                    />
                    <button
                      onClick={() => removeAttachment(att.id)}
                      className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white/80 hover:text-crimson opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    >
                      <XIcon className="w-2.5 h-2.5" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1 py-0.5">
                      <span className="text-[9px] text-zinc-300 truncate block">{att.name}</span>
                    </div>
                  </div>
                ) : (
                  <div
                    key={att.id}
                    className="flex items-center gap-1.5 bg-bronze-200/60 dark:bg-zinc-800/60 border border-bronze-400/50 dark:border-zinc-700/50 rounded-lg px-2.5 py-2 group"
                  >
                    <FileIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] text-zinc-700 dark:text-zinc-300 truncate max-w-[120px] leading-tight">{att.name}</span>
                      <span className="text-[9px] text-zinc-600 leading-tight">{formatSize(att.size)}</span>
                    </div>
                    <button
                      onClick={() => removeAttachment(att.id)}
                      className="text-zinc-600 hover:text-crimson transition-colors ml-0.5 opacity-0 group-hover:opacity-100"
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
            className="w-full min-h-[36px] max-h-[160px] resize-none overflow-hidden bg-transparent px-3 pt-3 pb-2 text-sm leading-[20px] text-bronze-800 dark:text-zinc-300 placeholder:text-bronze-400 dark:placeholder:text-zinc-600 focus:outline-none"
          />

          {/* Bottom bar: attach left, send right */}
          <div className="flex items-center justify-between px-1.5 pb-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-bronze-500 dark:text-zinc-500 hover:text-bronze-600 dark:hover:text-bronze-400 hover:bg-bronze-200/60 dark:hover:bg-zinc-800 transition-colors"
              title="Attach file"
            >
              <PaperclipIcon className="w-4 h-4" />
            </button>
            {isRunning ? (
              <button
                onClick={stop}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors"
                title="Stop agent"
              >
                <SquareIcon className="w-3.5 h-3.5 text-red-400 fill-red-400" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() && attachments.length === 0}
                className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${inputValue.trim() || attachments.length > 0 ? 'text-bronze-600 dark:text-bronze-500 bg-bronze-200/60 dark:bg-zinc-800' : 'text-bronze-500 dark:text-zinc-500 disabled:opacity-30'}`}
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
    </div>
  );
}
