'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function TextBlock({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed text-bronze-800 dark:text-zinc-300 py-2 px-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-bronze-900 dark:text-zinc-200">{children}</strong>,
          em: ({ children }) => <em className="text-bronze-700 dark:text-zinc-400">{children}</em>,
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-');
            if (isBlock) {
              return <code className={`${className} block bg-bronze-200/60 dark:bg-zinc-900 rounded px-3 py-2 text-[12px] font-mono text-bronze-800 dark:text-zinc-300 overflow-x-auto my-2`}>{children}</code>;
            }
            return <code className="bg-bronze-200/60 dark:bg-zinc-800/70 text-bronze-800 dark:text-zinc-300 rounded px-1 py-0.5 text-[12px] font-mono">{children}</code>;
          },
          pre: ({ children }) => <pre className="bg-bronze-200/60 dark:bg-zinc-900 rounded-md overflow-x-auto my-2">{children}</pre>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="text-bronze-700 dark:text-zinc-300">{children}</li>,
          a: ({ href, children }) => <a href={href} className="text-steel hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-bronze-400 dark:border-zinc-700 pl-3 text-bronze-600 dark:text-zinc-400 italic my-2">{children}</blockquote>,
          h1: ({ children }) => <h1 className="text-base font-semibold text-bronze-900 dark:text-zinc-200 mt-4 mb-2 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold text-bronze-900 dark:text-zinc-200 mt-3 mb-1.5 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-bronze-800 dark:text-zinc-300 mt-2.5 mb-1 first:mt-0">{children}</h3>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
