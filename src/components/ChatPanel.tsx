'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { CornerDownLeftIcon, TerminalSquareIcon, GlobeIcon, FileTextIcon, SearchIcon, PencilIcon, CodeIcon, WrenchIcon, ChevronUpIcon, PaperclipIcon, XIcon, FileIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatLogEntry, ToolCall, TaskAttachment } from '@/lib/types';
import { ScrambleText } from './ScrambleText';

export interface StreamingMessage {
  toolCalls: ToolCall[];
  text: string;
}

interface ChatPanelProps {
  messages: ChatLogEntry[];
  onSendMessage: (content: string, attachments?: TaskAttachment[]) => void;
  style?: React.CSSProperties;
  streamingMessage?: StreamingMessage | null;
  isLoading?: boolean;
  initialValue?: string;
  onDraftChange?: (value: string) => void;
}

// Tool call icon + label mapping
function toolCallInfo(tc: ToolCall): { icon: React.ReactNode; label: string; detail: string } {
  const iconClass = "w-3 h-3 shrink-0";
  const action = tc.action || '';
  const detail = tc.detail || '';

  switch (action) {
    case 'Bash':
      return { icon: <TerminalSquareIcon className={iconClass} />, label: 'Ran command', detail };
    case 'Read':
      return { icon: <FileTextIcon className={iconClass} />, label: 'Read file', detail: detail.split('/').pop() || detail };
    case 'Write':
      return { icon: <PencilIcon className={iconClass} />, label: 'Wrote file', detail: detail.split('/').pop() || detail };
    case 'Edit':
      return { icon: <PencilIcon className={iconClass} />, label: 'Edited file', detail: detail.split('/').pop() || detail };
    case 'Glob':
      return { icon: <SearchIcon className={iconClass} />, label: 'Searched files', detail };
    case 'Grep':
      return { icon: <SearchIcon className={iconClass} />, label: 'Searched code', detail };
    case 'WebFetch':
    case 'WebSearch':
      return { icon: <GlobeIcon className={iconClass} />, label: action === 'WebFetch' ? 'Fetched URL' : 'Web search', detail };
    default:
      return { icon: <WrenchIcon className={iconClass} />, label: action || 'Tool call', detail };
  }
}

