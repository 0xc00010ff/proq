'use client';

import React from 'react';
import type { Project } from '@/lib/types';
import { ThemeToggle } from './ThemeToggle';

export type TabOption = 'project' | 'live' | 'code';

interface TopBarProps {
  project: Project;
  activeTab: TabOption;
  onTabChange: (tab: TabOption) => void;
}

export function TopBar({ project, activeTab, onTabChange }: TopBarProps) {
  const tabs: { id: TabOption; label: string }[] = [
    { id: 'project', label: 'Project' },
    { id: 'live', label: 'Live' },
    { id: 'code', label: 'Code' },
  ];

  return (
    <header className="h-16 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex flex-col justify-center">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">
          {project.name}
        </h1>
        <span className="text-xs font-mono text-zinc-500 mt-0.5">
          {project.path}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg flex items-center border border-zinc-200 dark:border-zinc-800">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`relative px-4 py-1.5 text-sm font-medium rounded-md z-10 ${
                  isActive ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                {isActive && (
                  <div
                    className="absolute inset-0 bg-white dark:bg-zinc-800 rounded-md border border-zinc-300/50 dark:border-zinc-700/50 shadow-sm"
                    style={{ zIndex: -1 }}
                  />
                )}
                {tab.label}
              </button>
            );
          })}
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
