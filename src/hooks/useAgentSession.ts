'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentBlock, AgentWsServerMsg, TaskAttachment } from '@/lib/types';
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
  sendFollowUp: (text: string, attachments?: TaskAttachment[]) => void;
  approvePlan: (text: string) => void;
  stop: () => void;
}

export function useAgentSession(
  taskId: string,
  projectId: string,
  staticLog?: AgentBlock[],
): UseAgentSessionResult {
  const [blocks, setBlocks] = useState<AgentBlock[]>(staticLog || []);
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(!staticLog);
  const wsRef = useRef<WebSocket | null>(null);
  const { streamingText, appendDelta, clearBuffer } = useStreamingBuffer();

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

      const wsHost = window.location.hostname;
      const url = `ws://${wsHost}:${getWsPort()}/ws/agent?taskId=${taskId}&projectId=${projectId}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          gotMessage = true;
          const msg: AgentWsServerMsg = JSON.parse(event.data);

          if (msg.type === 'replay') {
            clearBuffer();
            retryCount = 0;
            setBlocks(msg.blocks);
            setActive(msg.active);
          } else if (msg.type === 'stream_delta') {
            appendDelta(msg.text);
          } else if (msg.type === 'block') {
            retryCount = 0;
            if (msg.block.type === 'text' || msg.block.type === 'user') {
              clearBuffer();
            }
            setBlocks((prev) => {
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
        // If we never got a successful message (connection refused / WS server down), retry
        if (!gotMessage && retryCount < MAX_RETRIES && !cancelled) {
          retryCount++;
          retryTimer = setTimeout(connect, RETRY_DELAY_MS);
        } else if (!gotMessage && !cancelled) {
          // Exhausted retries without ever connecting — mark not active so UI doesn't hang
          setActive(false);
        }
      };

      ws.onerror = () => {
        // onerror is always followed by onclose, which handles retry
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
    };
  }, [taskId, projectId, staticLog]);

  const sendFollowUp = useCallback((text: string, attachments?: TaskAttachment[]) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'followup', text, attachments }));
    }
  }, []);

  const approvePlan = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'plan-approve', text }));
    }
  }, []);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }));
    }
  }, []);

  return { blocks, streamingText, connected, active, sendFollowUp, approvePlan, stop };
}
