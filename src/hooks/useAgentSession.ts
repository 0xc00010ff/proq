'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentBlock, AgentWsServerMsg, TaskAttachment, TaskMode } from '@/lib/types';
import { useStreamingBuffer } from './useStreamingBuffer';

function getWsPort(): string {
  return (typeof window !== 'undefined' && (window as unknown as { __PROQ_WS_PORT?: string }).__PROQ_WS_PORT) || '42069';
}
const MAX_RETRIES = 15;
const RETRY_DELAY_MS = 2000;

interface UseAgentSessionResult {
  blocks: AgentBlock[];
  streamingText: string;
  connected: boolean;
  active: boolean;
  sendFollowUp: (text: string, attachments?: TaskAttachment[], mode?: TaskMode) => boolean;
  sendInterrupt: (text: string, attachments?: TaskAttachment[]) => boolean;
  approvePlan: (text: string) => boolean;
  stop: () => void;
}

export function useAgentSession(
  taskId: string,
  projectId: string,
  staticLog?: AgentBlock[],
  initialBlocks?: AgentBlock[],
): UseAgentSessionResult {
  const [blocks, setBlocks] = useState<AgentBlock[]>(staticLog || initialBlocks || []);
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(!(staticLog || initialBlocks));
  const wsRef = useRef<WebSocket | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  const { streamingText, appendDelta, clearBuffer } = useStreamingBuffer();

  // Seed blocks from initialBlocks when they arrive (HTTP fetch completes after mount).
  // Unlike staticLog, initialBlocks still allows the WebSocket to connect for follow-ups.
  useEffect(() => {
    if (initialBlocks && initialBlocks.length > 0) {
      setBlocks(prev => prev.length === 0 ? initialBlocks : prev);
      setActive(prev => prev ? prev : false);
    }
  }, [initialBlocks]);

  // If static log, just use it directly (no WebSocket)
  useEffect(() => {
    if (staticLog) {
      setBlocks(staticLog);
      setActive(false);
      return;
    }

    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let gotMessage = false;

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
      const url = `ws://${wsHost}:${getWsPort()}/ws/agent?taskId=${taskId}&projectId=${projectId}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryCount = 0;
      };

      ws.onmessage = (event) => {
        try {
          gotMessage = true;
          const msg: AgentWsServerMsg = JSON.parse(event.data);

          if (msg.type === 'replay') {
            clearBuffer();
            retryCount = 0;
            // Don't replace pre-seeded blocks (initialBlocks) with an empty WS replay
            setBlocks(prev => msg.blocks.length > 0 ? msg.blocks : (prev.length > 0 ? prev : msg.blocks));
            setActive(msg.active);
          } else if (msg.type === 'stream_delta') {
            appendDelta(msg.text);
          } else if (msg.type === 'block') {
            retryCount = 0;
            if (msg.block.type === 'text' || msg.block.type === 'user') {
              clearBuffer();
            }
            setBlocks((prev) => {
              // Dedup: skip user block if we already appended it optimistically
              if (msg.block.type === 'user') {
                const last = prev[prev.length - 1];
                if (last?.type === 'user' && (last as Extract<typeof last, { type: 'user' }>).text === (msg.block as Extract<typeof msg.block, { type: 'user' }>).text) {
                  return prev;
                }
              }
              // Dedup: if a tool_use block with the same toolId already exists, replace it
              // (e.g. server may re-broadcast an enriched ExitPlanMode block)
              if (msg.block.type === 'tool_use' && msg.block.toolId) {
                const existingIdx = prev.findIndex(
                  (b) => b.type === 'tool_use' && (b as Extract<typeof b, { type: 'tool_use' }>).toolId === (msg.block as Extract<typeof msg.block, { type: 'tool_use' }>).toolId
                );
                if (existingIdx !== -1) {
                  const updated = [...prev];
                  updated[existingIdx] = msg.block;
                  return updated;
                }
              }
              return [...prev, msg.block];
            });
            setActive(msg.active);
          } else if (msg.type === 'active') {
            setActive(msg.active);
          } else if (msg.type === 'error') {
            // Session not ready yet — retry with backoff
            console.log('[useAgentSession] server error:', msg.error);
            if (retryCount < MAX_RETRIES && !cancelled) {
              retryCount++;
              ws.close();
              retryTimer = setTimeout(connect, RETRY_DELAY_MS);
            } else {
              // Exhausted retries — mark as not active so the UI doesn't hang
              setActive(false);
            }
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        // Retry on any drop (initial or post-connection) with backoff
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          retryTimer = setTimeout(connect, RETRY_DELAY_MS);
        } else if (!gotMessage) {
          // Exhausted retries without ever connecting — mark not active so UI doesn't hang
          setActive(false);
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
  }, [taskId, projectId, staticLog]);

  const sendFollowUp = useCallback((text: string, attachments?: TaskAttachment[], mode?: TaskMode): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'followup', text, attachments, mode }));
      // Optimistically show the user message and thinking/stop immediately
      setBlocks((prev) => [...prev, { type: 'user' as const, text, attachments }]);
      setActive(true);
      return true;
    }
    // Connection dead — trigger reconnect
    connectRef.current?.();
    return false;
  }, []);

  const sendInterrupt = useCallback((text: string, attachments?: TaskAttachment[]): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'interrupt', text, attachments }));
      // Optimistically show that the session will continue
      setActive(true);
      return true;
    }
    connectRef.current?.();
    return false;
  }, []);

  const approvePlan = useCallback((text: string): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'plan-approve', text }));
      setActive(true);
      return true;
    }
    connectRef.current?.();
    return false;
  }, []);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }));
    } else {
      // WS not connected — fall back to HTTP PATCH to move task back to todo (triggers abort)
      fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'todo' }),
      }).catch(() => {});
    }
  }, [projectId, taskId]);

  return { blocks, streamingText, connected, active, sendFollowUp, sendInterrupt, approvePlan, stop };
}
