'use client';

import React, { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { BotIcon } from 'lucide-react';

export type AgentNodeData = {
  label: string;
  role?: string;
  color: string;
  runningCount: number;
};

export type AgentNodeType = Node<AgentNodeData, 'agent'>;

export const AgentNode = memo(({ data, selected }: NodeProps<AgentNodeType>) => {
  return (
    <div
      className={`bg-surface-secondary border rounded-xl px-4 py-3 min-w-[160px] transition-all cursor-grab active:cursor-grabbing ${
        selected ? 'border-border-strong ring-2 ring-border-hover/30' : 'border-border-default hover:border-border-hover'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: data.color }}
        >
          <BotIcon className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary truncate">{data.label}</div>
          {data.role && (
            <div className="text-[11px] text-text-tertiary truncate">{data.role}</div>
          )}
        </div>
      </div>
      {data.runningCount > 0 && (
        <div className="mt-2 pt-2 border-t border-border-subtle">
          <span className="text-[10px] text-bronze-500 font-medium">
            {data.runningCount} task{data.runningCount > 1 ? 's' : ''} running
          </span>
        </div>
      )}
    </div>
  );
});

AgentNode.displayName = 'AgentNode';
