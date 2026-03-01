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
  SettingsIcon,
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
  // Dotfiles / config files
  const nameLower = name.toLowerCase();
  if (nameLower.startsWith('.env')) {
    return <SettingsIcon className="w-4 h-4 text-gold flex-shrink-0" />;
  }
  if (nameLower === '.gitignore' || nameLower === '.eslintignore' || nameLower === '.prettierignore') {
    return <FileText className="w-4 h-4 text-zinc-500 flex-shrink-0" />;
  }
  if (nameLower.startsWith('.eslint') || nameLower.startsWith('.prettier')) {
    return <SettingsIcon className="w-4 h-4 text-zinc-400 flex-shrink-0" />;
  }

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
      return <FileCode className="w-4 h-4 text-steel flex-shrink-0" />;
    case 'json':
      return <FileJson className="w-4 h-4 text-gold flex-shrink-0" />;
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
      return <ImageIcon className="w-4 h-4 text-patina flex-shrink-0" />;
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
        className={`w-full flex items-center gap-1.5 py-[3px] pr-2 text-left text-[12px] hover:bg-bronze-200/60 dark:hover:bg-zinc-800/60 rounded-sm ${
          isSelected
            ? 'bg-steel/15 text-steel hover:bg-steel/20 dark:hover:bg-steel/20'
            : 'text-bronze-800 dark:text-zinc-300'
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
              <FolderOpen className="w-4 h-4 text-steel flex-shrink-0" />
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
    <div className="py-1 overflow-y-auto h-full text-[12px] select-none">
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
