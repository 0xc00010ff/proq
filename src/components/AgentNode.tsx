'use client';

import React, { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { BotIcon, Loader2Icon } from 'lucide-react';

export type AgentNodeData = {
  label: string;
  role?: string;
  runningCount: number;
};

export type AgentNodeType = Node<AgentNodeData, 'agent'>;

export const AgentNode = memo(({ data, selected }: NodeProps<AgentNodeType>) => {
  const isActive = data.runningCount > 0;

  return (
    <div
      className={`bg-surface-secondary border rounded-lg px-4 py-3 min-w-[160px] max-w-[220px] transition-colors cursor-grab active:cursor-grabbing ${
        selected
          ? 'border-border-strong shadow-sm'
          : isActive
            ? 'border-bronze-500/40'
            : 'border-border-default hover:border-border-hover'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-md bg-surface-hover flex items-center justify-center shrink-0">
          <BotIcon className="w-3.5 h-3.5 text-text-chrome" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-text-primary truncate">{data.label}</div>
          {data.role && (
            <div className="text-[10px] text-text-tertiary truncate mt-0.5">{data.role}</div>
          )}
        </div>
      </div>
      {isActive && (
        <div className="mt-2 pt-2 border-t border-border-subtle/60 flex items-center gap-1.5">
          <Loader2Icon className="w-2.5 h-2.5 text-bronze-500 animate-spin" />
          <span className="text-[10px] text-bronze-500 font-medium">
            {data.runningCount} task{data.runningCount > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
});

AgentNode.displayName = 'AgentNode';
