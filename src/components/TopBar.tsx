'use client';

import React, { useState, useRef, useEffect } from 'react';
import { GitBranchIcon, ChevronDownIcon, CheckIcon } from 'lucide-react';
import type { Project, ProjectTab } from '@/lib/types';

export type TabOption = ProjectTab;

interface TopBarProps {
  project: Project;
  activeTab: TabOption;
  onTabChange: (tab: TabOption) => void;
  currentBranch?: string;
  branches?: string[];
  taskBranchMap?: Record<string, string>;
  onSwitchBranch?: (branch: string) => void;
}

export function TopBar({ project, activeTab, onTabChange, currentBranch, branches, taskBranchMap, onSwitchBranch }: TopBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const tabs: { id: TabOption; label: string }[] = [
    { id: 'project', label: 'Project' },
    { id: 'live', label: 'Live' },
    { id: 'code', label: 'Code' },
  ];

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  // Sort branches: main first, then proq/* branches, then others
  const sortedBranches = branches ? [...branches].sort((a, b) => {
    if (a === 'main' || a === 'master') return -1;
    if (b === 'main' || b === 'master') return 1;
    const aIsProq = a.startsWith('proq/');
    const bIsProq = b.startsWith('proq/');
    if (aIsProq && !bIsProq) return -1;
    if (!aIsProq && bIsProq) return 1;
    return a.localeCompare(b);
  }) : [];

  return (
    <header className="h-16 bg-surface-base flex items-center px-6 flex-shrink-0">
      <div className="flex flex-col justify-center">
        <h1 className="text-lg font-semibold text-bronze-900 dark:text-zinc-100 leading-tight">
          {project.path.replace(/\/+$/, "").split("/").pop() || project.name}
        </h1>
        <span className="text-xs font-mono text-zinc-500 mt-0.5">
          {project.path}
        </span>
      </div>

      <div className="flex-1 flex justify-center">
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
                    className="absolute inset-0 bg-bronze-50 dark:bg-zinc-800/60 rounded-md border border-bronze-400/50 dark:border-bronze-800/50 shadow-sm"
                    style={{ zIndex: -1 }}
                  />
                )}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Branch indicator + switcher */}
      {currentBranch && branches && branches.length > 0 && (
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono rounded-md border border-border-default bg-surface-secondary text-text-chrome hover:text-text-chrome-hover hover:bg-surface-hover transition-colors"
          >
            <GitBranchIcon className="w-3.5 h-3.5" />
            <span className="max-w-[160px] truncate">
              {currentBranch}
            </span>
            <ChevronDownIcon className="w-3 h-3 opacity-50" />
          </button>

          {dropdownOpen && (
            <div className="absolute top-full right-0 mt-1 w-72 max-h-64 overflow-y-auto rounded-lg border border-border-default bg-surface-base shadow-xl shadow-black/30 z-50">
              {sortedBranches.map((branch) => {
                const isCurrent = branch === currentBranch;
                const taskTitle = taskBranchMap?.[branch];
                return (
                  <button
                    key={branch}
                    onClick={() => {
                      if (!isCurrent && onSwitchBranch) {
                        onSwitchBranch(branch);
                      }
                      setDropdownOpen(false);
                    }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:bg-surface-hover transition-colors ${
                      isCurrent ? 'text-text-chrome-active' : 'text-text-chrome'
                    }`}
                  >
                    {isCurrent ? (
                      <CheckIcon className="w-3 h-3 shrink-0" />
                    ) : (
                      <span className="w-3 shrink-0" />
                    )}
                    <span className="font-mono truncate">{branch}</span>
                    {taskTitle && (
                      <span className="ml-auto text-[10px] text-bronze-500 dark:text-zinc-600 truncate max-w-[120px]">
                        {taskTitle}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
