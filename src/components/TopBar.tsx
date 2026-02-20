'use client';

import React from 'react';
import type { Project, ProjectTab } from '@/lib/types';
import { ThemeToggle } from './ThemeToggle';

export type TabOption = ProjectTab;

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
    <header className="h-16 border-b border-border-default bg-surface-base flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex flex-col justify-center">
        <h1 className="text-lg font-semibold text-gunmetal-900 dark:text-zinc-100 leading-tight">
          {project.path.replace(/\/+$/, "").split("/").pop() || project.name}
        </h1>
        <span className="text-xs font-mono text-zinc-500 mt-0.5">
          {project.path}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="bg-surface-secondary p-1 rounded-lg flex items-center border border-border-default">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`relative px-4 py-1.5 text-sm font-medium rounded-md z-10 ${
                  isActive ? 'text-text-chrome-active' : 'text-text-chrome hover:text-text-chrome-hover'
                }`}
              >
                {isActive && (
                  <div
                    className="absolute inset-0 bg-gunmetal-50 dark:bg-zinc-800/60 rounded-md border border-gunmetal-400/50 dark:border-gunmetal-800/50 shadow-sm"
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
