'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Modal } from '@/components/Modal';
import type { Agent } from '@/lib/types';

interface AgentEditModalProps {
  isOpen: boolean;
  agent: Agent | null; // null = creating new
  onClose: () => void;
  onSave: (data: Partial<Agent> & { name: string }) => void;
  onDelete?: () => void;
}

const AVATAR_COLORS = [
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#ef4444', // red-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
];

export function AgentEditModal({ isOpen, agent, onClose, onSave, onDelete }: AgentEditModalProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[1]);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (agent) {
        setName(agent.name);
        setRole(agent.role || '');
        setSystemPrompt(agent.systemPrompt || '');
        setModel(agent.model || '');
        setAvatarColor(agent.avatar?.color || AVATAR_COLORS[1]);
      } else {
        setName('');
        setRole('');
        setSystemPrompt('');
        setModel('');
        setAvatarColor(AVATAR_COLORS[1]);
      }
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [isOpen, agent]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      role: role.trim() || undefined,
      systemPrompt: systemPrompt.trim() || undefined,
      model: model.trim() || undefined,
      avatar: { color: avatarColor },
    });
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-text-primary mb-4">{agent ? 'Edit Agent' : 'New Agent'}</h3>
        {/* Avatar color */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Color</label>
          <div className="flex gap-1.5">
            {AVATAR_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setAvatarColor(color)}
                className={`w-6 h-6 rounded-full border-2 transition-all ${
                  avatarColor === color ? 'border-text-primary scale-110' : 'border-transparent hover:border-border-hover'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Name</label>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="e.g. Chief Research Officer"
            className="w-full bg-surface-secondary border border-border-default rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-strong"
          />
        </div>

        {/* Role */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Role</label>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Short purpose statement"
            className="w-full bg-surface-secondary border border-border-default rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-strong"
          />
        </div>

        {/* Model */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Model override</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Leave empty for default"
            className="w-full bg-surface-secondary border border-border-default rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-strong"
          />
        </div>

        {/* System Prompt */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">System prompt</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Additional instructions for this agent..."
            rows={5}
            className="w-full bg-surface-secondary border border-border-default rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-strong resize-y"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <div>
            {agent && onDelete && (
              <button
                onClick={() => {
                  onDelete();
                  onClose();
                }}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Delete agent
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-xs">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!name.trim()}
              className="btn-primary text-xs disabled:opacity-30"
            >
              {agent ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
