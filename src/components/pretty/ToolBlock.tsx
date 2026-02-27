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
  ClipboardCopyIcon,
  CheckIcon,
} from 'lucide-react';
import type { PrettyBlock } from '@/lib/types';

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
  return TOOL_ICONS[name] || <WrenchIcon className="w-3.5 h-3.5" />;
}

function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
      return (input.file_path as string || 'file');
    case 'Edit':
      return (input.file_path as string || 'file');
    case 'Write':
      return (input.file_path as string || 'file');
    case 'Bash':
      return (input.command as string || '').slice(0, 80);
    case 'Grep':
      return `${input.pattern || ''}`;
    case 'Glob':
      return `${input.pattern || ''}`;
    case 'Task':
      return (input.description as string || input.prompt as string || '').slice(0, 60);
    case 'WebFetch':
      return `${input.url || ''}`;
    case 'WebSearch':
      return `${input.query || ''}`;
    default:
      return name;
  }
}

const MAX_OUTPUT_LINES = 50;

interface ToolBlockProps {
  toolId: string;
  name: string;
  input: Record<string, unknown>;
  result?: Extract<PrettyBlock, { type: 'tool_result' }>;
  forceCollapsed?: boolean;
}

export function ToolBlock({ toolId, name, input, result, forceCollapsed }: ToolBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [showFullOutput, setShowFullOutput] = useState(false);
  const [copied, setCopied] = useState(false);

  const isActive = !result;
  const isError = result?.isError;
  const summary = getToolSummary(name, input);

  const outputLines = result?.output?.split('\n') || [];
  const isTruncated = outputLines.length > MAX_OUTPUT_LINES && !showFullOutput;
  const visibleOutput = isTruncated
    ? outputLines.slice(0, MAX_OUTPUT_LINES).join('\n')
    : result?.output || '';

  const isOpen = forceCollapsed === true ? false : expanded;

  return (
    <div className="group/tool">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2.5 w-full px-1.5 py-2 text-left hover:bg-bronze-100/60 dark:hover:bg-zinc-800/40 rounded transition-colors"
      >
        {/* Status dot */}
        <span className="shrink-0">
          {isActive ? (
            <Loader2Icon className="w-3.5 h-3.5 text-steel animate-spin" />
          ) : (
            <span className={`block w-2 h-2 rounded-full ${isError ? 'bg-red-400' : 'bg-patina-dark dark:bg-patina'}`} />
          )}
        </span>

        {/* Tool icon */}
        <span className={`shrink-0 ${isActive ? 'text-steel' : isError ? 'text-red-400' : 'text-bronze-500 dark:text-zinc-500'}`}>
          {getToolIcon(name)}
        </span>

        {/* Tool name + summary */}
        <span className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-xs font-medium text-bronze-700 dark:text-zinc-300 shrink-0">{name}</span>
          <span className="text-xs text-bronze-500 dark:text-zinc-500 truncate">{summary}</span>
        </span>

        {/* Chevron on far right */}
        <ChevronRightIcon className={`w-3.5 h-3.5 shrink-0 text-bronze-400 dark:text-zinc-600 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      {isOpen && (
        <div className="ml-8 mr-1 mb-2 mt-1 space-y-2.5">
          {/* Input */}
          <div>
            <div className="text-[10px] font-medium text-bronze-500 dark:text-zinc-600 uppercase tracking-wide mb-1">Input</div>
            <pre className="text-[11px] font-mono text-bronze-700 dark:text-zinc-400 bg-bronze-200/40 dark:bg-zinc-900/60 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>

          {/* Output */}
          {result && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-medium text-bronze-500 dark:text-zinc-600 uppercase tracking-wide">Output</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(result.output || '');
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="ml-auto text-bronze-500 dark:text-zinc-600 hover:text-bronze-700 dark:hover:text-zinc-400 transition-colors p-0.5"
                >
                  {copied ? (
                    <CheckIcon className="w-3 h-3 text-patina" />
                  ) : (
                    <ClipboardCopyIcon className="w-3 h-3" />
                  )}
                </button>
              </div>
              <pre className={`text-[11px] font-mono rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto ${
                isError
                  ? 'text-red-400 bg-red-500/10'
                  : 'text-bronze-700 dark:text-zinc-400 bg-bronze-200/40 dark:bg-zinc-900/60'
              }`}>
                {visibleOutput}
              </pre>
              {isTruncated && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowFullOutput(true);
                  }}
                  className="text-[10px] text-steel hover:text-steel/80 mt-1"
                >
                  Show {outputLines.length - MAX_OUTPUT_LINES} more lines
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
