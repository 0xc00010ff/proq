'use client';

import React, { useState } from 'react';
import {
  ChevronRightIcon,
  TerminalSquareIcon,
  FileTextIcon,
  PencilIcon,
  FileOutputIcon,
  SearchIcon,
  FolderTreeIcon,
  GlobeIcon,
  WrenchIcon,
  Loader2Icon,
} from 'lucide-react';
import type { PrettyBlock } from '@/lib/types';
import { ToolBlock, cleanToolName } from './ToolBlock';

const TOOL_ICONS: Record<string, React.ReactNode> = {
  Bash: <TerminalSquareIcon className="w-3.5 h-3.5" />,
  Read: <FileTextIcon className="w-3.5 h-3.5" />,
  Edit: <PencilIcon className="w-3.5 h-3.5" />,
  Write: <FileOutputIcon className="w-3.5 h-3.5" />,
  Grep: <SearchIcon className="w-3.5 h-3.5" />,
  Glob: <FolderTreeIcon className="w-3.5 h-3.5" />,
  Task: <FolderTreeIcon className="w-3.5 h-3.5" />,
  WebFetch: <GlobeIcon className="w-3.5 h-3.5" />,
  WebSearch: <GlobeIcon className="w-3.5 h-3.5" />,
};

function getToolIcon(name: string) {
  return TOOL_ICONS[cleanToolName(name)] || <WrenchIcon className="w-3.5 h-3.5" />;
}

/** Past-tense verb for each tool, used in group summaries */
const TOOL_VERBS: Record<string, string> = {
  Read: 'Read',
  Edit: 'Edited',
  Write: 'Wrote',
  Bash: 'Ran',
  Grep: 'Grepped',
  Glob: 'Globbed',
  Task: 'Ran',
  WebFetch: 'Fetched',
  WebSearch: 'Searched',
};

/** Noun for what each tool operates on */
const TOOL_NOUNS: Record<string, [string, string]> = {
  Read: ['file', 'files'],
  Edit: ['file', 'files'],
  Write: ['file', 'files'],
  Bash: ['command', 'commands'],
  Grep: ['pattern', 'patterns'],
  Glob: ['pattern', 'patterns'],
  Task: ['task', 'tasks'],
  WebFetch: ['URL', 'URLs'],
  WebSearch: ['query', 'queries'],
};

function getItemSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write': {
      const fp = input.file_path as string || '';
      // Show just filename
      return fp.split('/').pop() || fp;
    }
    case 'Bash':
      return (input.command as string || '').slice(0, 40);
    case 'Grep':
      return `${input.pattern || ''}`;
    case 'Glob':
      return `${input.pattern || ''}`;
    case 'Task':
      return (input.description as string || '').slice(0, 30);
    case 'WebFetch':
      return `${input.url || ''}`;
    case 'WebSearch':
      return `${input.query || ''}`;
    default:
      return name;
  }
}

export interface ToolGroupItem {
  toolId: string;
  name: string;
  input: Record<string, unknown>;
  result?: Extract<PrettyBlock, { type: 'tool_result' }>;
}

interface ToolGroupBlockProps {
  toolName: string;
  items: ToolGroupItem[];
  forceCollapsed?: boolean;
}

export function ToolGroupBlock({ toolName, items, forceCollapsed }: ToolGroupBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const count = items.length;
  const allComplete = items.every(i => i.result);
  const anyError = items.some(i => i.result?.isError);
  const isActive = !allComplete;

  const clean = cleanToolName(toolName);
  const verb = TOOL_VERBS[clean] || clean;
  const [singular, plural] = TOOL_NOUNS[clean] || ['call', 'calls'];
  const noun = count === 1 ? singular : plural;

  // Build preview: first 2 summaries + "... N total" if more
  const summaries = items.map(i => getItemSummary(i.name, i.input));
  const previewCount = 2;
  const preview = summaries.length <= previewCount
    ? summaries.join(', ')
    : summaries.slice(0, previewCount).join(', ') + `, +${summaries.length - previewCount} more`;

  const isOpen = forceCollapsed === true ? false : expanded;

  return (
    <div className="group/toolgroup">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2.5 w-full px-1.5 py-2 text-left hover:bg-bronze-100/60 dark:hover:bg-zinc-800/40 rounded transition-colors"
      >
        {/* Status dot */}
        <span className="shrink-0">
          {isActive ? (
            <Loader2Icon className="w-3.5 h-3.5 text-steel animate-spin" />
          ) : (
            <span className={`block w-2 h-2 rounded-full ${anyError ? 'bg-red-400' : 'bg-patina-dark dark:bg-patina'}`} />
          )}
        </span>

        {/* Tool icon */}
        <span className={`shrink-0 ${isActive ? 'text-steel' : anyError ? 'text-red-400' : 'text-bronze-500 dark:text-zinc-500'}`}>
          {getToolIcon(toolName)}
        </span>

        {/* Group summary */}
        <span className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-xs font-medium text-bronze-700 dark:text-zinc-300 shrink-0">
            {verb} {count} {noun}
          </span>
          <span className="text-xs text-bronze-500 dark:text-zinc-500 truncate">
            {preview}
          </span>
        </span>

        {/* Count badge */}
        <span className="shrink-0 text-[10px] font-medium text-bronze-400 dark:text-zinc-600 bg-bronze-200/60 dark:bg-zinc-800/60 rounded px-1.5 py-0.5 tabular-nums">
          {count}
        </span>

        {/* Chevron */}
        <ChevronRightIcon className={`w-3.5 h-3.5 shrink-0 text-bronze-400 dark:text-zinc-600 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      {isOpen && (
        <div className="ml-4 border-l border-bronze-200/60 dark:border-zinc-800/60">
          {items.map((item) => (
            <ToolBlock
              key={item.toolId}
              toolId={item.toolId}
              name={item.name}
              input={item.input}
              result={item.result}
              forceCollapsed={forceCollapsed}
            />
          ))}
        </div>
      )}
    </div>
  );
}
