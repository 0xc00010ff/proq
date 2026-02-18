'use client';

import React, { useEffect, useState, useRef } from 'react';
import { CornerDownLeftIcon, TerminalIcon } from 'lucide-react';
import type { ChatLogEntry } from '@/lib/types';

interface ChatPanelProps {
  messages: ChatLogEntry[];
  onSendMessage: (content: string) => void;
  style?: React.CSSProperties;
}

export function ChatPanel({ messages, onSendMessage, style }: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
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
      className="w-full flex flex-col bg-gunmetal-100 dark:bg-black/40 flex-shrink-0 font-mono"
      style={{ minHeight: 0, ...style }}
    >
      {/* Terminal Header */}
      <div className="h-10 flex items-center justify-between px-4 border-b border-gunmetal-300/60 dark:border-zinc-800/60 bg-gunmetal-200/20 dark:bg-zinc-900/20">
        <div className="flex items-center gap-2 text-zinc-500">
          <TerminalIcon className="w-3.5 h-3.5" />
          <span className="text-xs tracking-wide">activity</span>
        </div>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-600">{messages.length} events</span>
      </div>

      {/* Terminal Output */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg, idx) => (
          <div key={idx} className="group">
            <div className="flex items-baseline gap-2">
              <span
                className={`text-xs font-bold ${msg.role === 'proq' ? 'text-steel' : 'text-patina-dark dark:text-patina'}`}
              >
                {msg.role === 'proq' ? '\u25C6' : '\u276F'}
              </span>
              <span
                className={`text-xs font-semibold ${msg.role === 'proq' ? 'text-steel' : 'text-patina-dark dark:text-patina'}`}
              >
                {msg.role === 'proq' ? 'Professor Q' : 'You'}
              </span>
              <span className="text-[10px] text-gunmetal-500 dark:text-zinc-700 ml-auto opacity-0 group-hover:opacity-100">
                {formatTimestamp(msg.timestamp)}
              </span>
            </div>

            <div className="pl-5 mt-0.5">
              {msg.role === 'proq' && msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mb-2 space-y-0.5 border-l border-gunmetal-300 dark:border-zinc-800 ml-0.5 pl-3">
                  {msg.toolCalls.map((tc, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-1.5 text-[11px] text-gunmetal-500 dark:text-zinc-600 leading-snug"
                    >
                      <span className="text-gunmetal-500 dark:text-zinc-700 mt-px shrink-0">{'\u23BF'}</span>
                      <span>{tc.action ? `${tc.action} ${tc.detail}` : tc.detail}</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[13px] leading-relaxed text-gunmetal-700 dark:text-zinc-400">{msg.message}</p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Terminal Input */}
      <div className="px-4 py-5 border-t border-gunmetal-300/60 dark:border-zinc-800/60 bg-gunmetal-200/20 dark:bg-black/20">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <span className="text-patina-dark dark:text-patina text-sm font-bold select-none">{'\u276F'}</span>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="message..."
            className="flex-1 bg-transparent text-[13px] text-gunmetal-800 dark:text-zinc-200 placeholder:text-gunmetal-500 dark:placeholder:text-zinc-700 focus:outline-none caret-patina-dark dark:caret-patina"
          />
          <button
            type="submit"
            disabled={!inputValue.trim()}
            className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <CornerDownLeftIcon className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
