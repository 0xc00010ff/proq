'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { SquareIcon, ArrowDownIcon, SendIcon, PaperclipIcon, XIcon, FileIcon, Loader2Icon, ListTodoIcon, CodeIcon, SearchIcon, GitBranchIcon, PlayIcon, RotateCcwIcon, PackageIcon, TerminalIcon } from 'lucide-react';
import type { AgentBlock, TaskAttachment } from '@/lib/types';
import { uploadFiles, attachmentUrl } from '@/lib/upload';
import { useAgentTabSession } from '@/hooks/useAgentTabSession';
import { ScrambleText } from './ScrambleText';
import { TextBlock } from './blocks/TextBlock';
import { ThinkingBlock } from './blocks/ThinkingBlock';
import { ToolBlock } from './blocks/ToolBlock';
import { ToolGroupBlock } from './blocks/ToolGroupBlock';
import type { ToolGroupItem } from './blocks/ToolGroupBlock';
import { StatusBlock } from './blocks/StatusBlock';
import { UserBlock } from './blocks/UserBlock';

// Persist drafts across project switches (survives unmount/remount)
const draftMap = new Map<string, string>();

/** Pre-fill a draft message for a given tab (works whether mounted or not) */
export function setAgentDraft(tabId: string, text: string) {
  draftMap.set(tabId, text);
  // Notify already-mounted components
  window.dispatchEvent(new CustomEvent('agent-draft', { detail: { tabId, text } }));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AgentTabPaneProps {
  tabId: string;
  projectId: string;
  visible: boolean;
  context?: string;
}

export function AgentTabPane({ tabId, projectId, visible, context }: AgentTabPaneProps) {
  const { blocks, streamingText, sessionDone, loaded, sendMessage, stop, clear } = useAgentTabSession(tabId, projectId, context);

  // Listen for clear events from the tab dropdown
  useEffect(() => {
    const handler = (e: Event) => {
      const { tabId: targetId, type } = (e as CustomEvent).detail;
      if (targetId === tabId && type === 'agent') clear();
    };
    window.addEventListener('workbench-clear-tab', handler);
    return () => window.removeEventListener('workbench-clear-tab', handler);
  }, [tabId, clear]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [inputValue, setInputValue] = useState(() => draftMap.get(tabId) || '');
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // Listen for external draft injections (e.g. from the Live empty state Agent button)
  useEffect(() => {
    const handler = (e: Event) => {
      const { tabId: targetId, text } = (e as CustomEvent).detail;
      if (targetId === tabId) {
        setInputValue(text);
        draftMap.set(tabId, text);
        // Resize textarea to fit
        requestAnimationFrame(() => {
          const ta = textareaRef.current;
          if (ta) {
            ta.style.height = '0';
            ta.style.height = Math.max(36, Math.min(ta.scrollHeight, 300)) + 'px';
          }
        });
      }
    };
    window.addEventListener('agent-draft', handler);
    return () => window.removeEventListener('agent-draft', handler);
  }, [tabId]);

  // Auto-scroll to bottom on new blocks unless user scrolled up
  useEffect(() => {
    if (!userScrolledUp && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [blocks, streamingText, userScrolledUp]);

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

  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = '0';
    const sh = ta.scrollHeight;
    ta.style.height = Math.max(36, Math.min(sh, 300)) + 'px';
  }, []);

  // Resize textarea on mount if there's a restored draft
  useEffect(() => {
    if (inputValue) resizeTextarea();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    draftMap.set(tabId, e.target.value);
    resizeTextarea();
  };

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const uploaded = await uploadFiles(files);
    setAttachments((prev) => [...prev, ...uploaded]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text && attachments.length === 0) return;
    sendMessage(text, attachments.length > 0 ? attachments : undefined);
    setInputValue('');
    draftMap.delete(tabId);
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

  // Build tool_use -> tool_result pairing map
  const toolResultMap = new Map<string, Extract<AgentBlock, { type: 'tool_result' }>>();
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      toolResultMap.set(block.toolId, block);
    }
  }

  const isRunning = !sessionDone;
  const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
  const isThinking = isRunning && !streamingText && blocks.length > 0 && (
    (lastBlock?.type === 'status' && lastBlock.subtype === 'init') ||
    (lastBlock?.type === 'tool_result') ||
    (lastBlock?.type === 'text') ||
    (lastBlock?.type === 'user')
  );

  // Group consecutive tool_use blocks of the same type
  type RenderItem =
    | { kind: 'block'; block: AgentBlock; idx: number }
    | { kind: 'tool_group'; toolName: string; items: (ToolGroupItem & { idx: number })[] };

  const renderItems: RenderItem[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === 'tool_result') continue;

    if (block.type === 'tool_use') {
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

  const hasHistory = blocks.length > 0;

  return (
    <div
      className="absolute inset-0 flex flex-col bg-surface-deep font-sans"
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
          {/* Empty state */}
          {!hasHistory && sessionDone && loaded && (
            <div className="flex flex-col justify-end h-full gap-4 select-none pb-2">
              <div className="space-y-1">
                <p className="text-sm font-medium text-text-secondary">
                  {context === 'live' ? 'Dev environment' : 'What can I help with?'}
                </p>
                <p className="text-xs text-text-placeholder">
                  {context === 'live'
                    ? 'Start or manage the dev server, or ask me anything:'
                    : 'Ask me anything about this project, or try one of these:'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(context === 'live' ? [
                  { icon: PlayIcon, label: 'Start dev server', prompt: 'Start the dev environment' },
                  { icon: RotateCcwIcon, label: 'Restart server', prompt: 'Restart the dev server' },
                  { icon: PackageIcon, label: 'Install dependencies', prompt: 'Install dependencies and start the dev server' },
                  { icon: TerminalIcon, label: 'Check server logs', prompt: 'Check the dev server logs for any errors' },
                ] : [
                  { icon: ListTodoIcon, label: 'Create tasks from a goal', prompt: 'Let\'s break down a goal into specific, descriptive tasks. Start by asking for and understanding the goal.' },
                  { icon: CodeIcon, label: 'Review recent changes', prompt: 'Review recent changes in this project. Start by asking if I want to focus on specific files, a date range, or just the latest commits.' },
                  { icon: SearchIcon, label: 'Explore the codebase', prompt: 'Help me understand this project. Start by asking what area or aspect I\'d like to explore.' },
                  { icon: GitBranchIcon, label: 'Plan a feature', prompt: 'Help me plan the implementation of a new feature. Start by asking what I want to build.' },
                ]).map(({ icon: Icon, label, prompt }) => (
                  <button
                    key={label}
                    onClick={() => {
                      sendMessage(prompt);
                    }}
                    title={prompt}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border-strong/30 bg-surface-hover/30 hover:bg-surface-hover hover:border-border-strong/60 text-left transition-colors group"
                  >
                    <Icon className="w-4 h-4 text-text-placeholder group-hover:text-bronze-500 shrink-0 transition-colors" />
                    <span className="text-xs text-text-tertiary group-hover:text-text-secondary transition-colors">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Loading indicator */}
          {blocks.length === 0 && !sessionDone && (
            <div className="flex items-center gap-2 py-2 text-xs text-text-tertiary">
              <Loader2Icon className="w-3.5 h-3.5 text-bronze-500 animate-spin" />
              <span>Starting session...</span>
            </div>
          )}

          {renderItems.map((item, ri) => {
            if (item.kind === 'tool_group') {
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
                    costUsd={block.costUsd}
                    durationMs={block.durationMs}
                    turns={block.turns}
                    error={block.error}
                    timestamp={block.timestamp}
                  />
                );
              default:
                return null;
            }
          })}

          {/* Streaming text (live partial response) */}
          {streamingText && <TextBlock text={streamingText} />}

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
        <div className="rounded-xl border border-border-strong/40 focus-within:border-border-strong bg-surface-topbar overflow-hidden transition-colors">
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
                      className="h-16 w-auto max-w-[100px] object-cover block"
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
            className="w-full min-h-[36px] max-h-[300px] resize-none overflow-y-auto bg-transparent px-3 pt-3 pb-2 text-sm leading-[20px] text-text-secondary placeholder:text-text-placeholder focus:outline-none"
          />

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-1.5 pb-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-hover"
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
                className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg ${inputValue.trim() || attachments.length > 0 ? 'text-text-chrome bg-surface-hover' : 'text-text-tertiary disabled:opacity-30'}`}
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
