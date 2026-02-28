'use client';

import React from 'react';
import { FileIcon } from 'lucide-react';
import type { TaskAttachment } from '@/lib/types';

export function UserBlock({ text, attachments }: { text: string; attachments?: TaskAttachment[] }) {
  return (
    <div className="flex items-baseline gap-2 my-3">
      <div className="inline-flex flex-col bg-bronze-200/60 dark:bg-zinc-800/50 rounded px-2.5 py-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold text-bronze-500 shrink-0">{'\u276F'}</span>
          <p className="text-sm leading-relaxed text-bronze-800 dark:text-zinc-300">{text}</p>
        </div>
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5 ml-4">
            {attachments.map((att) => {
              const isImage = att.type?.startsWith('image/') && att.dataUrl;
              return isImage ? (
                <div key={att.id} className="rounded overflow-hidden border border-bronze-400/40 dark:border-zinc-700/50 bg-bronze-200/60 dark:bg-zinc-800/60">
                  <img src={att.dataUrl} alt={att.name} className="h-16 w-auto max-w-[100px] object-cover block" />
                </div>
              ) : (
                <div key={att.id} className="flex items-center gap-1.5 bg-bronze-200/60 dark:bg-zinc-800/60 border border-bronze-400/40 dark:border-zinc-700/50 rounded px-2 py-1">
                  <FileIcon className="w-3 h-3 text-bronze-500 dark:text-zinc-500 shrink-0" />
                  <span className="text-[10px] text-bronze-700 dark:text-zinc-400 truncate max-w-[100px]">{att.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
