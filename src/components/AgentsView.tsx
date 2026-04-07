'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { PlusIcon } from 'lucide-react';
import type { Agent, Task, TaskColumns } from '@/lib/types';
import { useAgents } from '@/hooks/useAgents';
import { AgentEditModal } from './AgentEditModal';
import { AgentsCanvas } from './AgentsCanvas';

interface AgentsViewProps {
  projectId: string;
  tasks?: TaskColumns;
  onSpawnChat?: (agentId: string) => void;
}

export function AgentsView({ projectId, tasks, onSpawnChat }: AgentsViewProps) {
  const { agents, setAgents } = useAgents(projectId);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [showModal, setShowModal] = useState(false);

  // Count running tasks per agent
  const runningTaskCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!tasks) return counts;
    const inProgress = tasks['in-progress'] || [];
    for (const task of inProgress) {
      if (task.agentId && task.agentStatus === 'running') {
        counts[task.agentId] = (counts[task.agentId] || 0) + 1;
      }
    }
    return counts;
  }, [tasks]);

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
      setEditingAgent(updated);
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

  const handlePositionChange = useCallback(async (agentId: string, position: { x: number; y: number }) => {
    await fetch(`/api/projects/${projectId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position }),
    });
    setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, position } : a)));
  }, [projectId, setAgents]);

  const handleNodeClick = useCallback((agent: Agent) => {
    setEditingAgent(agent);
    setShowModal(true);
  }, []);

  return (
    <div className="absolute inset-0">
      {/* Floating action button */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => {
            setEditingAgent(null);
            setShowModal(true);
          }}
          className="btn-secondary flex items-center gap-1.5 text-xs shadow-md"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          New Agent
        </button>
      </div>

      {/* Canvas */}
      <AgentsCanvas
        agents={agents}
        runningTaskCounts={runningTaskCounts}
        onPositionChange={handlePositionChange}
        onNodeClick={handleNodeClick}
      />

      <AgentEditModal
        isOpen={showModal}
        projectId={projectId}
        agent={editingAgent}
        onClose={() => {
          setShowModal(false);
          setEditingAgent(null);
        }}
        onSave={editingAgent ? handleUpdate : handleCreate}
        onDelete={editingAgent ? handleDelete : undefined}
        onSpawnChat={editingAgent && onSpawnChat ? () => onSpawnChat(editingAgent.id) : undefined}
      />
    </div>
  );
}
