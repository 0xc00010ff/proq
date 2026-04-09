'use client';

import React, { useState } from 'react';
import { FileIcon, XIcon } from 'lucide-react';
import type { TaskAttachment } from '@/lib/types';
import { attachmentUrl } from '@/lib/upload';

export function UserBlock({ text, attachments }: { text: string; attachments?: TaskAttachment[] }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  return (
    <div className="flex items-baseline gap-2 my-3">
      <div className="inline-flex flex-col bg-surface-topbar rounded px-2.5 py-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold text-text-chrome shrink-0">{'\u276F'}</span>
          <p className="text-sm leading-relaxed text-text-primary whitespace-pre-wrap">{text}</p>
        </div>
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5 ml-4">
            {attachments.map((att) => {
              const url = att.url || (att.filePath ? attachmentUrl(att.filePath) : undefined);
              const isImage = att.type?.startsWith('image/') && url;
              return isImage ? (
                <button
                  key={att.id}
                  type="button"
                  onClick={() => setPreviewUrl(url)}
                  className="rounded overflow-hidden border border-border-strong/50 bg-surface-hover/60 cursor-pointer hover:border-border-strong transition-colors"
                >
                  <img src={url} alt={att.name} className="h-16 w-auto max-w-[100px] object-cover block" />
                </button>
              ) : (
                <div key={att.id} className="flex items-center gap-1.5 bg-surface-hover/60 border border-border-strong/50 rounded px-2 py-1">
                  <FileIcon className="w-3 h-3 text-text-tertiary shrink-0" />
                  <span className="text-[10px] text-text-secondary truncate max-w-[100px]">{att.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-pointer"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            onClick={() => setPreviewUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <XIcon className="w-5 h-5" />
          </button>
          <img
            src={previewUrl}
            alt="Preview"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
