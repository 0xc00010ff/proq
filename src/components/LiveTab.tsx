'use client';

import React from 'react';
import { GlobeIcon, MonitorIcon } from 'lucide-react';
import type { Project } from '@/lib/types';

interface LiveTabProps {
  project: Project;
}

export function LiveTab({ project }: LiveTabProps) {
  if (!project.serverUrl) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 p-8">
        <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mb-6 border border-zinc-200 dark:border-zinc-800">
          <MonitorIcon className="w-8 h-8 text-zinc-400 dark:text-zinc-600" />
        </div>
        <h3 className="text-lg font-medium text-zinc-800 dark:text-zinc-200 mb-2">
          No preview configured
        </h3>
        <p className="text-sm text-zinc-500 max-w-md text-center mb-8">
          Connect a development server URL to see a live preview of your
          application directly within Mission Control.
        </p>
        <div className="flex w-full max-w-sm items-center space-x-2">
          <input
            type="text"
            placeholder="http://localhost:3000"
            className="flex-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          />
          <button className="bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 rounded-md text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200">
            Connect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <div className="h-10 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center px-4 space-x-4">
        <div className="flex space-x-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
          <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400 flex items-center space-x-2 min-w-[300px] justify-center">
            <GlobeIcon className="w-3 h-3" />
            <span>{project.serverUrl}</span>
          </div>
        </div>
        <div className="w-16" />
      </div>
      <div className="flex-1 bg-white flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-zinc-100 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-pulse w-32 h-32 bg-zinc-200 rounded-full mx-auto mb-4" />
            <div className="h-4 w-48 bg-zinc-200 rounded mx-auto mb-2" />
            <div className="h-4 w-32 bg-zinc-200 rounded mx-auto" />
            <p className="mt-8 text-zinc-400 text-sm font-mono">
              Preview Mode: {project.serverUrl}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
