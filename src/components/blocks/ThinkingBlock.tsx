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
        className="flex items-center gap-2.5 w-full px-1.5 py-2 text-left hover:bg-bronze-100/60 dark:hover:bg-zinc-800/40 rounded transition-colors"
      >
        <BrainIcon className="w-3.5 h-3.5 shrink-0 text-bronze-400 dark:text-zinc-600" />
        <span className="text-xs text-bronze-500 dark:text-zinc-500 italic truncate min-w-0 flex-1">
          {firstLine || 'Thinking...'}
        </span>
        <ChevronRightIcon className={`w-3.5 h-3.5 shrink-0 text-bronze-400 dark:text-zinc-600 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>
      {isOpen && (
        <div className="ml-8 mr-1 mb-2 mt-1 text-xs text-bronze-500 dark:text-zinc-500 italic font-mono whitespace-pre-wrap leading-relaxed border-l-2 border-bronze-300 dark:border-zinc-800 pl-3 max-h-64 overflow-y-auto">
          {thinking}
        </div>
      )}
    </div>
  );
}
