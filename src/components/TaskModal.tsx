'use client';

import React, { useCallback, useEffect, useState, useRef } from 'react';
import { XIcon, PaperclipIcon, FileIcon } from 'lucide-react';
import type { Task, TaskAttachment, TaskMode } from '@/lib/types';

interface TaskModalProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  onSave: (taskId: string, updates: Partial<Task>) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TaskModal({ task, isOpen, onClose, onSave }: TaskModalProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [mode, setMode] = useState<TaskMode>(task.mode || 'code');
  const [attachments, setAttachments] = useState<TaskAttachment[]>(
    task.attachments || [],
  );
  const [isDragOver, setIsDragOver] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setMode(task.mode || 'code');
    setAttachments(task.attachments || []);
  }, [task]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const autosave = useCallback(
    (newTitle: string, newDesc: string, newAttachments: TaskAttachment[], newMode?: TaskMode) => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        onSave(task.id, {
          title: newTitle,
          description: newDesc,
          attachments: newAttachments,
          mode: newMode,
        });
      }, 400);
    },
    [task.id, onSave],
  );

  const handleClose = useCallback(() => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    onSave(task.id, {
      title,
      description,
      attachments,
      mode,
    });
    onClose();
  }, [task.id, title, description, attachments, onSave, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, handleClose]);

  useEffect(() => {
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, []);

  if (!isOpen) return null;

  const handleTitleChange = (val: string) => {
    setTitle(val);
    autosave(val, description, attachments, mode);
  };

  const handleDescriptionChange = (val: string) => {
    setDescription(val);
    autosave(title, val, attachments, mode);
  };

  const handleModeChange = (newMode: TaskMode) => {
    setMode(newMode);
    autosave(title, description, attachments, newMode);
  };

  const addFiles = (files: FileList | File[]) => {
    Array.from(files).forEach((f) => {
      const att: TaskAttachment = {
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: f.name,
        size: f.size,
        type: f.type,
      };
      if (f.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          att.dataUrl = e.target?.result as string;
          setAttachments((prev) => {
            const updated = [...prev, att];
            autosave(title, description, updated, mode);
            return updated;
          });
        };
        reader.readAsDataURL(f);
      } else {
        setAttachments((prev) => {
          const updated = [...prev, att];
          autosave(title, description, updated);
          return updated;
        });
      }
    });
  };

  const removeAttachment = (id: string) => {
    const updated = attachments.filter((a) => a.id !== id);
    setAttachments(updated);
    autosave(title, description, updated);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      <div
        className={`relative w-full max-w-2xl bg-white dark:bg-zinc-900 border rounded-lg shadow-2xl flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150 transition-colors ${isDragOver ? 'border-blue-500/50' : 'border-zinc-200 dark:border-zinc-800'}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors p-1 z-10"
        >
          <XIcon className="w-4 h-4" />
        </button>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 pt-5">
          {/* Mode selector */}
          <div className="flex gap-1.5 mb-3">
            {([
              ['code', 'Code'],
              ['plan', 'Plan'],
              ['answer', 'Answer'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => handleModeChange(value)}
                className={`px-2.5 py-1 text-xs rounded-sm transition-colors ${
                  mode === value
                    ? 'bg-zinc-600 text-zinc-100'
                    : 'border border-zinc-700 text-zinc-500 hover:text-zinc-400 hover:border-zinc-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="w-full bg-transparent text-xl font-semibold text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-700 focus:outline-none mb-4 pr-8"
            placeholder="Untitled"
          />
          <textarea
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            className="w-full min-h-[280px] bg-transparent text-sm text-zinc-600 dark:text-zinc-400 placeholder-zinc-400 dark:placeholder-zinc-700 focus:outline-none resize-none leading-relaxed"
            placeholder="Write something..."
          />
        </div>

        {/* Drag overlay hint */}
        {isDragOver && (
          <div className="absolute inset-0 bg-blue-500/5 rounded-lg flex items-center justify-center pointer-events-none z-20">
            <div className="text-sm text-blue-400 font-medium">
              Drop files here
            </div>
          </div>
        )}

        {/* Attachment Footer */}
        <div className="border-t border-zinc-200/60 dark:border-zinc-800/60 px-4 py-3 flex flex-col gap-2.5">
          {/* Attachment list */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((att) => {
                const isImage = att.type?.startsWith('image/') || false;
                return isImage && att.dataUrl ? (
                  <div
                    key={att.id}
                    className="relative group rounded-md overflow-hidden border border-zinc-300/50 dark:border-zinc-700/50 bg-zinc-100/60 dark:bg-zinc-800/60"
                  >
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      className="h-20 w-auto max-w-[120px] object-cover block"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center">
                      <button
                        onClick={() => removeAttachment(att.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-white/80 hover:text-red-400 p-1"
                      >
                        <XIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[10px] text-zinc-300 truncate block">
                        {att.name}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    key={att.id}
                    className="flex items-center gap-2 bg-zinc-100/60 dark:bg-zinc-800/60 border border-zinc-300/50 dark:border-zinc-700/50 rounded-md px-3 py-2.5 group"
                  >
                    <FileIcon className="w-4 h-4 text-zinc-500 shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-[11px] text-zinc-700 dark:text-zinc-300 truncate max-w-[140px] leading-tight">
                        {att.name}
                      </span>
                      <span className="text-[10px] text-zinc-600 leading-tight">
                        {formatSize(att.size)}
                      </span>
                    </div>
                    <button
                      onClick={() => removeAttachment(att.id)}
                      className="text-zinc-600 hover:text-red-400 transition-colors ml-1 opacity-0 group-hover:opacity-100"
                    >
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add attachment button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors text-xs w-fit"
          >
            <PaperclipIcon className="w-3.5 h-3.5" />
            <span>Attach file</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                addFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
