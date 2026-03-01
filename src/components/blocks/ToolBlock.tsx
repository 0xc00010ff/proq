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
import type { AgentBlock } from '@/lib/types';

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

/** Convert ugly MCP names like `mcp__proq__complete_task` → `Complete Task` */
export function cleanToolName(name: string): string {
  // Strip mcp__{server}__ prefix
  const stripped = name.replace(/^mcp__[^_]+__/, '');
  // If it still matches a known tool name, return as-is
  if (TOOL_ICONS[stripped] || ['Bash','Read','Edit','Write','Grep','Glob','Task','WebFetch','WebSearch'].includes(stripped)) {
    return stripped;
  }
  if (stripped !== name) {
    // Convert snake_case to Title Case
    return stripped.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  return name;
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

/** Renders a nice red/green diff view for Edit tool calls */
function EditDiffView({ input }: { input: Record<string, unknown> }) {
  const filePath = input.file_path as string || '';
  const oldStr = input.old_string as string || '';
  const newStr = input.new_string as string || '';
  const replaceAll = input.replace_all as boolean || false;

  const shortPath = filePath.split('/').slice(-2).join('/');

  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  // Find common prefix/suffix lines to show context vs changes
  let commonPrefix = 0;
  while (commonPrefix < oldLines.length && commonPrefix < newLines.length && oldLines[commonPrefix] === newLines[commonPrefix]) {
    commonPrefix++;
  }
  let commonSuffix = 0;
  while (
    commonSuffix < oldLines.length - commonPrefix &&
    commonSuffix < newLines.length - commonPrefix &&
    oldLines[oldLines.length - 1 - commonSuffix] === newLines[newLines.length - 1 - commonSuffix]
  ) {
    commonSuffix++;
  }

  const removedLines = oldLines.slice(commonPrefix, oldLines.length - commonSuffix);
  const addedLines = newLines.slice(commonPrefix, newLines.length - commonSuffix);
  const prefixLines = oldLines.slice(0, commonPrefix);
  const suffixLines = oldLines.slice(oldLines.length - commonSuffix);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] font-medium text-bronze-500 dark:text-zinc-600 uppercase tracking-wide">Diff</span>
        <span className="text-[10px] text-bronze-400 dark:text-zinc-600">{shortPath}</span>
        {replaceAll && <span className="text-[9px] bg-bronze-200/60 dark:bg-zinc-800 text-bronze-500 dark:text-zinc-500 px-1 rounded">replace all</span>}
      </div>
      <div className="text-[11px] font-mono bg-bronze-200/40 dark:bg-zinc-900/60 rounded overflow-x-auto max-h-64 overflow-y-auto">
        {prefixLines.map((line, i) => (
          <div key={`ctx-pre-${i}`} className="px-2 py-px text-bronze-600 dark:text-zinc-500 whitespace-pre-wrap">{line || '\u00A0'}</div>
        ))}
        {removedLines.map((line, i) => (
          <div key={`rm-${i}`} className="px-2 py-px bg-red-500/15 text-red-600 dark:text-red-400 whitespace-pre-wrap">
            <span className="select-none opacity-60 mr-1">-</span>{line || '\u00A0'}
          </div>
        ))}
        {addedLines.map((line, i) => (
          <div key={`add-${i}`} className="px-2 py-px bg-green-500/15 text-green-700 dark:text-green-400 whitespace-pre-wrap">
            <span className="select-none opacity-60 mr-1">+</span>{line || '\u00A0'}
          </div>
        ))}
        {suffixLines.map((line, i) => (
          <div key={`ctx-suf-${i}`} className="px-2 py-px text-bronze-600 dark:text-zinc-500 whitespace-pre-wrap">{line || '\u00A0'}</div>
        ))}
      </div>
    </div>
  );
}

interface ToolBlockProps {
  toolId: string;
  name: string;
  input: Record<string, unknown>;
  result?: Extract<AgentBlock, { type: 'tool_result' }>;
  forceCollapsed?: boolean;
}

export function ToolBlock({ toolId, name, input, result, forceCollapsed }: ToolBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [showFullOutput, setShowFullOutput] = useState(false);
  const [copied, setCopied] = useState(false);

  const isActive = !result;
  const isError = result?.isError;
  const displayName = cleanToolName(name);
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
            <Loader2Icon className="w-3.5 h-3.5 text-bronze-500 animate-spin" />
          ) : (
            <span className={`block w-2 h-2 rounded-full ${isError ? 'bg-red-400' : 'bg-patina-dark dark:bg-patina'}`} />
          )}
        </span>

        {/* Tool icon */}
        <span className={`shrink-0 ${isActive ? 'text-bronze-500' : isError ? 'text-red-400' : 'text-bronze-500 dark:text-zinc-500'}`}>
          {getToolIcon(name)}
        </span>

        {/* Tool name + summary */}
        <span className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-xs font-medium text-bronze-700 dark:text-zinc-300 shrink-0">{displayName}</span>
          <span className="text-xs text-bronze-500 dark:text-zinc-500 truncate">{summary}</span>
        </span>

        {/* Chevron on far right */}
        <ChevronRightIcon className={`w-3.5 h-3.5 shrink-0 text-bronze-400 dark:text-zinc-600 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      {isOpen && (
        <div className="ml-8 mr-1 mb-2 mt-1 space-y-2.5">
          {/* Input */}
          {name === 'Edit' ? (
            <EditDiffView input={input} />
          ) : (
          <div>
            <div className="text-[10px] font-medium text-bronze-500 dark:text-zinc-600 uppercase tracking-wide mb-1">Input</div>
            <pre className="text-[11px] font-mono text-bronze-700 dark:text-zinc-400 bg-bronze-200/40 dark:bg-zinc-900/60 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          )}

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
