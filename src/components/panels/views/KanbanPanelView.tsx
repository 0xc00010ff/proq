'use client';

import React, { useCallback, useRef, useState } from 'react';
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
  onFileDropCreateTask?: (files: File[]) => void | Promise<void>;
}

/**
 * Kanban panel view. The sub-nav exposes a Board ↔ Grid toggle on the right;
 * inner content stays as KanbanBoard or GridView unchanged.
 */
export function KanbanPanelView(props: KanbanPanelViewProps) {
  const { viewType, onChangeViewType, onChangePanelKind, onFileDropCreateTask } = props;
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!onFileDropCreateTask) return;
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragOver(true);
  }, [onFileDropCreateTask]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!onFileDropCreateTask) return;
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, [onFileDropCreateTask]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!onFileDropCreateTask) return;
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, [onFileDropCreateTask]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!onFileDropCreateTask) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (!e.dataTransfer.files.length) return;
    const files = Array.from(e.dataTransfer.files);
    void onFileDropCreateTask(files);
  }, [onFileDropCreateTask]);

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
      <div
        className="absolute inset-0 overflow-hidden"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div
            className="absolute inset-0 z-40 bg-bronze-500/10 border-2 border-dashed border-bronze-500/40 rounded-lg flex items-center justify-center cursor-pointer"
            onClick={() => { dragCounterRef.current = 0; setIsDragOver(false); }}
          >
            <div className="bg-zinc-900/90 border border-bronze-500/30 rounded-lg px-6 py-4 shadow-xl pointer-events-none">
              <p className="text-sm font-medium text-bronze-500">Drop to create new task</p>
            </div>
          </div>
        )}
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
