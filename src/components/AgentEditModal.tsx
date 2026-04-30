'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { XIcon, PencilIcon, MessageSquareIcon, Trash2Icon, BotIcon, CheckIcon, StarIcon } from 'lucide-react';
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
} from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { Agent, Task } from '@/lib/types';

interface AgentEditModalProps {
  isOpen: boolean;
  projectId: string;
  agent: Agent | null; // null = creating new
  isDefault?: boolean;
  onClose: () => void;
  onSave: (data: Partial<Agent> & { name: string }) => void;
  onDelete?: () => void;
  onSpawnChat?: () => void;
  onSetDefault?: () => void;
}

export function AgentEditModal({ isOpen, projectId, agent, isDefault, onClose, onSave, onDelete, onSpawnChat, onSetDefault }: AgentEditModalProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [recentTasks, setRecentTasks] = useState<Task[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);

  const isNew = !agent;

  useEffect(() => {
    if (isOpen) {
      if (agent) {
        setName(agent.name);
        setRole(agent.role || '');
        setSystemPrompt(agent.systemPrompt || '');
        setEditing(false);
      } else {
        setName('');
        setRole('');
        setSystemPrompt('');
        setEditing(true);
        setTimeout(() => nameRef.current?.focus(), 50);
      }
    }
  }, [isOpen, agent]);

  // Fetch recent tasks assigned to this agent
  useEffect(() => {
    if (!isOpen || !agent || !projectId) {
      setRecentTasks([]);
      return;
    }
    fetch(`/api/projects/${projectId}/tasks`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        // Collect tasks from all columns, filter by agentId, sort by updatedAt desc
        const all: Task[] = [
          ...(data.todo || []),
          ...(data['in-progress'] || []),
          ...(data.verify || []),
          ...(data.done || []),
        ];
        const agentTasks = all
          .filter((t: Task) => t.agentId === agent.id)
          .sort((a: Task, b: Task) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, 10);
        setRecentTasks(agentTasks);
      })
      .catch(() => {});
  }, [isOpen, agent, projectId]);

  const handleSubmit = useCallback(() => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      role: role.trim() || undefined,
      systemPrompt: systemPrompt.trim() || undefined,
    });
    if (isNew) {
      onClose();
    } else {
      setEditing(false);
    }
  }, [name, role, systemPrompt, isNew, onSave, onClose]);

  useEscapeKey(() => {
    if (editing && !isNew) {
      setEditing(false);
    } else {
      onClose();
    }
  }, isOpen);

  if (!isOpen) return null;

  const statusLabel = (status: string) => {
    switch (status) {
      case 'todo': return 'Todo';
      case 'in-progress': return 'In Progress';
      case 'verify': return 'Verify';
      case 'done': return 'Done';
      default: return status;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'in-progress': return 'text-bronze-500';
      case 'verify': return 'text-lazuli';
      case 'done': return 'text-emerald';
      default: return 'text-text-tertiary';
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] flex flex-col rounded-lg border border-border-default bg-surface-detail shadow-2xl shadow-black/60 overflow-hidden animate-fade-in"
          style={{ width: 'min(560px, calc(100vw - 2rem))', maxHeight: '80vh' }}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-4 py-1.5 border-b border-border-default bg-surface-topbar">
            <DialogPrimitive.Title className="text-xs font-medium text-text-primary truncate mr-2 flex items-center gap-2">
              <BotIcon className="w-3.5 h-3.5 text-text-chrome shrink-0" />
              {agent ? agent.name : 'New Agent'}
            </DialogPrimitive.Title>
            <div className="flex items-center gap-0.5">
              {agent && !editing && (
                <button
                  onClick={() => {
                    setEditing(true);
                    setTimeout(() => nameRef.current?.focus(), 50);
                  }}
                  className="shrink-0 p-1 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-surface-hover"
                  title="Edit"
                >
                  <PencilIcon className="w-3.5 h-3.5" />
                </button>
              )}
              {agent && onSpawnChat && (
                <button
                  onClick={() => { onSpawnChat(); onClose(); }}
                  className="shrink-0 p-1 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-surface-hover"
                  title="Open chat as this agent"
                >
                  <MessageSquareIcon className="w-3.5 h-3.5" />
                </button>
              )}
              <DialogPrimitive.Close
                className="shrink-0 p-1 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-surface-hover"
              >
                <XIcon className="w-4 h-4" />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {editing ? (
              /* ── Edit Mode ── */
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Name</label>
                  <input
                    ref={nameRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) handleSubmit(); }}
                    placeholder="e.g. Chief Research Officer"
                    className="w-full bg-surface-secondary border border-border-default rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-strong"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Role</label>
                  <input
                    type="text"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="Short purpose statement"
                    className="w-full bg-surface-secondary border border-border-default rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-strong"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">System prompt</label>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Additional instructions for this agent..."
                    rows={5}
                    className="w-full bg-surface-secondary border border-border-default rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-strong resize-y"
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div>
                    {agent && onDelete && (
                      <button
                        onClick={() => { onDelete(); onClose(); }}
                        className="btn-danger text-xs"
                      >
                        <Trash2Icon className="w-3 h-3 mr-1 inline" />
                        Delete
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {!isNew && (
                      <button onClick={() => setEditing(false)} className="btn-secondary">
                        Cancel
                      </button>
                    )}
                    <button
                      onClick={handleSubmit}
                      disabled={!name.trim()}
                      className="btn-primary disabled:opacity-30"
                    >
                      <CheckIcon className="w-3 h-3 mr-1 inline" />
                      {isNew ? 'Create' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* ── Detail Mode (agent's "office") ── */
              <div className="p-5">
                {/* Agent identity */}
                <div className="flex items-start gap-3 mb-5">
                  <div className="w-10 h-10 rounded-lg bg-surface-hover flex items-center justify-center shrink-0">
                    <BotIcon className="w-5 h-5 text-text-chrome" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-text-primary">{agent?.name}</div>
                    {agent?.role && (
                      <div className="text-xs text-text-tertiary mt-0.5">{agent.role}</div>
                    )}
                  </div>
                  {agent && onSetDefault && (
                    isDefault ? (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium text-text-tertiary px-2 py-1 rounded-md border border-border-default/60 bg-surface-secondary/50">
                        <StarIcon className="w-3 h-3" />
                        Default
                      </span>
                    ) : (
                      <button
                        onClick={onSetDefault}
                        className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium text-text-tertiary hover:text-text-secondary px-2 py-1 rounded-md border border-border-default hover:border-border-strong bg-surface-secondary/50 hover:bg-surface-hover transition-colors"
                        title="Make this the default agent for tasks and workbench tabs"
                      >
                        <StarIcon className="w-3 h-3" />
                        Make default
                      </button>
                    )
                  )}
                </div>

                {/* System prompt */}
                {agent?.systemPrompt && (
                  <div className="mb-5">
                    <div className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1.5">System Prompt</div>
                    <div className="text-xs text-text-secondary bg-surface-secondary/50 border border-border-default rounded-md px-3 py-2.5 whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
                      {agent.systemPrompt}
                    </div>
                  </div>
                )}

                {/* Recent tasks */}
                <div>
                  <div className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-2">
                    Recent Tasks
                  </div>
                  {recentTasks.length === 0 ? (
                    <div className="text-xs text-text-placeholder py-3 text-center">
                      No tasks assigned yet
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {recentTasks.map((task) => (
                        <div
                          key={task.id}
                          className="flex items-center justify-between px-3 py-2 rounded-md bg-surface-secondary/50 border border-border-default/60"
                        >
                          <div className="min-w-0 flex-1 mr-3">
                            <div className="text-xs text-text-primary truncate">
                              {task.title || task.description.slice(0, 60)}
                            </div>
                          </div>
                          <span className={`text-[10px] font-medium uppercase tracking-wide shrink-0 ${statusColor(task.status)}`}>
                            {statusLabel(task.status)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
