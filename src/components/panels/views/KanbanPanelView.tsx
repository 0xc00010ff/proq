'use client';

import React from 'react';
import { LayoutGridIcon, Columns3Icon } from 'lucide-react';
import { KanbanBoard } from '@/components/KanbanBoard';
import { GridView } from '@/components/GridView';
import { PanelChrome } from '@/components/panels/PanelChrome';
import type {
  Agent,
  ExecutionMode,
  FollowUpDraft,
  PanelKind,
  Task,
  TaskColumns,
  TaskStatus,
  ViewType,
} from '@/lib/types';

interface KanbanPanelViewProps {
  projectId: string;
  viewType: ViewType;
  onChangeViewType: (viewType: ViewType) => void;
  onChangePanelKind: (kind: PanelKind) => void;

  tasks: TaskColumns;
  executionMode: ExecutionMode;
  onExecutionModeChange: (mode: ExecutionMode) => void;
  onAddTask: () => void;
  onMoveTask: (taskId: string, toColumn: TaskStatus, toIndex: number) => void;
  onDeleteTask: (taskId: string) => Promise<void>;
  onClickTask: (task: Task) => void;
  onRefreshTasks: () => void;
  onDragActiveChange: (active: boolean) => void;
  agentMap: Map<string, Agent>;
  parallelMode: boolean;
  currentBranch?: string;
  onSwitchBranch?: (branch: string) => void;
  defaultBranch: string;
  followUpDraftsRef: React.MutableRefObject<Map<string, FollowUpDraft>>;
  onFollowUpDraftChange: (taskId: string, draft: FollowUpDraft | null) => void;
}

/**
 * Kanban panel view. The sub-nav exposes a Board ↔ Grid toggle on the right;
 * inner content stays as KanbanBoard or GridView unchanged.
 */
export function KanbanPanelView(props: KanbanPanelViewProps) {
  const { viewType, onChangeViewType, onChangePanelKind } = props;

  const subnav = (
    <div className="flex-1 flex items-center justify-end gap-0.5 px-2">
      <button
        onClick={() => onChangeViewType('kanban')}
        title="Board"
        className={`p-1 rounded ${viewType === 'kanban' ? 'bg-surface-hover text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-hover/30'}`}
      >
        <Columns3Icon className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onChangeViewType('grid')}
        title="Grid"
        className={`p-1 rounded ${viewType === 'grid' ? 'bg-surface-hover text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-hover/30'}`}
      >
        <LayoutGridIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return (
    <PanelChrome currentKind="kanban" onChangeKind={onChangePanelKind} subnavContent={subnav}>
      <div className="absolute inset-0 overflow-hidden">
        {viewType === 'grid' ? (
          <GridView
            tasks={props.tasks}
            projectId={props.projectId}
            executionMode={props.executionMode}
            onExecutionModeChange={props.onExecutionModeChange}
            onAddTask={props.onAddTask}
            onClickTask={props.onClickTask}
            followUpDraftsRef={props.followUpDraftsRef}
            onFollowUpDraftChange={props.onFollowUpDraftChange}
            parallelMode={props.parallelMode}
            currentBranch={props.currentBranch}
            onSwitchBranch={props.onSwitchBranch}
            defaultBranch={props.defaultBranch}
          />
        ) : (
          <KanbanBoard
            tasks={props.tasks}
            onMoveTask={props.onMoveTask}
            onAddTask={props.onAddTask}
            onDeleteTask={props.onDeleteTask}
            onClickTask={props.onClickTask}
            onRefreshTasks={props.onRefreshTasks}
            executionMode={props.executionMode}
            onExecutionModeChange={props.onExecutionModeChange}
            onDragActiveChange={props.onDragActiveChange}
            activeBranch={props.currentBranch}
            agentMap={props.agentMap}
          />
        )}
      </div>
    </PanelChrome>
  );
}
