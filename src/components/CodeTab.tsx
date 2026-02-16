'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import 'highlight.js/styles/github-dark.css';
import dynamic from 'next/dynamic';
import {
  ExternalLink,
  ChevronDown,
  Eye,
  Code,
  Loader2,
} from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { FileTree, type TreeNode } from './FileTree';
import type { Project } from '@/lib/types';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-zinc-500">
      <Loader2 className="w-5 h-5 animate-spin mr-2" />
      Loading editor...
    </div>
  ),
});

interface CodeTabProps {
  project: Project;
}

const OPEN_APPS = [
  { key: 'cursor', label: 'Cursor' },
  { key: 'vscode', label: 'VS Code' },
  { key: 'zed', label: 'Zed' },
  { key: 'warp', label: 'Warp' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'iterm', label: 'iTerm' },
  { key: 'finder', label: 'Finder' },
];

export function CodeTab({ project }: CodeTabProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [fileLanguage, setFileLanguage] = useState<string>('plaintext');
  const [loading, setLoading] = useState(false);
  const [mdView, setMdView] = useState<'raw' | 'pretty'>('pretty');
  const [openMenuOpen, setOpenMenuOpen] = useState(false);

  const isMarkdown = useMemo(() => {
    if (!selectedPath) return false;
    const ext = selectedPath.split('.').pop()?.toLowerCase();
    return ext === 'md' || ext === 'mdx';
  }, [selectedPath]);

  // Load file tree
  useEffect(() => {
    if (!project.path) return;
    fetch(`/api/files/tree?path=${encodeURIComponent(project.path)}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTree(data);
      })
      .catch(console.error);
  }, [project.path]);

  // Load file content
  const loadFile = useCallback(async (filePath: string) => {
    setSelectedPath(filePath);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/files/read?path=${encodeURIComponent(filePath)}`
      );
      const data = await res.json();
      if (data.error) {
        setFileContent(`// Error: ${data.error}`);
        setFileLanguage('plaintext');
      } else {
        setFileContent(data.content);
        setFileLanguage(data.language);
      }
    } catch {
      setFileContent('// Failed to load file');
      setFileLanguage('plaintext');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpenWith = useCallback(
    async (appKey: string) => {
      setOpenMenuOpen(false);
      try {
        await fetch('/api/files/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app: appKey, path: project.path }),
        });
      } catch (e) {
        console.error('Failed to open:', e);
      }
    },
    [project.path]
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-warm-50 dark:bg-zinc-950">
      {/* Sub-header bar */}
      <div className="h-10 flex-shrink-0 flex items-center justify-between px-3 border-b border-warm-300 dark:border-zinc-800 bg-warm-100 dark:bg-zinc-900/80">
        <div className="flex items-center gap-2">
          {isMarkdown && selectedPath && (
            <div className="flex items-center bg-warm-200 dark:bg-zinc-800 rounded-md p-0.5 border border-warm-300 dark:border-zinc-700">
              <button
                onClick={() => setMdView('raw')}
                className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${
                  mdView === 'raw'
                    ? 'bg-warm-50 dark:bg-zinc-700 text-warm-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Code className="w-3 h-3" />
                Raw
              </button>
              <button
                onClick={() => setMdView('pretty')}
                className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${
                  mdView === 'pretty'
                    ? 'bg-warm-50 dark:bg-zinc-700 text-warm-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Eye className="w-3 h-3" />
                Pretty
              </button>
            </div>
          )}
          {selectedPath && (
            <span className="text-xs text-zinc-500 font-mono truncate max-w-md">
              {selectedPath.replace(project.path + '/', '')}
            </span>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setOpenMenuOpen((o) => !o)}
            onBlur={() => setTimeout(() => setOpenMenuOpen(false), 150)}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-warm-800 dark:text-zinc-300 bg-warm-200 dark:bg-zinc-800 hover:bg-warm-300 dark:hover:bg-zinc-700 rounded-md border border-warm-300 dark:border-zinc-700 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Open with...
            <ChevronDown className="w-3 h-3" />
          </button>

          {openMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-warm-50 dark:bg-zinc-800 border border-warm-300 dark:border-zinc-700 rounded-lg shadow-xl z-50 py-1">
              {OPEN_APPS.map((app) => (
                <button
                  key={app.key}
                  onClick={() => handleOpenWith(app.key)}
                  className="w-full text-left px-3 py-1.5 text-sm text-warm-800 dark:text-zinc-300 hover:bg-warm-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  {app.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main content: file tree + editor */}
      <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
        <Panel defaultSize={25} minSize={15} maxSize={50}>
          <div className="h-full overflow-hidden border-r border-warm-300 dark:border-zinc-800 bg-warm-50 dark:bg-zinc-900/50">
            <div className="h-full overflow-y-auto">
              <FileTree
                nodes={tree}
                selectedPath={selectedPath}
                onSelectFile={loadFile}
              />
            </div>
          </div>
        </Panel>

        <PanelResizeHandle style={{ width: 6, cursor: 'col-resize' }} className="bg-warm-200 dark:bg-zinc-800 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors" />

        <Panel minSize={30}>
          <div className="h-full overflow-hidden">
            {!selectedPath ? (
              <div className="flex-1 h-full flex items-center justify-center text-zinc-500 text-sm">
                Select a file to view
              </div>
            ) : loading ? (
              <div className="flex-1 h-full flex items-center justify-center text-zinc-500">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Loading...
              </div>
            ) : isMarkdown && mdView === 'pretty' ? (
              <div className="h-full overflow-y-auto p-6">
                <div className="prose prose-zinc dark:prose-invert prose-sm max-w-none prose-pre:bg-zinc-800 prose-pre:text-zinc-100 prose-code:text-blue-400 prose-headings:text-warm-900 dark:prose-headings:text-zinc-100">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                  >
                    {fileContent}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              <MonacoEditor
                height="100%"
                language={fileLanguage}
                value={fileContent}
                theme="vs-dark"
                options={{
                  readOnly: true,
                  minimap: { enabled: true },
                  fontSize: 13,
                  fontFamily: 'Geist Mono, monospace',
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  padding: { top: 12 },
                  renderLineHighlight: 'line',
                }}
              />
            )}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
