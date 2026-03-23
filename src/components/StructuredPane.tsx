'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RotateCcwIcon } from 'lucide-react';
import type { AgentBlock, TaskAttachment, TaskMode, FollowUpDraft } from '@/lib/types';
import { useAgentSession } from '@/hooks/useAgentSession';
import { isSessionEnded, type RenderItem, type ToolResultBlock } from '@/lib/agent-blocks';
import { AgentBlockList } from './AgentBlockList';
import { AgentInputBar } from './AgentInputBar';
import { TaskUpdateBlock } from './blocks/TaskUpdateBlock';

interface StructuredPaneProps {
  taskId: string;
  projectId: string;
  visible: boolean;
  taskStatus?: string;
  agentStatus?: string | null;
  agentBlocks?: AgentBlock[];
  taskMode?: TaskMode;
  onModeChange?: (mode: TaskMode) => void;
  followUpDraft?: FollowUpDraft;
  onFollowUpDraftChange?: (draft: FollowUpDraft | null) => void;
  onTaskStatusChange?: (status: string) => void;
}

export function StructuredPane({ taskId, projectId, visible, taskStatus, agentStatus, agentBlocks, taskMode, onModeChange, followUpDraft, onFollowUpDraftChange, onTaskStatusChange }: StructuredPaneProps) {
  const { blocks, streamingText, active, sendFollowUp, sendInterrupt, approvePlan, stop } = useAgentSession(taskId, projectId, agentBlocks);

  const [inputValue, setInputValue] = useState(followUpDraft?.text ?? '');
  const [attachments, setAttachments] = useState<TaskAttachment[]>(followUpDraft?.attachments ?? []);
  const [showCosts, setShowCosts] = useState(false);
  const [localMode, setLocalMode] = useState<TaskMode>(taskMode || 'auto');
  const localChangeRef = useRef(false);

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
  useEffect(() => {
    if (localChangeRef.current) {
      localChangeRef.current = false;
      prevDraftRef.current = followUpDraft?.text;
      return;
    }
    if (followUpDraft?.text && followUpDraft.text !== prevDraftRef.current) {
      setInputValue(followUpDraft.text);
      setAttachments(followUpDraft.attachments ?? []);
    }
    prevDraftRef.current = followUpDraft?.text;
  }, [followUpDraft]);

  const syncDraft = useCallback((text: string, atts: TaskAttachment[]) => {
    if (text || atts.length > 0) {
      onFollowUpDraftChange?.({ text, attachments: atts });
    } else {
      onFollowUpDraftChange?.(null);
    }
  }, [onFollowUpDraftChange]);

  const handleInputChange = useCallback((val: string) => {
    localChangeRef.current = true;
    setInputValue(val);
    syncDraft(val, attachments);
  }, [attachments, syncDraft]);

  const handleAttachmentsChange = useCallback((atts: TaskAttachment[]) => {
    localChangeRef.current = true;
    setAttachments(atts);
    syncDraft(inputValue, atts);
  }, [inputValue, syncDraft]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text && attachments.length === 0) return;
    sendFollowUp(text, attachments.length > 0 ? attachments : undefined);
    setInputValue('');
    setAttachments([]);
    onFollowUpDraftChange?.(null);
  }, [inputValue, attachments, sendFollowUp, onFollowUpDraftChange]);

  const handleInterrupt = useCallback(() => {
    const text = inputValue.trim();
    if (!text && attachments.length === 0) return;
    sendInterrupt(text, attachments.length > 0 ? attachments : undefined);
    setInputValue('');
    setAttachments([]);
    onFollowUpDraftChange?.(null);
  }, [inputValue, attachments, sendInterrupt, onFollowUpDraftChange]);

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
    <div className="flex-1 flex flex-col min-h-0 bg-surface-deep relative">
      <AgentBlockList
        blocks={blocks}
        streamingText={streamingText}
        isRunning={isRunning}
        isThinking={isThinking}
        showCosts={showCosts}
        mapToolUse={mapToolUse}
        renderCustomBlock={renderCustomBlock}
        onAnswer={(answer) => sendFollowUp(answer)}
        onApprovePlan={(text) => approvePlan(text)}
        onRejectPlan={(feedback) => sendFollowUp(`Plan rejected. ${feedback}`)}
        showLoading
      />

      <AgentInputBar
        isRunning={isRunning}
        value={inputValue}
        onChange={handleInputChange}
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
