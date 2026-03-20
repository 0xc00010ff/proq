'use client';

import React, { useState } from 'react';
import { FileTextIcon } from 'lucide-react';

interface TaskUpdateBlockProps {
  summary: string;
  nextSteps?: string;
}

export function TaskUpdateBlock({ summary, nextSteps }: TaskUpdateBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = summary.split('\n').filter(Boolean);
  const preview = lines.slice(0, 2).join('\n');
  const hasMore = lines.length > 2;

  return (
    <div className="my-2 rounded-md border border-lazuli/25 bg-lazuli/5 px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs font-medium text-lazuli-dark dark:text-lazuli mb-1">
        <FileTextIcon className="w-3.5 h-3.5" />
        Agent updated task
      </div>
      <div className="text-[11px] text-text-secondary font-mono whitespace-pre-wrap">
        {expanded ? lines.join('\n') : preview}
        {hasMore && (<>
          {' '}<span
            className="text-text-placeholder hover:underline cursor-pointer"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '(show less)' : `(+${lines.length - 2} more)`}
          </span>
        </>)}
      </div>
      {nextSteps && (
        <div className="mt-1.5 pt-1.5 border-t border-lazuli/15 text-[11px] text-lazuli-dark dark:text-lazuli/80 font-mono whitespace-pre-wrap">
          Next steps: {expanded ? nextSteps.split('\n').filter(Boolean).join('\n') : nextSteps.split('\n')[0]}
        </div>
      )}
    </div>
  );
}
