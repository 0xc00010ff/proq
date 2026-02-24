'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { SquareChevronUpIcon, Trash2Icon } from 'lucide-react';
import { ChatPanel, type StreamingMessage } from '@/components/ChatPanel';
import type { ChatLogEntry, ToolCall } from '@/lib/types';

export default function SupervisorPage() {
  const [messages, setMessages] = useState<ChatLogEntry[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Load history on mount
  useEffect(() => {
    fetch('/api/supervisor')
      .then((res) => res.json())
      .then((data) => {
        if (data.chatLog) setMessages(data.chatLog);
      })
      .catch(console.error);
  }, []);

  const handleSendMessage = useCallback(async (text: string) => {
    // Optimistic user message
    const userEntry: ChatLogEntry = {
      role: 'user',
      message: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userEntry]);
    setIsLoading(true);
    setStreamingMessage({ toolCalls: [], text: '' });

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch('/api/supervisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accText = '';
      const accToolCalls: ToolCall[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            if (chunk.type === 'text_delta') {
              accText += chunk.text;
              setStreamingMessage({ toolCalls: [...accToolCalls], text: accText });
            } else if (chunk.type === 'tool_call') {
              accToolCalls.push({ action: chunk.action, detail: chunk.detail });
              setStreamingMessage({ toolCalls: [...accToolCalls], text: accText });
            } else if (chunk.type === 'result' && !accText) {
              accText = chunk.text;
              setStreamingMessage({ toolCalls: [...accToolCalls], text: accText });
            } else if (chunk.type === 'error') {
              accText += (accText ? '\n' : '') + `Error: ${chunk.error}`;
              setStreamingMessage({ toolCalls: [...accToolCalls], text: accText });
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      // Commit final message
      const finalEntry: ChatLogEntry = {
        role: 'proq',
        message: accText || '(no response)',
        timestamp: new Date().toISOString(),
        toolCalls: accToolCalls.length > 0 ? accToolCalls : undefined,
      };
      setMessages((prev) => [...prev, finalEntry]);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const errorEntry: ChatLogEntry = {
          role: 'proq',
          message: `Error: ${err}`,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorEntry]);
      }
    } finally {
      setStreamingMessage(null);
      setIsLoading(false);
      abortRef.current = null;
    }
  }, []);

  const handleClear = useCallback(async () => {
    await fetch('/api/supervisor', { method: 'DELETE' });
    setMessages([]);
  }, []);

  return (
    <>
      <header className="h-16 bg-bronze-50 dark:bg-zinc-950 flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <SquareChevronUpIcon className="w-5 h-5 text-bronze-500" />
          <h1 className="text-lg font-semibold text-bronze-900 dark:text-zinc-100 leading-tight">Supervisor</h1>
        </div>
        <button
          onClick={handleClear}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Clear chat history"
        >
          <Trash2Icon className="w-3.5 h-3.5" />
          Clear
        </button>
      </header>
      <main className="flex-1 flex flex-col overflow-hidden">
        <ChatPanel
          messages={messages}
          onSendMessage={handleSendMessage}
          streamingMessage={streamingMessage}
          isLoading={isLoading}
          style={{ flex: 1 }}
        />
      </main>
    </>
  );
}
