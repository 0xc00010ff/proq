'use client';

import React from 'react';
import { GitBranchIcon, ChevronDownIcon, CheckIcon } from 'lucide-react';
import type { Project, ProjectTab } from '@/lib/types';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

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
  const tabs: { id: TabOption; label: string }[] = [
    { id: 'project', label: 'Project' },
    { id: 'live', label: 'Live' },
    { id: 'code', label: 'Code' },
  ];

  const isOnPreviewBranch = currentBranch?.startsWith('proq/') ?? false;

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

  // Group branches: main/master, proq/* branches, others
  const mainBranches = sortedBranches.filter(b => b === 'main' || b === 'master');
  const proqBranches = sortedBranches.filter(b => b.startsWith('proq/'));
  const otherBranches = sortedBranches.filter(b => b !== 'main' && b !== 'master' && !b.startsWith('proq/'));

  return (
    <header className="h-16 bg-surface-base flex items-center px-6 flex-shrink-0">
      <div className="flex-1 flex flex-col justify-center min-w-0">
        <h1 className="text-lg font-semibold text-bronze-900 dark:text-zinc-100 leading-tight">
          {project.path.replace(/\/+$/, "").split("/").pop() || project.name}
        </h1>
        <span className="text-xs font-mono text-zinc-500 mt-0.5">
          {project.path}
        </span>
      </div>

      <div className="flex-1 flex justify-center min-w-0">
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

      <div className="flex-1 flex justify-end min-w-0">
        {/* Branch indicator + switcher */}
        {currentBranch && branches && branches.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono rounded-md border transition-colors outline-none ${
                  isOnPreviewBranch
                    ? 'border-gold/40 bg-surface-secondary text-gold shadow-[0_0_8px_rgba(201,168,76,0.1)] hover:text-gold-light hover:bg-surface-hover'
                    : 'border-border-default bg-surface-secondary text-text-chrome hover:text-text-chrome-hover hover:bg-surface-hover'
                }`}
              >
                <GitBranchIcon className={`w-3.5 h-3.5 ${isOnPreviewBranch ? 'text-gold' : ''}`} />
                <span className="max-w-[180px] truncate">
                  {isOnPreviewBranch && taskBranchMap?.[currentBranch!]
                    ? taskBranchMap[currentBranch!].split(/\s+/).slice(0, 4).join(' ')
                    : currentBranch}
                </span>
                <ChevronDownIcon className="w-3 h-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 max-h-64">
              <DropdownMenuLabel>Branches</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {mainBranches.map((branch) => (
                <BranchItem
                  key={branch}
                  branch={branch}
                  isCurrent={branch === currentBranch}
                  onSelect={() => onSwitchBranch?.(branch)}
                />
              ))}
              {proqBranches.length > 0 && mainBranches.length > 0 && (
                <DropdownMenuSeparator />
              )}
              {proqBranches.map((branch) => (
                <BranchItem
                  key={branch}
                  branch={branch}
                  isCurrent={branch === currentBranch}
                  taskTitle={taskBranchMap?.[branch]}
                  onSelect={() => onSwitchBranch?.(branch)}
                />
              ))}
              {otherBranches.length > 0 && (mainBranches.length > 0 || proqBranches.length > 0) && (
                <DropdownMenuSeparator />
              )}
              {otherBranches.map((branch) => (
                <BranchItem
                  key={branch}
                  branch={branch}
                  isCurrent={branch === currentBranch}
                  onSelect={() => onSwitchBranch?.(branch)}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

function BranchItem({ branch, isCurrent, taskTitle, onSelect }: {
  branch: string;
  isCurrent: boolean;
  taskTitle?: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={() => { if (!isCurrent) onSelect(); }}
      className={`text-xs gap-2 ${isCurrent ? 'text-text-chrome-active' : ''}`}
    >
      {isCurrent ? (
        <CheckIcon className="w-3 h-3 shrink-0" />
      ) : (
        <span className="w-3 shrink-0" />
      )}
      {taskTitle ? (
        <>
          <span className="truncate">{taskTitle}</span>
          <span className="ml-auto text-[10px] font-mono text-bronze-500 dark:text-zinc-600 truncate max-w-[100px]">
            {branch.replace('proq/', '')}
          </span>
        </>
      ) : (
        <span className="font-mono truncate">{branch}</span>
      )}
    </DropdownMenuItem>
  );
}
