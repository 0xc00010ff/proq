'use client';

import React, { useState, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileJson,
  File,
  ImageIcon,
} from 'lucide-react';

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

interface FileTreeProps {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'py':
    case 'rs':
    case 'go':
    case 'sh':
    case 'css':
    case 'scss':
    case 'html':
      return <FileCode className="w-4 h-4 text-blue-400 flex-shrink-0" />;
    case 'json':
      return <FileJson className="w-4 h-4 text-yellow-400 flex-shrink-0" />;
    case 'md':
    case 'mdx':
    case 'txt':
      return <FileText className="w-4 h-4 text-zinc-400 flex-shrink-0" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'ico':
    case 'webp':
      return <ImageIcon className="w-4 h-4 text-green-400 flex-shrink-0" />;
    default:
      return <File className="w-4 h-4 text-zinc-500 flex-shrink-0" />;
  }
}

function TreeNodeItem({ node, depth, selectedPath, onSelectFile }: TreeNodeItemProps) {
  const [expanded, setExpanded] = useState(false);

  const handleClick = useCallback(() => {
    if (node.type === 'dir') {
      setExpanded((e) => !e);
    } else {
      onSelectFile(node.path);
    }
  }, [node, onSelectFile]);

  const isSelected = node.path === selectedPath;

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-1.5 py-[3px] pr-2 text-left text-[13px] hover:bg-warm-200/60 dark:hover:bg-zinc-800/60 rounded-sm transition-colors ${
          isSelected
            ? 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/20 dark:hover:bg-blue-500/20'
            : 'text-warm-800 dark:text-zinc-300'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.type === 'dir' ? (
          <>
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
            )}
            {expanded ? (
              <FolderOpen className="w-4 h-4 text-blue-400 flex-shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-zinc-400 flex-shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5 flex-shrink-0" />
            {getFileIcon(node.name)}
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>

      {node.type === 'dir' && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ nodes, selectedPath, onSelectFile }: FileTreeProps) {
  return (
    <div className="py-1 overflow-y-auto h-full font-mono text-sm select-none">
      {nodes.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}
