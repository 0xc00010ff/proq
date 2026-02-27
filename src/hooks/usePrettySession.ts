'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { PrettyBlock, PrettyWsServerMsg } from '@/lib/types';

const WS_PORT = process.env.NEXT_PUBLIC_WS_PORT || '42069';

interface UsePrettySessionResult {
  blocks: PrettyBlock[];
  connected: boolean;
  sessionDone: boolean;
  sendFollowUp: (text: string) => void;
  stop: () => void;
}

export function usePrettySession(
  taskId: string,
  projectId: string,
  staticLog?: PrettyBlock[],
): UsePrettySessionResult {
  const [blocks, setBlocks] = useState<PrettyBlock[]>(staticLog || []);
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
    const url = `ws://${wsHost}:${WS_PORT}/ws/pretty?taskId=${taskId}&projectId=${projectId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg: PrettyWsServerMsg = JSON.parse(event.data);

        if (msg.type === 'replay') {
          setBlocks(msg.blocks);
          // Check if session is already done
          const hasComplete = msg.blocks.some(
            (b) => b.type === 'status' && (b.subtype === 'complete' || b.subtype === 'error' || b.subtype === 'abort')
          );
          if (hasComplete) setSessionDone(true);
        } else if (msg.type === 'block') {
          setBlocks((prev) => [...prev, msg.block]);
          if (msg.block.type === 'status' && (msg.block.subtype === 'complete' || msg.block.subtype === 'error' || msg.block.subtype === 'abort')) {
            setSessionDone(true);
          }
        } else if (msg.type === 'error') {
          // No session — might be loaded from DB already in replay
          console.log('[usePrettySession] server error:', msg.error);
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

  const sendFollowUp = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'followup', text }));
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
