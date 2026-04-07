'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Agent } from '@/lib/types';
import { AgentNode, type AgentNodeData } from './AgentNode';

interface AgentsCanvasProps {
  agents: Agent[];
  runningTasksByAgent: Record<string, { id: string; title: string }[]>; // agentId → tasks
  defaultAgentId?: string;
  onPositionChange: (agentId: string, position: { x: number; y: number }) => void;
  onNodeClick: (agent: Agent) => void;
}

const nodeTypes = { agent: AgentNode };
const FIT_VIEW_OPTIONS = { padding: 0.35, maxZoom: 1.25 };

export function AgentsCanvas({ agents, runningTasksByAgent, defaultAgentId, onPositionChange, onNodeClick }: AgentsCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentNodeData>>([]);

  // Sync nodes with agents — add new, remove deleted, update data, preserve positions
  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      const agentIds = new Set(agents.map((a) => a.id));

      // Build updated node list preserving drag positions for existing nodes
      const updated = agents.map((agent, i) => {
        const existing = prevById.get(agent.id);
        return {
          id: agent.id,
          type: 'agent' as const,
          // Preserve current position if node was already on canvas (user may have dragged it)
          position: existing?.position ?? agent.position ?? { x: 100 + i * 220, y: 100 },
          data: {
            label: agent.name,
            role: agent.role,
            runningTasks: runningTasksByAgent[agent.id] || [],
            isDefault: agent.id === defaultAgentId,
          },
        };
      });

      // Only return new array if something actually changed
      if (updated.length === prev.length && updated.every((n, idx) => {
        const p = prev[idx];
        return p.id === n.id && p.data.label === n.data.label && p.data.runningTasks === n.data.runningTasks && p.data.isDefault === n.data.isDefault;
      })) {
        return prev;
      }

      return updated;
    });
  }, [agents, runningTasksByAgent, defaultAgentId, setNodes]);

  // Debounced position save
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<AgentNodeData>>[]) => {
      onNodesChange(changes);

      // Debounce position saves
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          const nodeId = change.id;
          const pos = change.position;
          const existing = saveTimers.current.get(nodeId);
          if (existing) clearTimeout(existing);
          saveTimers.current.set(
            nodeId,
            setTimeout(() => {
              onPositionChange(nodeId, pos);
              saveTimers.current.delete(nodeId);
            }, 300),
          );
        }
      }
    },
    [onNodesChange, onPositionChange],
  );

  const handleNodeClick: NodeMouseHandler<Node<AgentNodeData>> = useCallback(
    (_event, node) => {
      const agent = agents.find((a) => a.id === node.id);
      if (agent) onNodeClick(agent);
    },
    [agents, onNodeClick],
  );

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        onNodesChange={handleNodesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background gap={16} size={1} className="!bg-surface-topbar" />
        <Controls
          showInteractive={false}
          fitViewOptions={FIT_VIEW_OPTIONS}
          className="!bg-surface-secondary !border-border-default !shadow-sm [&_button]:!bg-surface-secondary [&_button]:!border-border-default [&_button]:!text-text-secondary [&_button:hover]:!bg-surface-hover"
        />
      </ReactFlow>
    </div>
  );
}
