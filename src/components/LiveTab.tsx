'use client';

import React, { useState } from 'react';
import { GlobeIcon, MonitorIcon } from 'lucide-react';
import type { Project } from '@/lib/types';
import { useProjects } from '@/components/ProjectsProvider';

interface LiveTabProps {
  project: Project;
}

export function LiveTab({ project }: LiveTabProps) {
  const [urlInput, setUrlInput] = useState('');
  const [barValue, setBarValue] = useState(project.serverUrl ?? '');
  const { refreshProjects } = useProjects();

  const handleConnect = async () => {
    const url = urlInput.trim();
    if (!url) return;
    await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl: url }),
    });
    await refreshProjects();
  };

  if (!project.serverUrl) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-gunmetal-100 dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 p-8">
        <div className="w-16 h-16 rounded-2xl bg-gunmetal-200 dark:bg-zinc-900 flex items-center justify-center mb-6 border border-gunmetal-300 dark:border-zinc-800">
          <MonitorIcon className="w-8 h-8 text-zinc-400 dark:text-zinc-600" />
        </div>
        <h3 className="text-lg font-medium text-gunmetal-800 dark:text-zinc-200 mb-2">
          No preview configured
        </h3>
        <p className="text-sm text-zinc-500 max-w-md text-center mb-8">
          Connect a development server URL to see a live preview of your
          application directly within proq.
        </p>
        <div className="flex w-full max-w-sm items-center space-x-2">
          <input
            type="text"
            placeholder="http://localhost:3000"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            className="flex-1 bg-gunmetal-200 dark:bg-zinc-900 border border-gunmetal-300 dark:border-zinc-800 rounded-md px-3 py-2 text-sm text-gunmetal-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-steel/50"
          />
          <button
            onClick={handleConnect}
            className="bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 rounded-md text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200"
          >
            Connect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full flex flex-col bg-gunmetal-100 dark:bg-zinc-950">
      <div className="h-10 bg-gunmetal-200 dark:bg-zinc-900 border-b border-gunmetal-300 dark:border-zinc-800 flex items-center px-4 space-x-4">
        <div className="flex space-x-1.5">
          <div className="w-3 h-3 rounded-full bg-crimson/20 border border-crimson/50" />
          <div className="w-3 h-3 rounded-full bg-gold/20 border border-gold/50" />
          <div className="w-3 h-3 rounded-full bg-patina/20 border border-patina/50" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="bg-gunmetal-50 dark:bg-zinc-950 border border-gunmetal-300 dark:border-zinc-800 rounded px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400 flex items-center space-x-2 min-w-[300px]">
            <GlobeIcon className="w-3 h-3 shrink-0" />
            <input
              type="text"
              value={barValue}
              onChange={(e) => setBarValue(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  const url = barValue.trim();
                  if (!url || url === project.serverUrl) return;
                  await fetch(`/api/projects/${project.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ serverUrl: url }),
                  });
                  await refreshProjects();
                }
              }}
              className="flex-1 bg-transparent text-xs text-zinc-500 dark:text-zinc-400 focus:text-zinc-800 dark:focus:text-zinc-200 outline-none"
            />
          </div>
        </div>
      </div>
      <iframe
        src={project.serverUrl}
        className="flex-1 w-full border-0"
      />
    </div>
  );
}