function ToolCallPill({ tc }: { tc: ToolCall }) {
  const { icon, label, detail } = toolCallInfo(tc);
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-800/60 border border-zinc-700/40 text-[11px] text-zinc-400 leading-snug">
      {icon}
      <span className="text-zinc-500">{label}</span>
      {detail && (
        <span className="text-zinc-400 font-mono text-[10px] truncate max-w-[240px]">{detail}</span>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MessageContent({ text }: { text: string }) {
  return (
    <div className="prose-chat text-sm leading-relaxed text-zinc-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-zinc-200">{children}</strong>,
          em: ({ children }) => <em className="text-zinc-300">{children}</em>,
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-');
            if (isBlock) {
              return <code className={`${className} block bg-zinc-900 rounded px-3 py-2 text-[12px] font-mono text-zinc-300 overflow-x-auto my-2`}>{children}</code>;
            }
            return <code className="bg-zinc-800/70 text-zinc-300 rounded px-1 py-0.5 text-[12px] font-mono">{children}</code>;
          },
          pre: ({ children }) => <pre className="bg-zinc-900 rounded-md overflow-x-auto my-2">{children}</pre>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="text-zinc-300">{children}</li>,
          a: ({ href, children }) => <a href={href} className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-zinc-700 pl-3 text-zinc-400 italic my-2">{children}</blockquote>,
          h1: ({ children }) => <h1 className="text-base font-semibold text-zinc-200 mb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold text-zinc-200 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-zinc-300 mb-1">{children}</h3>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function AttachmentPreview({ attachments }: { attachments: TaskAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {attachments.map((att) => {
        const isImage = att.type?.startsWith('image/') && att.dataUrl;
        return isImage ? (
          <div key={att.id} className="rounded overflow-hidden border border-zinc-700/50 bg-zinc-800/60">
            <img src={att.dataUrl} alt={att.name} className="h-16 w-auto max-w-[100px] object-cover block" />
          </div>
        ) : (
          <div key={att.id} className="flex items-center gap-1.5 bg-zinc-800/60 border border-zinc-700/50 rounded px-2 py-1.5">
            <FileIcon className="w-3 h-3 text-zinc-500 shrink-0" />
            <span className="text-[10px] text-zinc-400 truncate max-w-[100px]">{att.name}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ChatPanel({ messages, onSendMessage, style, streamingMessage, isLoading, initialValue, onDraftChange }: ChatPanelProps) {
  const [inputValue, setInputValue] = useState(initialValue || '');
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync when initialValue changes (e.g. restored from persistence)
  const initialValueApplied = useRef(false);
  useEffect(() => {
    if (initialValue && !initialValueApplied.current) {
      setInputValue(initialValue);
      initialValueApplied.current = true;
    }
  }, [initialValue]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingMessage]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputValue.trim() && attachments.length === 0) || isLoading) return;
    onSendMessage(inputValue, attachments.length > 0 ? attachments : undefined);
    setInputValue('');
    setAttachments([]);
    onDraftChange?.('');
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const formatTimestamp = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return ts;
    }
  };

  return (
    <div
      className={`w-full flex flex-col bg-bronze-100 dark:bg-black/40 flex-shrink-0 relative transition-colors ${isDragOver ? 'ring-1 ring-bronze-500/40' : ''}`}
      style={{ minHeight: 0, ...style }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-bronze-500/5 flex items-center justify-center pointer-events-none z-20 rounded">
          <div className="text-sm text-bronze-500 font-medium">Drop files here</div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg, idx) => (
          <div key={idx} className="group">
            {msg.role === 'proq' ? (
              <div>
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {msg.toolCalls.map((tc, i) => (
                      <ToolCallPill key={i} tc={tc} />
                    ))}
                  </div>
                )}
                <MessageContent text={msg.message} />
              </div>
            ) : (
              <div className="flex items-baseline gap-2">
                <div className="inline-flex flex-col bg-zinc-800/50 rounded px-2.5 py-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-bold text-bronze-500 shrink-0">{'\u276F'}</span>
                    <p className="text-sm leading-relaxed text-zinc-300">{msg.message}</p>
                  </div>
                  {msg.attachments && msg.attachments.length > 0 && (
                    <AttachmentPreview attachments={msg.attachments} />
                  )}
                </div>
                <span className="text-[10px] text-bronze-500 dark:text-zinc-700 ml-auto opacity-0 group-hover:opacity-100 shrink-0">
                  {formatTimestamp(msg.timestamp)}
                </span>
              </div>
            )}
          </div>
        ))}

        {/* Streaming message */}
        {streamingMessage && (
          <div>
            {isLoading && !streamingMessage.text && streamingMessage.toolCalls.length === 0 && (
              <ScrambleText text="Thinking..." />
            )}

            {streamingMessage.toolCalls.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {streamingMessage.toolCalls.map((tc, i) => (
                  <ToolCallPill key={i} tc={tc} />
                ))}
              </div>
            )}

            {streamingMessage.text ? (
              <div className="relative">
                <MessageContent text={streamingMessage.text} />
                <span className="inline-block w-1.5 h-4 bg-zinc-400 animate-pulse ml-0.5 align-text-bottom" />
              </div>
            ) : isLoading && streamingMessage.toolCalls.length > 0 ? (
              <ScrambleText text="Working..." />
            ) : null}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Attachment previews above input */}
      {attachments.length > 0 && (
        <div className="px-6 pb-2 flex flex-wrap gap-2 shrink-0">
          {attachments.map((att) => {
            const isImage = att.type?.startsWith('image/') && att.dataUrl;
            return isImage ? (
              <div
                key={att.id}
                className="relative group rounded-md overflow-hidden border border-bronze-400/50 dark:border-zinc-700/50 bg-bronze-200/60 dark:bg-zinc-800/60"
              >
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  className="h-16 w-auto max-w-[100px] object-cover block"
                />
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/60 text-white/80 hover:text-crimson opacity-0 group-hover:opacity-100 transition-opacity z-10"
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
                className="flex items-center gap-1.5 bg-bronze-200/60 dark:bg-zinc-800/60 border border-bronze-400/50 dark:border-zinc-700/50 rounded-md px-2.5 py-2 group"
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

      {/* Input */}
      <div className="px-6 py-5 border-t border-bronze-300/60 dark:border-zinc-800/60 bg-bronze-200/20 dark:bg-black/20">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <span className="text-bronze-500 text-sm font-bold select-none">{'\u276F'}</span>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              onDraftChange?.(e.target.value);
            }}
            placeholder={isLoading ? "waiting for response..." : "message..."}
            disabled={isLoading}
            className="flex-1 bg-transparent text-sm text-bronze-800 dark:text-zinc-200 placeholder:text-bronze-500 dark:placeholder:text-zinc-700 focus:outline-none caret-bronze-500 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-zinc-400 dark:text-zinc-600 hover:text-bronze-500 dark:hover:text-bronze-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={isLoading}
            title="Attach file"
          >
            <PaperclipIcon className="w-3.5 h-3.5" />
          </button>
          <button
            type="submit"
            disabled={(!inputValue.trim() && attachments.length === 0) || isLoading}
            className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <CornerDownLeftIcon className="w-3.5 h-3.5" />
          </button>
        </form>
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
