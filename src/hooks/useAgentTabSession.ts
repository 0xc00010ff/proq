'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentBlock, AgentWsServerMsg, TaskAttachment } from '@/lib/types';
import { useStreamingBuffer } from './useStreamingBuffer';

function getWsPort(): string {
  return (typeof window !== 'undefined' && (window as unknown as { __PROQ_WS_PORT?: string }).__PROQ_WS_PORT) || '42069';
}

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECTS = 15;

interface UseAgentTabSessionResult {
  blocks: AgentBlock[];
  streamingText: string;
  connected: boolean;
  sessionDone: boolean;
  loaded: boolean;
  sendMessage: (text: string, attachments?: TaskAttachment[], mode?: string) => boolean;
  sendInterrupt: (text: string, attachments?: TaskAttachment[]) => boolean;
  approvePlan: (text: string) => boolean;
  stop: () => void;
  clear: () => void;
}

export function useAgentTabSession(
  tabId: string,
  projectId: string,
  agentId?: string,
): UseAgentTabSessionResult {
  const [blocks, setBlocks] = useState<AgentBlock[]>([]);
  const [connected, setConnected] = useState(false);
  const [sessionDone, setSessionDone] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  const { streamingText, appendDelta, clearBuffer } = useStreamingBuffer();

  useEffect(() => {
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }

      // Close stale socket before reconnecting — detach handlers first
      // so the old onclose doesn't schedule a competing retry
      if (wsRef.current) {
        const old = wsRef.current;
        old.onclose = null;
        old.onerror = null;
        old.onmessage = null;
        try { old.close(); } catch {}
        wsRef.current = null;
      }

      const wsHost = window.location.hostname;
      const url = `ws://${wsHost}:${getWsPort()}/ws/agent-tab?tabId=${tabId}&projectId=${projectId}${agentId ? `&agentId=${agentId}` : ''}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryCount = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg: AgentWsServerMsg = JSON.parse(event.data);

          if (msg.type === 'replay') {
            clearBuffer();
            setBlocks(msg.blocks);
            // Determine session done state
            const statusBlocks = msg.blocks.filter(
              (b) => b.type === 'status' && ['complete', 'error', 'abort', 'init'].includes(b.subtype)
            );
            const lastStatus = statusBlocks[statusBlocks.length - 1];
            const lastStatusIdx = lastStatus ? msg.blocks.lastIndexOf(lastStatus) : -1;
            const hasUserAfter = msg.blocks.slice(lastStatusIdx + 1).some((b) => b.type === 'user');
            const isDone = !lastStatus || (lastStatus.type === 'status' && lastStatus.subtype !== 'init' && !hasUserAfter);
            setSessionDone(isDone);
            setLoaded(true);
          } else if (msg.type === 'stream_delta') {
            appendDelta(msg.text);
          } else if (msg.type === 'block') {
            if (msg.block.type === 'text' || msg.block.type === 'user') {
              clearBuffer();
            }
            setBlocks((prev) => [...prev, msg.block]);
            if (msg.block.type === 'status' && msg.block.subtype === 'init' || msg.block.type === 'user') {
              setSessionDone(false);
            } else if (msg.block.type === 'status' && (msg.block.subtype === 'complete' || msg.block.subtype === 'error' || msg.block.subtype === 'abort')) {
              setSessionDone(true);
            }
          } else if (msg.type === 'error') {
            console.log('[useAgentTabSession] server error:', msg.error);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        if (retryCount < MAX_RECONNECTS) {
          retryCount++;
          retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = () => {
        // onerror is always followed by onclose, which handles retry
      };
    }

    connectRef.current = connect;
    connect();

    // Reconnect when tab becomes visible after sleep/background
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && !cancelled) {
        const ws = wsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          if (retryTimer) clearTimeout(retryTimer);
          retryCount = 0;
          connect();
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      connectRef.current = null;
      if (retryTimer) clearTimeout(retryTimer);
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [tabId, projectId, agentId]);

  const sendMessage = useCallback((text: string, attachments?: TaskAttachment[], mode?: string): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'followup', text, attachments, mode }));
      return true;
    }
    connectRef.current?.();
    return false;
  }, []);

  const sendInterrupt = useCallback((text: string, attachments?: TaskAttachment[]): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'interrupt', text, attachments }));
      setSessionDone(false);
      return true;
    }
    connectRef.current?.();
    return false;
  }, []);

  const approvePlan = useCallback((text: string): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'plan-approve', text }));
      setSessionDone(false);
      return true;
    }
    connectRef.current?.();
    return false;
  }, []);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }));
    }
  }, []);

  const clear = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'clear' }));
    }
  }, []);

  return { blocks, streamingText, connected, sessionDone, loaded, sendMessage, sendInterrupt, approvePlan, stop, clear };
}
