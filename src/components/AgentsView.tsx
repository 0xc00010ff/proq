'use client';

import React, { useState, useCallback } from 'react';
import { PlusIcon, PencilIcon, BotIcon } from 'lucide-react';
import type { Agent } from '@/lib/types';
import { useAgents } from '@/hooks/useAgents';
import { AgentEditModal } from './AgentEditModal';

interface AgentsViewProps {
  projectId: string;
}

export function AgentsView({ projectId }: AgentsViewProps) {
  const { agents, setAgents } = useAgents(projectId);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [showModal, setShowModal] = useState(false);

  const handleCreate = useCallback(async (data: Partial<Agent> & { name: string }) => {
    const res = await fetch(`/api/projects/${projectId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const agent = await res.json();
      setAgents((prev) => [...prev, agent]);
    }
  }, [projectId, setAgents]);

  const handleUpdate = useCallback(async (data: Partial<Agent> & { name: string }) => {
    if (!editingAgent) return;
    const res = await fetch(`/api/projects/${projectId}/agents/${editingAgent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const updated = await res.json();
      setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    }
  }, [projectId, editingAgent, setAgents]);

  const handleDelete = useCallback(async () => {
    if (!editingAgent) return;
    const res = await fetch(`/api/projects/${projectId}/agents/${editingAgent.id}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setAgents((prev) => prev.filter((a) => a.id !== editingAgent.id));
    }
  }, [projectId, editingAgent, setAgents]);

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-text-primary">Agents</h2>
        <button
          onClick={() => {
            setEditingAgent(null);
            setShowModal(true);
          }}
          className="btn-secondary flex items-center gap-1.5 text-xs"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          New Agent
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="group bg-surface-secondary border border-border-default rounded-lg p-4 hover:border-border-hover transition-colors cursor-pointer"
            onClick={() => {
              setEditingAgent(agent);
              setShowModal(true);
            }}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: agent.avatar?.color || '#8b5cf6' }}
                >
                  <BotIcon className="w-4 h-4 text-white" />
                </div>
                <div>
                  <div className="text-sm font-medium text-text-primary">{agent.name}</div>
                  {agent.role && (
                    <div className="text-xs text-text-tertiary mt-0.5">{agent.role}</div>
                  )}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingAgent(agent);
                  setShowModal(true);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 text-text-tertiary hover:text-text-secondary transition-opacity"
              >
                <PencilIcon className="w-3.5 h-3.5" />
              </button>
            </div>

            {agent.model && (
              <div className="text-[10px] text-text-tertiary font-mono mb-1">
                {agent.model}
              </div>
            )}

            {agent.systemPrompt && (
              <div className="text-xs text-text-tertiary line-clamp-2 mt-2">
                {agent.systemPrompt}
              </div>
            )}
          </div>
        ))}
      </div>

      <AgentEditModal
        isOpen={showModal}
        agent={editingAgent}
        onClose={() => {
          setShowModal(false);
          setEditingAgent(null);
        }}
        onSave={editingAgent ? handleUpdate : handleCreate}
        onDelete={editingAgent ? handleDelete : undefined}
      />
    </div>
  );
}
