'use client';

import React from 'react';
import { TerminalIcon, ExternalLinkIcon } from 'lucide-react';
import type { Project } from '@/lib/types';

interface CodeTabProps {
  project: Project;
}

export function CodeTab({ project }: CodeTabProps) {
  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-8">
      <div className="relative group cursor-pointer">
        <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-2xl blur opacity-20 group-hover:opacity-40" />
        <div className="relative w-24 h-24 bg-zinc-100 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-center shadow-2xl">
          <TerminalIcon className="w-10 h-10 text-zinc-900 dark:text-zinc-100" />
        </div>
      </div>

      <h2 className="mt-8 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Open in Cursor</h2>
      <p className="mt-2 text-zinc-500 font-mono text-sm bg-zinc-100 dark:bg-zinc-900 px-3 py-1 rounded border border-zinc-200 dark:border-zinc-800">
        {project.path}
      </p>

      <button className="mt-8 flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-md font-medium shadow-lg shadow-blue-900/20">
        <span>Launch Editor</span>
        <ExternalLinkIcon className="w-4 h-4" />
      </button>

      <p className="mt-6 text-xs text-zinc-400 dark:text-zinc-600 max-w-xs text-center">
        Opening this project will launch a new Cursor window with the AI context
        pre-loaded.
      </p>
    </div>
  );
}
