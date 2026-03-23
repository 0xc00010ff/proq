'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownIcon, Loader2Icon } from 'lucide-react';
import type { AgentBlock } from '@/lib/types';
import { groupBlocks, type RenderItem, type ToolResultBlock } from '@/lib/agent-blocks';
import { ScrambleText } from './ScrambleText';
import { TextBlock } from './blocks/TextBlock';
import { ThinkingBlock } from './blocks/ThinkingBlock';
import { ToolBlock } from './blocks/ToolBlock';
import { ToolGroupBlock } from './blocks/ToolGroupBlock';
import { StatusBlock } from './blocks/StatusBlock';
import { UserBlock } from './blocks/UserBlock';
import { AskQuestionBlock } from './blocks/AskQuestionBlock';
import { PlanApprovalBlock } from './blocks/PlanApprovalBlock';

export interface AgentBlockListProps {
  blocks: AgentBlock[];
  streamingText: string;
  isRunning: boolean;
  isThinking: boolean;
  showCosts?: boolean;
  mapToolUse?: (block: Extract<AgentBlock, { type: 'tool_use' }>, idx: number, toolResultMap: Map<string, ToolResultBlock>) => RenderItem | null;
  /** Render a custom block (e.g. TaskUpdateBlock). Return null to skip. */
  renderCustomBlock?: (block: AgentBlock, idx: number) => React.ReactNode;
  onAnswer?: (answer: string) => void;
  onApprovePlan?: (text: string) => void;
  onRejectPlan?: (feedback: string) => void;
  emptyState?: React.ReactNode;
  showLoading?: boolean;
  className?: string;
}

export function AgentBlockList({
  blocks,
  streamingText,
  isRunning,
  isThinking,
  showCosts,
  mapToolUse,
  renderCustomBlock,
  onAnswer,
  onApprovePlan,
  onRejectPlan,
  emptyState,
  showLoading,
  className,
}: AgentBlockListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Auto-scroll to bottom on new blocks unless user scrolled up
  useEffect(() => {
    if (!userScrolledUp && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [blocks, streamingText, userScrolledUp]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setUserScrolledUp(!isAtBottom);
  };

  const jumpToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setUserScrolledUp(false);
    }
  };

  const renderItems = groupBlocks(blocks, mapToolUse);

  return (
    <div className={`relative flex-1 min-h-0 ${className || ''}`}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-y-auto px-4 py-4 space-y-1"
      >
        {/* Empty state */}
        {emptyState}

        {/* Loading indicator */}
        {showLoading && blocks.length === 0 && isRunning && (
          <div className="flex items-center gap-2 py-2 text-xs text-text-tertiary">
            <Loader2Icon className="w-3.5 h-3.5 text-bronze-500 animate-spin" />
            <span>Starting session...</span>
          </div>
        )}

        {renderItems.map((item, ri) => {
          if (item.kind === 'ask_question') {
            const questions = Array.isArray(item.input.questions) ? item.input.questions as { question: string; header?: string; options: { label: string; description: string }[]; multiSelect?: boolean }[] : [];
            return (
              <AskQuestionBlock
                key={`ask-${item.idx}`}
                questions={questions}
                hasResult={!!item.result}
                resultText={item.result?.output}
                isOld={blocks.slice(item.idx + 1).some(b => b.type === 'user')}
                onAnswer={(answer) => onAnswer?.(answer)}
              />
            );
          }
          if (item.kind === 'plan_approval') {
            return (
              <PlanApprovalBlock
                key={`plan-${item.idx}`}
                input={item.input}
                planContent={item.planContent}
                planFilePath={item.planFilePath}
                alreadyResponded={item.alreadyResponded}
                onApprove={() => onApprovePlan?.('Plan approved. Proceed with implementation.')}
                onReject={(feedback) => onRejectPlan?.(feedback)}
              />
            );
          }
          if (item.kind === 'tool_group') {
            if (item.items.length === 1) {
              const t = item.items[0];
              return (
                <ToolBlock
                  key={`tool-${t.idx}`}
                  toolId={t.toolId}
                  name={t.name}
                  input={t.input}
                  result={t.result}
                  forceCollapsed={undefined}
                />
              );
            }
            return (
              <ToolGroupBlock
                key={`tg-${ri}`}
                toolName={item.toolName}
                items={item.items}
                forceCollapsed={undefined}
              />
            );
          }

          const block = item.block;
          const idx = item.idx;

          // Try custom block renderer first
          if (renderCustomBlock) {
            const custom = renderCustomBlock(block, idx);
            if (custom) return custom;
          }

          switch (block.type) {
            case 'text':
              return <TextBlock key={idx} text={block.text} />;
            case 'thinking':
              return <ThinkingBlock key={idx} thinking={block.thinking} forceCollapsed={undefined} />;
            case 'user':
              return <UserBlock key={idx} text={block.text} attachments={block.attachments} />;
            case 'status':
              return (
                <StatusBlock
                  key={idx}
                  subtype={block.subtype}
                  sessionId={block.sessionId}
                  model={block.model}
                  costUsd={showCosts ? block.costUsd : undefined}
                  durationMs={block.durationMs}
                  turns={block.turns}
                  error={block.error}
                  timestamp={block.timestamp}
                />
              );
            default:
              return null;
          }
        })}

        {/* Streaming text */}
        {streamingText && <TextBlock text={streamingText} />}

        {/* Thinking indicator */}
        {isThinking && (
          <div className="py-2">
            <ScrambleText text="Thinking..." />
          </div>
        )}
      </div>

      {/* Jump to bottom */}
      {userScrolledUp && (
        <button
          onClick={jumpToBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1.5 text-[10px] font-medium text-text-secondary bg-surface-hover border border-border-strong rounded-full shadow-lg hover:bg-border-strong z-10"
        >
          <ArrowDownIcon className="w-3 h-3" />
          Jump to bottom
        </button>
      )}
    </div>
  );
}
