'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
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
  FilePlus,
  FolderPlus,
  PencilLine,
  Trash2,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

export interface FileTreeCallbacks {
  onRename: (oldPath: string, newName: string) => Promise<boolean>;
  onDelete: (path: string, type: 'file' | 'dir') => Promise<boolean>;
  onCreateFile: (parentDir: string, name: string) => Promise<boolean>;
  onCreateFolder: (parentDir: string, name: string) => Promise<boolean>;
}

interface FileTreeProps {
  nodes: TreeNode[];
  rootPath?: string;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onDoubleClickFile?: (path: string) => void;
  callbacks?: FileTreeCallbacks;
}

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onDoubleClickFile?: (path: string) => void;
  callbacks?: FileTreeCallbacks;
  // For creating new items inside this node (only dirs)
  creatingChild: { type: 'file' | 'dir' } | null;
  onStartCreate: (parentPath: string, type: 'file' | 'dir') => void;
  onCancelCreate: () => void;
  // Rename state
  renamingPath: string | null;
  onStartRename: (path: string) => void;
  onCancelRename: () => void;
}

function getFileIcon(name: string) {
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
      return <FileCode className="w-4 h-4 text-lazuli flex-shrink-0" />;
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
      return <ImageIcon className="w-4 h-4 text-emerald flex-shrink-0" />;
    default:
      return <File className="w-4 h-4 text-zinc-500 flex-shrink-0" />;
  }
}

/** Inline input for rename / new file / new folder */
function InlineInput({
  defaultValue,
  icon,
  depth,
  onConfirm,
  onCancel,
}: {
  defaultValue: string;
  icon: React.ReactNode;
  depth: number;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus + select name without extension
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const dotIndex = defaultValue.lastIndexOf('.');
    if (dotIndex > 0) {
      input.setSelectionRange(0, dotIndex);
    } else {
      input.select();
    }
  }, [defaultValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const val = inputRef.current?.value.trim();
      if (val) onConfirm(val);
      else onCancel();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div
      className="flex items-center gap-1.5 py-[2px] pr-2"
      style={{ paddingLeft: `${depth * 16 + 8 + 18}px` }}
    >
      {icon}
      <input
        ref={inputRef}
        defaultValue={defaultValue}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          const val = inputRef.current?.value.trim();
          if (val) onConfirm(val);
          else onCancel();
        }}
        className="flex-1 min-w-0 bg-surface-inset border border-lazuli/50 rounded px-1.5 py-[1px] text-[12px] text-text-primary outline-none focus:border-lazuli"
      />
    </div>
  );
}

