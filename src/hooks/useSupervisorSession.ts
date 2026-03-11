'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentBlock, AgentWsServerMsg, TaskAttachment } from '@/lib/types';

function getWsPort(): string {
  return (typeof window !== 'undefined' && (window as unknown as { __PROQ_WS_PORT?: string }).__PROQ_WS_PORT) || '42069';
}

interface UseSupervisorSessionResult {
  blocks: AgentBlock[];
  streamingText: string;
  connected: boolean;
  sessionDone: boolean;
  hasHistory: boolean;
  sendMessage: (text: string, attachments?: TaskAttachment[]) => void;
  stop: () => void;
  clear: () => Promise<void>;
}

export function useSupervisorSession(): UseSupervisorSessionResult {
  const [blocks, setBlocks] = useState<AgentBlock[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [connected, setConnected] = useState(false);
  const [sessionDone, setSessionDone] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const wsHost = window.location.hostname;
    const url = `ws://${wsHost}:${getWsPort()}/ws/supervisor`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg: AgentWsServerMsg = JSON.parse(event.data);

        if (msg.type === 'replay') {
          setBlocks(msg.blocks);
          setStreamingText('');
          // Determine session done state
          const statusBlocks = msg.blocks.filter(
            (b) => b.type === 'status' && ['complete', 'error', 'abort', 'init'].includes(b.subtype)
          );
          const lastStatus = statusBlocks[statusBlocks.length - 1];
          const lastStatusIdx = lastStatus ? msg.blocks.lastIndexOf(lastStatus) : -1;
          const hasUserAfter = msg.blocks.slice(lastStatusIdx + 1).some((b) => b.type === 'user');
          const isDone = !lastStatus || (lastStatus.type === 'status' && lastStatus.subtype !== 'init' && !hasUserAfter);
          setSessionDone(isDone);
        } else if (msg.type === 'stream_delta') {
          setStreamingText((prev) => prev + msg.text);
        } else if (msg.type === 'block') {
          if (msg.block.type === 'text' || msg.block.type === 'user') {
            setStreamingText('');
          }
          setBlocks((prev) => [...prev, msg.block]);
          if (msg.block.type === 'status' && msg.block.subtype === 'init' || msg.block.type === 'user') {
            setSessionDone(false);
          } else if (msg.block.type === 'status' && (msg.block.subtype === 'complete' || msg.block.subtype === 'error' || msg.block.subtype === 'abort')) {
            setSessionDone(true);
          }
        } else if (msg.type === 'error') {
          console.log('[useSupervisorSession] server error:', msg.error);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  const sendMessage = useCallback((text: string, attachments?: TaskAttachment[]) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'followup', text, attachments }));
    }
  }, []);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }));
    }
  }, []);

  const clear = useCallback(async () => {
    await fetch('/api/supervisor', { method: 'DELETE' });
    setBlocks([]);
    setSessionDone(true);
  }, []);

  const hasHistory = blocks.length > 0;

  return { blocks, streamingText, connected, sessionDone, hasHistory, sendMessage, stop, clear };
}

export type { UseSupervisorSessionResult };
