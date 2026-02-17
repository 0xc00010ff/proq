'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import 'highlight.js/styles/github-dark.css';
import dynamic from 'next/dynamic';
import {
  ExternalLink,
  Eye,
  Code,
  Loader2,
  Check,
  Copy,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { FileTree, type TreeNode } from './FileTree';
import type { Project } from '@/lib/types';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <div className="flex-1 bg-[#1e1e1e]" />,
});

interface CodeTabProps {
  project: Project;
}


const DEFAULT_TREE_WIDTH = 260;
const MIN_TREE_WIDTH = 140;
const MAX_TREE_WIDTH = 600;
const SAVE_DEBOUNCE_MS = 1000;

type SaveStatus = 'idle' | 'saving' | 'saved';

export function CodeTab({ project }: CodeTabProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [fileLanguage, setFileLanguage] = useState<string>('plaintext');
  const [mdView, setMdView] = useState<'raw' | 'pretty'>('pretty');
  const [treeWidth, setTreeWidth] = useState(DEFAULT_TREE_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef<string>('');

  const isMarkdown = useMemo(() => {
    if (!selectedPath) return false;
    const ext = selectedPath.split('.').pop()?.toLowerCase();
    return ext === 'md' || ext === 'mdx';
  }, [selectedPath]);

  // Resize drag handling
  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setTreeWidth(Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, x)));
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

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

  // Save file
  const saveFile = useCallback(async (filePath: string, content: string) => {
    setSaveStatus('saving');
    try {
      await fetch('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
      });
      lastSavedContentRef.current = content;
      setSaveStatus('saved');
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('idle');
    }
  }, []);

  // Debounced auto-save on content change
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined || !selectedPath) return;
      setFileContent(value);
      if (value !== lastSavedContentRef.current) {
        setSaveStatus('saving');
      }
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (value !== lastSavedContentRef.current) {
          saveFile(selectedPath, value);
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [selectedPath, saveFile]
  );

  // Load file content
  const loadFile = useCallback(async (filePath: string) => {
    // Clear pending save for previous file
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setSaveStatus('idle');

    setSelectedPath(filePath);
    try {
      const res = await fetch(
        `/api/files/read?path=${encodeURIComponent(filePath)}`
      );
      const data = await res.json();
      if (data.error) {
        setFileContent(`// Error: ${data.error}`);
        setFileLanguage('plaintext');
        lastSavedContentRef.current = '';
      } else {
        setFileContent(data.content);
        setFileLanguage(data.language);
        lastSavedContentRef.current = data.content;
      }
    } catch {
      setFileContent('// Failed to load file');
      setFileLanguage('plaintext');
      lastSavedContentRef.current = '';
    }
  }, []);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleCopyFile = useCallback(async () => {
    if (!fileContent) return;
    try {
      await navigator.clipboard.writeText(fileContent);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      console.error('Failed to copy file contents');
    }
  }, [fileContent]);

  const handleOpenWith = useCallback(async () => {
    try {
      await fetch('/api/files/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: project.path }),
      });
    } catch (e) {
      console.error('Failed to open:', e);
    }
  }, [project.path]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gunmetal-50 dark:bg-zinc-950">
      {/* Sub-header bar */}
      <div className="h-10 flex-shrink-0 flex items-center justify-between px-3 border-b border-gunmetal-300 dark:border-zinc-800 bg-gunmetal-100 dark:bg-zinc-900/80">
        <div className="flex items-center gap-2">
          {isMarkdown && selectedPath && (
            <div className="flex items-center bg-gunmetal-200 dark:bg-zinc-800 rounded-md p-0.5 border border-gunmetal-300 dark:border-zinc-700">
              <button
                onClick={() => setMdView('raw')}
                className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${
                  mdView === 'raw'
                    ? 'bg-gunmetal-50 dark:bg-zinc-700 text-gunmetal-900 dark:text-zinc-100 shadow-sm'
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
                    ? 'bg-gunmetal-50 dark:bg-zinc-700 text-gunmetal-900 dark:text-zinc-100 shadow-sm'
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

          {/* Save status indicator */}
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              Saving...
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              <Check className="w-3 h-3" />
              Saved
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {selectedPath && (
            <button
              onClick={handleCopyFile}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-gunmetal-800 dark:text-zinc-300 bg-gunmetal-200 dark:bg-zinc-800 hover:bg-gunmetal-300 dark:hover:bg-zinc-700 rounded-md border border-gunmetal-300 dark:border-zinc-700 transition-colors"
            >
              {copyStatus === 'copied' ? (
                <>
                  <Check className="w-3 h-3 text-patina" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  Copy
                </>
              )}
            </button>
          )}

          <button
            onClick={handleOpenWith}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-gunmetal-800 dark:text-zinc-300 bg-gunmetal-200 dark:bg-zinc-800 hover:bg-gunmetal-300 dark:hover:bg-zinc-700 rounded-md border border-gunmetal-300 dark:border-zinc-700 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Open with...
          </button>
        </div>
      </div>

      {/* Main content: file tree + editor */}
      <div ref={containerRef} className="flex-1 flex min-h-0 overflow-hidden">
        {/* File tree */}
        <div
          className="h-full overflow-y-auto border-r border-gunmetal-300 dark:border-zinc-800 bg-gunmetal-50 dark:bg-zinc-900/50 flex-shrink-0"
          style={{ width: treeWidth }}
        >
          <FileTree
            nodes={tree}
            selectedPath={selectedPath}
            onSelectFile={loadFile}
          />
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={(e) => { e.preventDefault(); setIsDragging(true); }}
          className={`w-[5px] flex-shrink-0 cursor-col-resize transition-colors ${
            isDragging
              ? 'bg-steel-dark'
              : 'bg-gunmetal-200 dark:bg-zinc-800 hover:bg-steel dark:hover:bg-steel-dark'
          }`}
        />

        {/* Editor */}
        <div className="flex-1 min-w-0 h-full overflow-hidden">
          {!selectedPath ? (
            <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
              Select a file to view
            </div>
          ) : isMarkdown && mdView === 'pretty' ? (
            <div className="h-full overflow-y-auto p-6">
              <div className="prose prose-zinc dark:prose-invert prose-sm max-w-none prose-pre:bg-zinc-800 prose-pre:text-zinc-100 prose-code:text-steel prose-headings:text-gunmetal-900 dark:prose-headings:text-zinc-100">
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
              onChange={handleEditorChange}
              options={{
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
      </div>

      {/* Drag overlay to prevent iframe/editor stealing mouse events */}
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </div>
  );
}
