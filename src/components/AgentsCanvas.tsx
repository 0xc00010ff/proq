'use client';

import React, { useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
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
  runningTaskCounts: Record<string, number>; // agentId → count
  onPositionChange: (agentId: string, position: { x: number; y: number }) => void;
  onNodeClick: (agent: Agent) => void;
}

const nodeTypes = { agent: AgentNode };

function agentsToNodes(agents: Agent[], runningCounts: Record<string, number>): Node<AgentNodeData>[] {
  return agents.map((agent, i) => ({
    id: agent.id,
    type: 'agent' as const,
    position: agent.position ?? { x: 100 + i * 220, y: 100 },
    data: {
      label: agent.name,
      role: agent.role,
      color: agent.avatar?.color || '#8b5cf6',
      runningCount: runningCounts[agent.id] || 0,
    },
  }));
}

export function AgentsCanvas({ agents, runningTaskCounts, onPositionChange, onNodeClick }: AgentsCanvasProps) {
  const initialNodes = useMemo(
    () => agentsToNodes(agents, runningTaskCounts),
    // Only rebuild when agent list identity changes, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agents.map((a) => a.id).join(',')],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  // Keep node data in sync with agent props (running counts etc.)
  useMemo(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const agent = agents.find((a) => a.id === n.id);
        if (!agent) return n;
        return {
          ...n,
          data: {
            label: agent.name,
            role: agent.role,
            color: agent.avatar?.color || '#8b5cf6',
            runningCount: runningTaskCounts[agent.id] || 0,
          },
        };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, runningTaskCounts]);

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
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background gap={20} size={1} className="!bg-surface-primary" />
        <Controls
          showInteractive={false}
          className="!bg-surface-secondary !border-border-default !shadow-sm [&_button]:!bg-surface-secondary [&_button]:!border-border-default [&_button]:!text-text-secondary [&_button:hover]:!bg-surface-hover"
        />
        <MiniMap
          className="!bg-surface-secondary !border-border-default"
          nodeColor={(n) => {
            const data = n.data as AgentNodeData;
            return data.color || '#8b5cf6';
          }}
          maskColor="rgba(0, 0, 0, 0.2)"
        />
      </ReactFlow>
    </div>
  );
}
