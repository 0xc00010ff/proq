'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RotateCcwIcon } from 'lucide-react';
import type { AgentBlock, TaskAttachment, TaskMode, FollowUpDraft } from '@/lib/types';
import { useAgentSession } from '@/hooks/useAgentSession';
import { isSessionEnded, type RenderItem, type ToolResultBlock } from '@/lib/agent-blocks';
import { AgentBlockList } from './AgentBlockList';
import { AgentInputBar, type AgentInputBarHandle } from './AgentInputBar';
import { TaskUpdateBlock } from './blocks/TaskUpdateBlock';
import { useFileDrop } from '@/hooks/useFileDrop';

interface StructuredPaneProps {
  taskId: string;
  projectId: string;
  visible: boolean;
  taskStatus?: string;
  agentStatus?: string | null;
  agentBlocks?: AgentBlock[];
  initialBlocks?: AgentBlock[];
  taskMode?: TaskMode;
  onModeChange?: (mode: TaskMode) => void;
  followUpDraft?: FollowUpDraft;
  onFollowUpDraftChange?: (draft: FollowUpDraft | null) => void;
  onTaskStatusChange?: (status: string) => void;
}

export function StructuredPane({ taskId, projectId, visible, taskStatus, agentStatus, agentBlocks, initialBlocks, taskMode, onModeChange, followUpDraft, onFollowUpDraftChange, onTaskStatusChange }: StructuredPaneProps) {
  const { blocks, streamingText, active, sendFollowUp, sendInterrupt, approvePlan, stop } = useAgentSession(taskId, projectId, agentBlocks, initialBlocks);

  const inputRef = useRef<AgentInputBarHandle>(null);
  const [attachments, setAttachments] = useState<TaskAttachment[]>(followUpDraft?.attachments ?? []);
  const [showCosts, setShowCosts] = useState(false);
  const [localMode, setLocalMode] = useState<TaskMode>(taskMode || 'auto');

  // Sync local mode when prop changes (e.g. server-side plan->auto on approval)
  useEffect(() => {
    if (taskMode) setLocalMode(taskMode);
  }, [taskMode]);

  // Fetch showCosts setting on mount
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => { setShowCosts(!!s.showCosts); })
      .catch(() => {});
  }, []);

  // Sync input when draft is set externally (e.g., conflict resolution prompt)
  const prevDraftRef = useRef(followUpDraft?.text);
  const localChangeRef = useRef(false);
  useEffect(() => {
    if (localChangeRef.current) {
      localChangeRef.current = false;
      prevDraftRef.current = followUpDraft?.text;
      return;
    }
    if (followUpDraft?.text && followUpDraft.text !== prevDraftRef.current) {
      inputRef.current?.setValue(followUpDraft.text);
      setAttachments(followUpDraft.attachments ?? []);
    }
    prevDraftRef.current = followUpDraft?.text;
  }, [followUpDraft]);

  const handleDraftChange = useCallback((text: string) => {
    localChangeRef.current = true;
    if (text || attachments.length > 0) {
      onFollowUpDraftChange?.({ text, attachments });
    } else {
      onFollowUpDraftChange?.(null);
    }
  }, [attachments, onFollowUpDraftChange]);

  const handleAttachmentsChange = useCallback((atts: TaskAttachment[]) => {
    localChangeRef.current = true;
    setAttachments(atts);
    const text = inputRef.current?.getValue() ?? '';
    if (text || atts.length > 0) {
      onFollowUpDraftChange?.({ text, attachments: atts });
    } else {
      onFollowUpDraftChange?.(null);
    }
  }, [onFollowUpDraftChange]);

  const handleSend = useCallback((text: string, atts: TaskAttachment[]) => {
    const sent = sendFollowUp(text, atts.length > 0 ? atts : undefined, localMode);
    if (sent) {
      onFollowUpDraftChange?.(null);
    } else {
      // Keep text in input — WS is reconnecting
      inputRef.current?.setValue(text);
    }
  }, [sendFollowUp, onFollowUpDraftChange, localMode]);

  const handleInterrupt = useCallback((text: string, atts: TaskAttachment[]) => {
    const sent = sendInterrupt(text, atts.length > 0 ? atts : undefined);
    if (sent) {
      onFollowUpDraftChange?.(null);
    } else {
      inputRef.current?.setValue(text);
    }
  }, [sendInterrupt, onFollowUpDraftChange]);

  const handleModeChange = useCallback((m: TaskMode) => {
    setLocalMode(m);
    onModeChange?.(m);
  }, [onModeChange]);

  // Custom tool_use mapping: mcp__proq__update_task -> TaskUpdateBlock
  const mapToolUse = useCallback((block: Extract<AgentBlock, { type: 'tool_use' }>, idx: number, _toolResultMap: Map<string, ToolResultBlock>): RenderItem | null => {
    if (block.name === 'mcp__proq__update_task' && typeof block.input.summary === 'string') {
      return {
        kind: 'block',
        block: {
          type: 'task_update',
          summary: block.input.summary as string,
          nextSteps: block.input.nextSteps as string | undefined,
          timestamp: new Date().toISOString(),
        },
        idx,
      };
    }
    return null;
  }, []);

  // Render TaskUpdateBlock for custom block items
  const renderCustomBlock = useCallback((block: AgentBlock, idx: number) => {
    if (block.type === 'task_update') {
      return (
        <TaskUpdateBlock
          key={idx}
          summary={block.summary}
          nextSteps={block.nextSteps}
        />
      );
    }
    return null;
  }, []);

  const { isDragOver, dropProps, dismiss: dismissDrag } = useFileDrop(attachments, handleAttachmentsChange, projectId);

  if (!visible) return null;

  const sessionEnded = isSessionEnded(blocks);
  const isRunning = !sessionEnded && (active || agentStatus === 'running' || agentStatus === 'starting');
  const isThinking = isRunning && !streamingText && blocks.length > 0;

  const readOnlyMessage = taskStatus === 'done' ? (
    <div className="flex items-center justify-between rounded-xl border border-border-strong bg-surface-detail px-4 py-3">
      <span className="text-xs text-text-tertiary">This task is read-only. Move back to Verify to resume editing.</span>
      <button
        onClick={() => onTaskStatusChange?.('verify')}
        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary bg-surface-hover border border-border-strong rounded-lg hover:bg-border-strong"
      >
        <RotateCcwIcon className="w-3 h-3" />
        Resume editing
      </button>
    </div>
  ) : undefined;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-deep relative" {...dropProps}>
      {isDragOver && (
        <div className="absolute inset-0 bg-bronze-600/20 dark:bg-bronze-600/15 border-2 border-bronze-600/50 flex items-center justify-center z-20 rounded-md cursor-pointer" onClick={dismissDrag}>
          <div className="text-sm text-text-secondary font-medium bg-bronze-400 dark:bg-bronze-800 border border-bronze-500 dark:border-bronze-700 px-4 py-2 rounded-md shadow-sm pointer-events-none">Drop files here</div>
        </div>
      )}
      <AgentBlockList
        blocks={blocks}
        streamingText={streamingText}
        isRunning={isRunning}
        isThinking={isThinking}
        showCosts={showCosts}
        mapToolUse={mapToolUse}
        renderCustomBlock={renderCustomBlock}
        onAnswer={(answer) => sendFollowUp(answer, undefined, localMode)}
        onApprovePlan={(text) => approvePlan(text)}
        onRejectPlan={(feedback) => sendFollowUp(`Plan rejected. ${feedback}`, undefined, localMode)}
        showLoading
      />

      <AgentInputBar
        ref={inputRef}
        isRunning={isRunning}
        defaultValue={followUpDraft?.text ?? ''}
        onDraftChange={handleDraftChange}
        attachments={attachments}
        onAttachmentsChange={handleAttachmentsChange}
        onSend={handleSend}
        onStop={stop}
        onInterrupt={handleInterrupt}
        mode={localMode}
        onModeChange={handleModeChange}
        readOnlyMessage={readOnlyMessage}
      />
    </div>
  );
}
