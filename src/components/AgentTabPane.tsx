'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GitBranchIcon, PlayIcon, FlaskConicalIcon, RocketIcon } from 'lucide-react';
import type { TaskAttachment, TaskMode } from '@/lib/types';
import { useAgentTabSession } from '@/hooks/useAgentTabSession';
import { AgentBlockList } from './AgentBlockList';
import { AgentInputBar, type AgentInputBarHandle } from './AgentInputBar';
import { useFileDrop } from '@/hooks/useFileDrop';

// Persist drafts across project switches (survives unmount/remount)
const draftMap = new Map<string, string>();

/** Pre-fill a draft message for a given tab (works whether mounted or not) */
export function setAgentDraft(tabId: string, text: string) {
  draftMap.set(tabId, text);
  window.dispatchEvent(new CustomEvent('agent-draft', { detail: { tabId, text } }));
}

interface AgentTabPaneProps {
  tabId: string;
  projectId: string;
  visible: boolean;
}

export function AgentTabPane({ tabId, projectId, visible }: AgentTabPaneProps) {
  const { blocks, streamingText, sessionDone, loaded, sendMessage, sendInterrupt, approvePlan, stop, clear } = useAgentTabSession(tabId, projectId);

  const inputRef = useRef<AgentInputBarHandle>(null);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [mode, setMode] = useState<TaskMode>('auto');

  // Listen for clear events from the tab dropdown
  useEffect(() => {
    const handler = (e: Event) => {
      const { tabId: targetId, type } = (e as CustomEvent).detail;
      if (targetId === tabId && type === 'agent') clear();
    };
    window.addEventListener('workbench-clear-tab', handler);
    return () => window.removeEventListener('workbench-clear-tab', handler);
  }, [tabId, clear]);

  // Listen for external draft injections
  useEffect(() => {
    const handler = (e: Event) => {
      const { tabId: targetId, text } = (e as CustomEvent).detail;
      if (targetId === tabId) {
        inputRef.current?.setValue(text);
        draftMap.set(tabId, text);
      }
    };
    window.addEventListener('agent-draft', handler);
    return () => window.removeEventListener('agent-draft', handler);
  }, [tabId]);

  const handleDraftChange = useCallback((text: string) => {
    if (text) {
      draftMap.set(tabId, text);
    } else {
      draftMap.delete(tabId);
    }
  }, [tabId]);

  const handleAttachmentsChange = useCallback((atts: TaskAttachment[]) => {
    setAttachments(atts);
  }, []);

  const handleSend = useCallback((text: string, atts: TaskAttachment[]) => {
    sendMessage(text, atts.length > 0 ? atts : undefined, mode !== 'auto' ? mode : undefined);
    draftMap.delete(tabId);
  }, [sendMessage, tabId, mode]);

  const handleInterrupt = useCallback((text: string, atts: TaskAttachment[]) => {
    sendInterrupt(text, atts.length > 0 ? atts : undefined);
    draftMap.delete(tabId);
  }, [sendInterrupt, tabId]);

  const { isDragOver, dropProps } = useFileDrop(attachments, handleAttachmentsChange, projectId);

  if (!visible) return null;

  const isRunning = !sessionDone;
  const hasHistory = blocks.length > 0;
  const isThinking = isRunning && !streamingText && blocks.length > 0;

  const emptyState = !hasHistory && sessionDone && loaded ? (
    <div className="flex flex-col justify-end h-full gap-4 select-none pb-2">
      <div className="space-y-1">
        <p className="text-sm font-medium text-text-secondary">
          What can I help with?
        </p>
        <p className="text-xs text-text-placeholder">
          Ask me anything about this project, or try one of these:
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {([
          { icon: GitBranchIcon, label: 'Plan a feature', prompt: 'Help me plan the implementation of a new feature. Start by asking what I want to build. Once we have a plan, suggest creating one or more tasks on the board to track the work.' },
          { icon: PlayIcon, label: 'Start the server', prompt: 'Start the dev server for this project. Look at the package.json or equivalent to find the right command, then run it.' },
          { icon: FlaskConicalIcon, label: 'Test the app', prompt: 'Run the test suite for this project. Look at the package.json or equivalent to find the right test command, then run it and report the results.' },
          { icon: RocketIcon, label: 'Deploy', prompt: 'Help me deploy this project. Look at the project configuration to understand the deploy process, then guide me through it or run the deploy command.' },
        ]).map(({ icon: Icon, label, prompt }) => (
          <button
            key={label}
            onClick={() => sendMessage(prompt)}
            title={prompt}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border-strong/30 bg-surface-hover/30 hover:bg-surface-hover hover:border-border-strong/60 text-left transition-colors group"
          >
            <Icon className="w-4 h-4 text-text-placeholder group-hover:text-bronze-500 shrink-0 transition-colors" />
            <span className="text-xs text-text-tertiary group-hover:text-text-secondary transition-colors">{label}</span>
          </button>
        ))}
      </div>
    </div>
  ) : undefined;

  return (
    <div className="absolute inset-0 flex flex-col bg-surface-deep font-sans" {...dropProps}>
      {isDragOver && (
        <div className="absolute inset-0 bg-bronze-600/20 dark:bg-bronze-600/15 border-2 border-bronze-600/50 flex items-center justify-center pointer-events-none z-20 rounded-md">
          <div className="text-sm text-text-secondary font-medium bg-bronze-400 dark:bg-bronze-800 border border-bronze-500 dark:border-bronze-700 px-4 py-2 rounded-md shadow-sm">Drop files here</div>
        </div>
      )}
      <AgentBlockList
        blocks={blocks}
        streamingText={streamingText}
        isRunning={isRunning}
        isThinking={isThinking}
        onAnswer={(answer) => sendMessage(answer)}
        onApprovePlan={(text) => { approvePlan(text); setMode('auto'); }}
        onRejectPlan={(feedback) => sendMessage(`Plan rejected. ${feedback}`)}
        emptyState={emptyState}
        showLoading
      />

      <AgentInputBar
        ref={inputRef}
        isRunning={isRunning}
        defaultValue={draftMap.get(tabId) || ''}
        onDraftChange={handleDraftChange}
        attachments={attachments}
        onAttachmentsChange={handleAttachmentsChange}
        onSend={handleSend}
        onStop={stop}
        onInterrupt={handleInterrupt}
        mode={mode}
        onModeChange={setMode}
        maxHeight={300}
      />
    </div>
  );
}
