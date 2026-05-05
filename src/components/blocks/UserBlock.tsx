'use client';

import React, { useState } from 'react';
import { FileIcon, CopyIcon, CheckIcon } from 'lucide-react';
import type { TaskAttachment } from '@/lib/types';
import { attachmentUrl } from '@/lib/upload';
import { ImagePreview } from '@/components/ImagePreview';

export function UserBlock({ text, attachments }: { text: string; attachments?: TaskAttachment[] }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="group flex items-center gap-1.5 my-3">
      <div className="inline-flex flex-col bg-surface-secondary rounded px-2.5 py-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold text-text-chrome shrink-0">{'❯'}</span>
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
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label={copied ? 'Copied' : 'Copy message'}
        className="p-1 rounded text-text-placeholder hover:text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
      >
        {copied ? (
          <CheckIcon className="w-3.5 h-3.5 text-emerald" />
        ) : (
          <CopyIcon className="w-3.5 h-3.5" />
        )}
      </button>

      {previewUrl && <ImagePreview src={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </div>
  );
}
