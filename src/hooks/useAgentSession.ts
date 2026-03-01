'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentBlock, AgentWsServerMsg, TaskAttachment } from '@/lib/types';

const WS_PORT = process.env.NEXT_PUBLIC_WS_PORT || '42069';

interface UseAgentSessionResult {
  blocks: AgentBlock[];
  connected: boolean;
  sessionDone: boolean;
  sendFollowUp: (text: string, attachments?: TaskAttachment[]) => void;
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

  // If static log, just use it directly
  useEffect(() => {
    if (staticLog) {
      setBlocks(staticLog);
      setSessionDone(true);
      return;
    }

    const wsHost = window.location.hostname;
    const url = `ws://${wsHost}:${WS_PORT}/ws/agent?taskId=${taskId}&projectId=${projectId}`;
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
          // Check if session is done — look at last status block and user blocks
          // A user block after the last complete/error/abort means a follow-up is pending
          const statusBlocks = msg.blocks.filter(
            (b) => b.type === 'status' && ['complete', 'error', 'abort', 'init'].includes(b.subtype)
          );
          const lastStatus = statusBlocks[statusBlocks.length - 1];
          const lastStatusIdx = lastStatus ? msg.blocks.lastIndexOf(lastStatus) : -1;
          const hasUserAfter = msg.blocks.slice(lastStatusIdx + 1).some((b) => b.type === 'user');
          const isDone = lastStatus?.type === 'status' && lastStatus.subtype !== 'init' && !hasUserAfter;
          setSessionDone(isDone);
        } else if (msg.type === 'block') {
          setBlocks((prev) => [...prev, msg.block]);
          if (msg.block.type === 'status' && msg.block.subtype === 'init' || msg.block.type === 'user') {
            // New turn starting (follow-up or initial) — reset done state
            setSessionDone(false);
          } else if (msg.block.type === 'status' && (msg.block.subtype === 'complete' || msg.block.subtype === 'error' || msg.block.subtype === 'abort')) {
            setSessionDone(true);
          }
        } else if (msg.type === 'error') {
          // No session — might be loaded from DB already in replay
          console.log('[useAgentSession] server error:', msg.error);
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
  }, [taskId, projectId, staticLog]);

  const sendFollowUp = useCallback((text: string, attachments?: TaskAttachment[]) => {
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

  return { blocks, connected, sessionDone, sendFollowUp, stop };
}
