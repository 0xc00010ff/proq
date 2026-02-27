'use client';

import React from 'react';

export function UserBlock({ text }: { text: string }) {
  return (
    <div className="flex items-baseline gap-2 my-3">
      <div className="inline-flex items-baseline gap-2 bg-bronze-200/60 dark:bg-zinc-800/50 rounded px-2.5 py-1.5">
        <span className="text-xs font-bold text-bronze-500 shrink-0">{'\u276F'}</span>
        <p className="text-sm leading-relaxed text-bronze-800 dark:text-zinc-300">{text}</p>
      </div>
    </div>
  );
}
