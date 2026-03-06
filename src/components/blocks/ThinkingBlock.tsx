'use client';

import React, { useState } from 'react';
import { ChevronRightIcon, BrainIcon } from 'lucide-react';

export function ThinkingBlock({ thinking, forceCollapsed }: { thinking: string; forceCollapsed?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const firstLine = thinking.split('\n')[0];

  const isOpen = forceCollapsed === true ? false : expanded;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2.5 w-full px-1.5 py-2 text-left hover:bg-bronze-100/60 dark:hover:bg-surface-hover/40 rounded transition-colors"
      >
        <BrainIcon className="w-3.5 h-3.5 shrink-0 text-bronze-400 dark:text-text-placeholder" />
        <span className="text-xs text-bronze-500 dark:text-text-tertiary italic truncate min-w-0 flex-1">
          {firstLine || 'Thinking...'}
        </span>
        <ChevronRightIcon className={`w-3.5 h-3.5 shrink-0 text-bronze-400 dark:text-text-placeholder transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>
      {isOpen && (
        <div className="ml-8 mr-1 mb-2 mt-1 text-xs text-bronze-500 dark:text-text-tertiary italic font-mono whitespace-pre-wrap leading-relaxed border-l-2 border-bronze-300 dark:border-border-default pl-3 max-h-64 overflow-y-auto">
          {thinking}
        </div>
      )}
    </div>
  );
}
