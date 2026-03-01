'use client';

import React from 'react';
import { FileTextIcon } from 'lucide-react';

interface TaskUpdateBlockProps {
  findings: string;
  humanSteps?: string;
}

export function TaskUpdateBlock({ findings, humanSteps }: TaskUpdateBlockProps) {
  // Show first 2 lines as a preview
  const lines = findings.split('\n').filter(Boolean);
  const preview = lines.slice(0, 2).join('\n');
  const hasMore = lines.length > 2;

  return (
    <div className="my-2 rounded-md border border-gold/25 bg-gold/5 px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs font-medium text-gold-dark dark:text-gold mb-1">
        <FileTextIcon className="w-3.5 h-3.5" />
        Agent updated task
      </div>
      <div className="text-[11px] text-bronze-600 dark:text-zinc-400 font-mono whitespace-pre-wrap">
        {preview}{hasMore && <span className="text-bronze-400 dark:text-zinc-600"> (+{lines.length - 2} more)</span>}
      </div>
      {humanSteps && (
        <div className="mt-1.5 pt-1.5 border-t border-gold/15 text-[11px] text-gold-dark dark:text-gold/80 font-mono">
          Steps for you: {humanSteps.split('\n')[0]}
        </div>
      )}
    </div>
  );
}