function TreeNodeItem({
  node,
  depth,
  selectedPath,
  onSelectFile,
  onDoubleClickFile,
  callbacks,
  creatingChild,
  onStartCreate,
  onCancelCreate,
  renamingPath,
  onStartRename,
  onCancelRename,
}: TreeNodeItemProps) {
  const [expanded, setExpanded] = useState(false);
  const isRenaming = renamingPath === node.path;
  const isCreatingHere = creatingChild !== null;

  const handleClick = useCallback(() => {
    if (node.type === 'dir') {
      setExpanded((e) => !e);
    } else {
      onSelectFile(node.path);
    }
  }, [node, onSelectFile]);

  const handleDoubleClick = useCallback(() => {
    if (node.type === 'file' && onDoubleClickFile) {
      onDoubleClickFile(node.path);
    }
  }, [node, onDoubleClickFile]);

  // Auto-expand directory when creating a child inside it
  useEffect(() => {
    if (isCreatingHere && node.type === 'dir') {
      setExpanded(true);
    }
  }, [isCreatingHere, node.type]);

  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      if (newName === node.name) {
        onCancelRename();
        return;
      }
      if (callbacks?.onRename) {
        await callbacks.onRename(node.path, newName);
      }
      onCancelRename();
    },
    [node.path, node.name, callbacks, onCancelRename]
  );

  const handleCreateConfirm = useCallback(
    async (name: string) => {
      if (!creatingChild || !callbacks) {
        onCancelCreate();
        return;
      }
      if (creatingChild.type === 'file') {
        await callbacks.onCreateFile(node.path, name);
      } else {
        await callbacks.onCreateFolder(node.path, name);
      }
      onCancelCreate();
    },
    [creatingChild, callbacks, node.path, onCancelCreate]
  );

  const parentDir = node.path.substring(0, node.path.lastIndexOf('/'));
  const isSelected = node.path === selectedPath;

  const rowContent = isRenaming ? (
    <InlineInput
      defaultValue={node.name}
      icon={
        node.type === 'dir' ? (
          <FolderOpen className="w-4 h-4 text-lazuli flex-shrink-0" />
        ) : (
          getFileIcon(node.name)
        )
      }
      depth={depth}
      onConfirm={handleRenameConfirm}
      onCancel={onCancelRename}
    />
  ) : (
    <button
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={`w-full flex items-center gap-1.5 py-[3px] pr-2 text-left text-[12px] hover:bg-surface-hover/40 rounded-sm ${
        isSelected
          ? 'bg-lazuli/15 text-lazuli hover:bg-lazuli/20'
          : 'text-text-secondary'
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
            <FolderOpen className="w-4 h-4 text-lazuli flex-shrink-0" />
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
  );

  const menuContent = callbacks ? (
    <ContextMenuContent>
      {node.type === 'dir' && (
        <>
          <ContextMenuItem
            onClick={() => {
              setExpanded(true);
              onStartCreate(node.path, 'file');
            }}
          >
            <FilePlus className="w-4 h-4" />
            New File
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              setExpanded(true);
              onStartCreate(node.path, 'dir');
            }}
          >
            <FolderPlus className="w-4 h-4" />
            New Folder
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      {node.type === 'file' && (
        <>
          <ContextMenuItem
            onClick={() => onStartCreate(parentDir, 'file')}
          >
            <FilePlus className="w-4 h-4" />
            New File
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => onStartCreate(parentDir, 'dir')}
          >
            <FolderPlus className="w-4 h-4" />
            New Folder
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem onClick={() => onStartRename(node.path)}>
        <PencilLine className="w-4 h-4" />
        Rename
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => callbacks.onDelete(node.path, node.type)}
        className="text-red-400 hover:text-red-300 focus:text-red-300"
      >
        <Trash2 className="w-4 h-4" />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  ) : null;

  return (
    <div>
      {callbacks ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
          {menuContent}
        </ContextMenu>
      ) : (
        rowContent
      )}

      {node.type === 'dir' && expanded && (
        <div>
          {/* Inline input for creating new child */}
          {isCreatingHere && creatingChild && (
            <InlineInput
              defaultValue={creatingChild.type === 'file' ? 'untitled' : 'new-folder'}
              icon={
                creatingChild.type === 'file' ? (
                  <File className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                ) : (
                  <Folder className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                )
              }
              depth={depth + 1}
              onConfirm={handleCreateConfirm}
              onCancel={onCancelCreate}
            />
          )}
          {node.children?.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              onDoubleClickFile={onDoubleClickFile}
              callbacks={callbacks}
              creatingChild={null}
              onStartCreate={onStartCreate}
              onCancelCreate={onCancelCreate}
              renamingPath={renamingPath}
              onStartRename={onStartRename}
              onCancelRename={onCancelRename}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ nodes, rootPath, selectedPath, onSelectFile, onDoubleClickFile, callbacks }: FileTreeProps) {
  // State for creating new items: which parent dir + type
  const [creating, setCreating] = useState<{ parentPath: string; type: 'file' | 'dir' } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const handleStartCreate = useCallback((parentPath: string, type: 'file' | 'dir') => {
    setRenamingPath(null);
    setCreating({ parentPath, type });
  }, []);

  const handleCancelCreate = useCallback(() => {
    setCreating(null);
  }, []);

  const handleStartRename = useCallback((path: string) => {
    setCreating(null);
    setRenamingPath(path);
  }, []);

  const handleCancelRename = useCallback(() => {
    setRenamingPath(null);
  }, []);

  const handleRootCreateConfirm = useCallback(
    async (name: string) => {
      if (!creating || !callbacks || !rootPath) {
        setCreating(null);
        return;
      }
      if (creating.type === 'file') {
        await callbacks.onCreateFile(rootPath, name);
      } else {
        await callbacks.onCreateFolder(rootPath, name);
      }
      setCreating(null);
    },
    [creating, callbacks, rootPath]
  );

  const isCreatingAtRoot = creating?.parentPath === rootPath;

  const treeContent = (
    <div className="py-1 overflow-y-auto h-full text-[12px] select-none">
      {/* Inline input for creating at root level */}
      {isCreatingAtRoot && creating && (
        <InlineInput
          defaultValue={creating.type === 'file' ? 'untitled' : 'new-folder'}
          icon={
            creating.type === 'file' ? (
              <File className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-zinc-400 flex-shrink-0" />
            )
          }
          depth={0}
          onConfirm={handleRootCreateConfirm}
          onCancel={handleCancelCreate}
        />
      )}
      {nodes.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          onDoubleClickFile={onDoubleClickFile}
          callbacks={callbacks}
          creatingChild={creating?.parentPath === node.path ? { type: creating.type } : null}
          onStartCreate={handleStartCreate}
          onCancelCreate={handleCancelCreate}
          renamingPath={renamingPath}
          onStartRename={handleStartRename}
          onCancelRename={handleCancelRename}
        />
      ))}
    </div>
  );

  if (callbacks && rootPath) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {treeContent}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => handleStartCreate(rootPath, 'file')}>
            <FilePlus className="w-4 h-4" />
            New File
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleStartCreate(rootPath, 'dir')}>
            <FolderPlus className="w-4 h-4" />
            New Folder
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return treeContent;
}
