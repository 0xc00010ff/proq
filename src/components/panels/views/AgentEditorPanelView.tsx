'use client';

import React from 'react';
import { AgentsView } from '@/components/AgentsView';
import { PanelChrome } from '@/components/panels/PanelChrome';
import type { PanelKind, TaskColumns } from '@/lib/types';

interface AgentEditorPanelViewProps {
  projectId: string;
  tasks: TaskColumns;
  defaultAgentId?: string;
  onSpawnChat: (agentId: string) => void;
  onSetDefaultAgent: (agentId: string) => void;
  onChangePanelKind: (kind: PanelKind) => void;
}

/**
 * Agent editor view (canvas of agents). Sub-nav is empty besides the switcher;
 * the floating "New Agent" button stays inside AgentsView.
 */
export function AgentEditorPanelView({
  projectId, tasks, defaultAgentId, onSpawnChat, onSetDefaultAgent, onChangePanelKind,
}: AgentEditorPanelViewProps) {
  return (
    <PanelChrome currentKind="agent-editor" onChangeKind={onChangePanelKind}>
      <div className="absolute inset-0">
        <AgentsView
          projectId={projectId}
          tasks={tasks}
          defaultAgentId={defaultAgentId}
          onSpawnChat={onSpawnChat}
          onSetDefaultAgent={onSetDefaultAgent}
        />
      </div>
    </PanelChrome>
  );
}
