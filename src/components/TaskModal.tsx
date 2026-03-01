'use client';

import React, { useCallback, useEffect, useLayoutEffect, useState, useRef } from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { XIcon, PaperclipIcon, FileIcon, PlayIcon, Loader2Icon } from 'lucide-react';
import type { Task, TaskAttachment, TaskMode } from '@/lib/types';

interface TaskModalProps {
  task: Task;
  isOpen: boolean;
  onClose: (isEmpty: boolean) => void;
  onSave: (taskId: string, updates: Partial<Task>) => void;
  onMoveToInProgress?: (taskId: string, currentData: Partial<Task>) => Promise<void>;
}

function openDataUrl(dataUrl: string) {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: mime });
  window.open(URL.createObjectURL(blob), '_blank');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MIN_MODAL_HEIGHT = 420;
const MAX_MODAL_VH = 0.8;

export function TaskModal({ task, isOpen, onClose, onSave, onMoveToInProgress }: TaskModalProps) {
  const [title, setTitle] = useState(task.title || '');
  const [description, setDescription] = useState(task.description);
  const [mode, setMode] = useState<TaskMode>(task.mode || 'build');
  const [attachments, setAttachments] = useState<TaskAttachment[]>(
    task.attachments || [],
  );
  const [isDragOver, setIsDragOver] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [modalHeight, setModalHeight] = useState(MIN_MODAL_HEIGHT);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitle(task.title || '');
    setDescription(task.description);
    setMode(task.mode || 'build');
    setAttachments(task.attachments || []);
  }, [task.id]);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setTimeout(() => descriptionRef.current?.focus(), 50);
    }
    wasOpen.current = isOpen;
  }, [isOpen, task.id]);

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
    const isEmpty = !title.trim() && !description.trim();
    if (!isEmpty) {
      onSave(task.id, {
        title,
        description,
        attachments,
        mode,
      });
    }
    onClose(isEmpty);
  }, [task.id, title, description, attachments, mode, onSave, onClose]);

  useEscapeKey(handleClose, isOpen);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, []);

  // Cmd+Enter to trigger "Start Now"
  useEffect(() => {
    if (!isOpen || !onMoveToInProgress) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.metaKey && description.trim() && !dispatching) {
        e.preventDefault();
        if (saveTimeout.current) clearTimeout(saveTimeout.current);
        setDispatching(true);
        onMoveToInProgress(task.id, { title, description, attachments, mode });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onMoveToInProgress, title, description, attachments, mode, dispatching, task.id]);

  // Compute modal height: grow with text content, clamp between 600px and 80vh
  useLayoutEffect(() => {
    const ta = descriptionRef.current;
    if (!ta || !isOpen) return;

    // Measure textarea's true content height
    const prev = ta.style.height;
    ta.style.height = '0px';
    const textContentH = ta.scrollHeight;
    ta.style.height = prev;

    const headerH = headerRef.current?.offsetHeight ?? 0;
    const attachH = attachmentsRef.current?.offsetHeight ?? 0;
    const toolbarH = toolbarRef.current?.offsetHeight ?? 0;
    const descPadding = 32; // px-6 wrapper padding top+bottom

    const ideal = headerH + textContentH + descPadding + attachH + toolbarH;
    const maxH = window.innerHeight * MAX_MODAL_VH;
    setModalHeight(Math.max(MIN_MODAL_HEIGHT, Math.min(Math.ceil(ideal), maxH)));
  }, [description, attachments.length, isOpen]);

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
        className="absolute inset-0 bg-black/50 backdrop-blur-none"
        onClick={handleClose}
      />

      <div
        className={`relative w-full max-w-2xl bg-bronze-50 dark:bg-zinc-900 border rounded-lg shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-150 transition-colors overflow-hidden ${isDragOver ? 'border-steel/50' : 'border-bronze-300 dark:border-zinc-800'}`}
        style={{ height: modalHeight }}
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

        {/* Header: mode selector + title */}
        <div ref={headerRef} className="p-6 pt-5 pb-0 shrink-0">
          <div className="bg-surface-secondary p-0.5 rounded-md flex items-center border border-border-default w-fit mb-3">
            {([
              ['answer', 'Answer', 'Research only, no code changes.'],
              ['plan', 'Plan', 'Agent proposes, you approve.'],
              ['build', 'Build', 'Full autonomy. Bypass permissions.'],
            ] as const).map(([value, label, tooltip]) => (
              <button
                key={value}
                onClick={() => handleModeChange(value)}
                title={tooltip}
                className={`relative px-3 py-1 text-xs font-medium rounded transition-colors z-10 ${
                  mode === value
                    ? 'text-text-chrome-active'
                    : 'text-text-chrome hover:text-text-chrome-hover'
                }`}
              >
                {mode === value && (
                  <div
                    className="absolute inset-0 bg-bronze-50 dark:bg-zinc-800/60 rounded border border-bronze-400/50 dark:border-bronze-800/50 shadow-sm"
                    style={{ zIndex: -1 }}
                  />
                )}
                {label}
              </button>
            ))}
          </div>

          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                descriptionRef.current?.focus();
              }
            }}
            className="w-full bg-transparent text-xl font-semibold text-bronze-900 dark:text-zinc-100 placeholder-bronze-500 dark:placeholder-zinc-700 focus:outline-none mb-4 pr-8"
            placeholder="(Auto title)"
          />
        </div>

        {/* Description: takes remaining space, scrolls only at max height */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-2">
          <textarea
            ref={descriptionRef}
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && description === '') {
                e.preventDefault();
                const input = titleRef.current;
                if (input) {
                  input.focus();
                  input.setSelectionRange(input.value.length, input.value.length);
                }
              }
            }}
            className="w-full h-full bg-transparent text-sm text-bronze-700 dark:text-zinc-400 placeholder-bronze-500 dark:placeholder-zinc-700 focus:outline-none resize-none leading-relaxed"
            placeholder="Write something..."
          />
        </div>

        {/* Attachments — pinned above toolbar */}
        <div ref={attachmentsRef} className={attachments.length > 0 ? 'px-6 py-3 flex flex-wrap gap-2 shrink-0' : 'hidden'}>
          {attachments.map((att) => {
            const isImage = att.type?.startsWith('image/') || false;
            return isImage && att.dataUrl ? (
              <div
                key={att.id}
                className="relative group rounded-md overflow-hidden border border-bronze-400/50 dark:border-zinc-700/50 bg-bronze-200/60 dark:bg-zinc-800/60 cursor-pointer"
                onClick={() => openDataUrl(att.dataUrl!)}
              >
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  className="h-20 w-auto max-w-[120px] object-cover block"
                />
                <button
                  onClick={(e) => { e.stopPropagation(); removeAttachment(att.id); }}
                  className="absolute top-1 right-1 p-0.5 rounded bg-black/60 text-white/80 hover:text-crimson opacity-0 group-hover:opacity-100 transition-opacity z-10"
                >
                  <XIcon className="w-3 h-3" />
                </button>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1">
                  <span className="text-[10px] text-zinc-300 truncate block">
                    {att.name}
                  </span>
                </div>
              </div>
            ) : (
              <div
                key={att.id}
                className="flex items-center gap-2 bg-bronze-200/60 dark:bg-zinc-800/60 border border-bronze-400/50 dark:border-zinc-700/50 rounded-md px-3 py-2.5 group cursor-pointer"
                onClick={() => att.dataUrl && openDataUrl(att.dataUrl)}
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
                  onClick={(e) => { e.stopPropagation(); removeAttachment(att.id); }}
                  className="text-zinc-600 hover:text-crimson transition-colors ml-1 opacity-0 group-hover:opacity-100"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Drag overlay hint */}
        {isDragOver && (
          <div className="absolute inset-0 bg-steel/5 rounded-lg flex items-center justify-center pointer-events-none z-20">
            <div className="text-sm text-steel font-medium">
              Drop files here
            </div>
          </div>
        )}

        {/* Footer toolbar */}
        <div ref={toolbarRef} className="border-t border-bronze-300/60 dark:border-zinc-800/60 flex items-center shrink-0 px-2 py-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors text-xs px-2 py-1"
          >
            <PaperclipIcon className="w-3.5 h-3.5" />
            <span>Attach file</span>
          </button>

          <div className="flex-1" />

          {onMoveToInProgress && (
            <button
              onClick={async () => {
                if (saveTimeout.current) clearTimeout(saveTimeout.current);
                setDispatching(true);
                await onMoveToInProgress(task.id, { title, description, attachments, mode });
              }}
              disabled={!description.trim() || dispatching}
              className={`btn-primary flex items-center gap-1.5 ${dispatching ? 'pointer-events-none' : 'disabled:opacity-30 disabled:pointer-events-none'}`}
            >
              {dispatching ? (
                <Loader2Icon className="w-3 h-3 animate-spin" />
              ) : (
                <PlayIcon className="w-3 h-3" />
              )}
              {dispatching ? 'Starting...' : 'Start Now'}
            </button>
          )}

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
