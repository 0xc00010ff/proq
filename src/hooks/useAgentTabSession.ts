'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentBlock, AgentWsServerMsg, TaskAttachment } from '@/lib/types';
import { useStreamingBuffer } from './useStreamingBuffer';

function getWsPort(): string {
  return (typeof window !== 'undefined' && (window as unknown as { __PROQ_WS_PORT?: string }).__PROQ_WS_PORT) || '42069';
}

interface UseAgentTabSessionResult {
  blocks: AgentBlock[];
  streamingText: string;
  connected: boolean;
  sessionDone: boolean;
  loaded: boolean;
  sendMessage: (text: string, attachments?: TaskAttachment[], mode?: string) => void;
  sendInterrupt: (text: string, attachments?: TaskAttachment[]) => void;
  approvePlan: (text: string) => void;
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
  const { streamingText, appendDelta, clearBuffer } = useStreamingBuffer();

  useEffect(() => {
    const wsHost = window.location.hostname;
    const url = `ws://${wsHost}:${getWsPort()}/ws/agent-tab?tabId=${tabId}&projectId=${projectId}${agentId ? `&agentId=${agentId}` : ''}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
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
    };

    ws.onerror = () => {
      setConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [tabId, projectId]);

  const sendMessage = useCallback((text: string, attachments?: TaskAttachment[], mode?: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'followup', text, attachments, mode }));
    }
  }, []);

  const sendInterrupt = useCallback((text: string, attachments?: TaskAttachment[]) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'interrupt', text, attachments }));
      setSessionDone(false);
    }
  }, []);

  const approvePlan = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'plan-approve', text }));
      setSessionDone(false);
    }
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
