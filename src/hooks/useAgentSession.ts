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
  sessionDone: boolean;
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
  const [sessionDone, setSessionDone] = useState(!!staticLog);
  const wsRef = useRef<WebSocket | null>(null);
  const { streamingText, appendDelta, clearBuffer } = useStreamingBuffer();

  // If static log, just use it directly
  useEffect(() => {
    if (staticLog) {
      setBlocks(staticLog);
      setSessionDone(true);
      return;
    }

    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

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
          const msg: AgentWsServerMsg = JSON.parse(event.data);

          if (msg.type === 'replay') {
            retryCount = 0; // successful — reset retries
            clearBuffer();
            setBlocks(msg.blocks);
            // If the server says the session is not live (historical blocks from disk),
            // mark as done immediately — no agent process is running.
            if (msg.live === false) {
              setSessionDone(true);
            } else if (msg.blocks.length === 0) {
              setSessionDone(true);
            } else {
              // Live session — check if agent is between turns or still working
              const statusBlocks = msg.blocks.filter(
                (b) => b.type === 'status' && ['complete', 'error', 'abort', 'init'].includes(b.subtype)
              );
              const lastStatus = statusBlocks[statusBlocks.length - 1];
              const lastStatusIdx = lastStatus ? msg.blocks.lastIndexOf(lastStatus) : -1;
              const hasUserAfter = msg.blocks.slice(lastStatusIdx + 1).some((b) => b.type === 'user');
              const isDone = lastStatus?.type === 'status' && lastStatus.subtype !== 'init' && !hasUserAfter;
              setSessionDone(isDone);
            }
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
            if (msg.block.type === 'status' && msg.block.subtype === 'init' || msg.block.type === 'user') {
              // New turn starting (follow-up or initial) — reset done state
              setSessionDone(false);
            } else if (msg.block.type === 'status' && (msg.block.subtype === 'complete' || msg.block.subtype === 'error' || msg.block.subtype === 'abort')) {
              setSessionDone(true);
            }
          } else if (msg.type === 'error') {
            // Session not ready yet — retry with backoff
            console.log('[useAgentSession] server error:', msg.error);
            if (retryCount < MAX_RETRIES && !cancelled) {
              retryCount++;
              ws.close();
              retryTimer = setTimeout(connect, RETRY_DELAY_MS);
            } else {
              // Exhausted retries — mark as done so the UI doesn't hang
              setSessionDone(true);
            }
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

  return { blocks, streamingText, connected, sessionDone, sendFollowUp, approvePlan, stop };
}
