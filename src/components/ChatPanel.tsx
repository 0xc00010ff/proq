'use client';

import React, { useEffect, useState, useRef } from 'react';
import { CornerDownLeftIcon, TerminalSquareIcon, GlobeIcon, FileTextIcon, SearchIcon, PencilIcon, CodeIcon, WrenchIcon, ChevronUpIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatLogEntry, ToolCall } from '@/lib/types';

export interface StreamingMessage {
  toolCalls: ToolCall[];
  text: string;
}

interface ChatPanelProps {
  messages: ChatLogEntry[];
  onSendMessage: (content: string) => void;
  style?: React.CSSProperties;
  streamingMessage?: StreamingMessage | null;
  isLoading?: boolean;
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

export function ChatPanel({ messages, onSendMessage, style, streamingMessage, isLoading }: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingMessage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;
    onSendMessage(inputValue);
    setInputValue('');
  };

  const formatTimestamp = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return ts;
    }
  };

  return (
    <div
      className="w-full flex flex-col bg-gunmetal-100 dark:bg-black/40 flex-shrink-0"
      style={{ minHeight: 0, ...style }}
    >
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
                <div className="inline-flex items-baseline gap-2 bg-zinc-800/50 rounded px-2.5 py-1">
                  <span className="text-xs font-bold text-gunmetal-500 shrink-0">{'\u276F'}</span>
                  <p className="text-sm leading-relaxed text-zinc-300">{msg.message}</p>
                </div>
                <span className="text-[10px] text-gunmetal-500 dark:text-zinc-700 ml-auto opacity-0 group-hover:opacity-100 shrink-0">
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
              <span className="text-[10px] text-zinc-500 animate-pulse">thinking...</span>
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
              <span className="text-[10px] text-zinc-600 animate-pulse">working...</span>
            ) : null}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-5 border-t border-gunmetal-300/60 dark:border-zinc-800/60 bg-gunmetal-200/20 dark:bg-black/20">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <span className="text-gunmetal-500 text-sm font-bold select-none">{'\u276F'}</span>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={isLoading ? "waiting for response..." : "message..."}
            disabled={isLoading}
            className="flex-1 bg-transparent text-sm text-gunmetal-800 dark:text-zinc-200 placeholder:text-gunmetal-500 dark:placeholder:text-zinc-700 focus:outline-none caret-steel disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading}
            className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <CornerDownLeftIcon className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
