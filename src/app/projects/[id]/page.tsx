'use client';

import { useState, useEffect, useCallback, useRef, type DragEvent } from 'react';
import { useParams } from 'next/navigation';
import { TopBar, type TabOption } from '@/components/TopBar';
import { KanbanBoard } from '@/components/KanbanBoard';
import WorkbenchPanel from '@/components/WorkbenchPanel';
import { LiveTab } from '@/components/LiveTab';
import { CodeTab } from '@/components/CodeTab';
import { TaskModal } from '@/components/TaskModal';
import { TaskAgentModal } from '@/components/TaskAgentModal';
import { UndoModal } from '@/components/UndoModal';
import { ParallelModeModal } from '@/components/ParallelModeModal';
import { AlertModal } from '@/components/Modal';
import { useProjects } from '@/components/ProjectsProvider';
import { emptyColumns } from '@/components/ProjectsProvider';
import type { Task, TaskStatus, TaskColumns, ExecutionMode, FollowUpDraft, TaskAttachment } from '@/lib/types';
import { uploadFiles } from '@/lib/upload';
import { useTaskEvents, type TaskUpdateEvent } from '@/hooks/useTaskEvents';

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { projects, tasksByProject, refreshTasks, setTasksByProject } = useProjects();

  const [activeTab, setActiveTab] = useState<TabOption>('project');
  const [chatPercent, setChatPercent] = useState(60);
  const [isDragging, setIsDragging] = useState(false);
  const [workbenchCollapsed, setTerminalCollapsed] = useState(true);
  const [modalTask, setModalTask] = useState<Task | null>(null);
  const [agentModalTask, setAgentModalTask] = useState<Task | null>(null);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('sequential');
  const [cleanupTimes, setCleanupTimes] = useState<Record<string, number>>({});
  const [undoEntry, setUndoEntry] = useState<{ task: Task; column: TaskStatus } | null>(null);
  const [showParallelModal, setShowParallelModal] = useState(false);
  const [showModeBlockedModal, setShowModeBlockedModal] = useState(false);
  const [currentBranch, setCurrentBranch] = useState<string>('main');
  const [branches, setBranches] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const followUpDraftsRef = useRef<Map<string, FollowUpDraft>>(new Map());
  const [boardDragOver, setBoardDragOver] = useState(false);
  const boardDragCounter = useRef(0);

  const project = projects.find((p) => p.id === projectId);
  const columns: TaskColumns = tasksByProject[projectId] || emptyColumns();

  // Update document title with project id (slug)
  useEffect(() => {
    document.title = project ? `proq | ${project.name}` : 'proq';
  }, [project?.id]);

  // Restore last tab when switching projects
  useEffect(() => {
    if (project) setActiveTab(project.activeTab || 'project');
  }, [project?.id]);

  // Restore terminal open/closed state and height from project
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/workbench-state`)
      .then((res) => res.json())
      .then((data) => {
        setTerminalCollapsed(!data.open);
        if (typeof data.height === 'number') setChatPercent(data.height);
      })
      .catch(() => {});
  }, [projectId]);

  const fetchExecutionMode = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/execution-mode`);
      const data = await res.json();
      setExecutionMode(data.mode);
      setCleanupTimes(data.cleanupTimes || {});
    } catch (e) {
      console.error('Failed to fetch execution mode:', e);
    }
  }, [projectId]);

  const fetchBranchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/git`);
      if (res.ok) {
        const data = await res.json();
        setCurrentBranch(data.current || 'main');
        setBranches(data.branches || []);
      }
    } catch {
      // git API may not be available for non-git projects
    }
  }, [projectId]);

  const refreshDetachedHead = useCallback(async () => {
    try {
      await fetch(`/api/projects/${projectId}/git`, { method: 'PATCH' });
    } catch {
      // best effort
    }
  }, [projectId]);

  const refresh = useCallback(() => {
    refreshTasks(projectId);
    fetchExecutionMode();
    fetchBranchState();
    refreshDetachedHead();
  }, [projectId, refreshTasks, fetchExecutionMode, fetchBranchState, refreshDetachedHead]);

  // Fetch execution mode and branch state on project load
  useEffect(() => {
    if (projectId) {
      fetchExecutionMode();
      fetchBranchState();
    }
  }, [projectId, fetchExecutionMode, fetchBranchState]);

  // SSE delivers targeted {taskId, changes} — merge directly into local state.
  // No fetching. Only server-initiated changes (agentStatus, status) come via SSE.
  const handleTaskUpdate = useCallback((event: TaskUpdateEvent) => {
    setTasksByProject((prev) => {
      const cols = prev[projectId] || emptyColumns();
      const { taskId, changes } = event;
      const newStatus = changes.status as TaskStatus | undefined;

      // Find the task in any column
      for (const status of ['todo', 'in-progress', 'verify', 'done'] as TaskStatus[]) {
        const idx = cols[status].findIndex((t) => t.id === taskId);
        if (idx === -1) continue;

        const task = cols[status][idx];
        const merged = { ...task, ...changes } as Task;
        const updated = { ...cols };

        if (newStatus && newStatus !== status) {
          // Move between columns
          updated[status] = cols[status].filter((t) => t.id !== taskId);
          updated[newStatus] = [...cols[newStatus], merged];
        } else {
          // Update in place
          updated[status] = [...cols[status]];
          updated[status][idx] = merged;
        }
        return { ...prev, [projectId]: updated };
      }
      return prev; // task not found — ignore
    });
  }, [projectId, setTasksByProject]);

  useTaskEvents(projectId, handleTaskUpdate);

  // Slow fallback poll: catches anything SSE misses (supervisor creates, branch state, etc.)
  useEffect(() => {
    if (!projectId) return;
    const interval = setInterval(() => {
      refreshTasks(projectId);
      fetchExecutionMode();
      fetchBranchState();
      refreshDetachedHead();
    }, 30_000);
    return () => clearInterval(interval);
  }, [projectId, refreshTasks, fetchExecutionMode, fetchBranchState, refreshDetachedHead]);

  // Cmd+Z to undo last delete — peeks without restoring
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'z' && e.metaKey && !e.shiftKey && !e.ctrlKey && !undoEntry) {
        // Don't intercept if user is typing in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        e.preventDefault();
        try {
          const res = await fetch(`/api/projects/${projectId}/tasks/undo`);
          if (res.ok) {
            const data = await res.json();
            setUndoEntry({ task: data.task, column: data.column });
          }
        } catch {
          // no-op
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [projectId, undoEntry]);

  // Keep agent modal in sync with polled task data
  useEffect(() => {
    if (agentModalTask) {
      // Search across all columns
      for (const col of Object.values(columns)) {
        const updated = col.find((t) => t.id === agentModalTask.id);
        if (updated) {
          setAgentModalTask(updated);
          break;
        }
      }
    }
  }, [columns]);

  const deleteTask = async (taskId: string) => {
    // Optimistically remove from UI
    setTasksByProject((prev) => {
      const cols = prev[projectId] || emptyColumns();
      const updated: TaskColumns = { ...cols };
      for (const status of ['todo', 'in-progress', 'verify', 'done'] as TaskStatus[]) {
        const idx = updated[status].findIndex((t) => t.id === taskId);
        if (idx !== -1) {
          updated[status] = [...updated[status]];
          updated[status].splice(idx, 1);
          break;
        }
      }
      return { ...prev, [projectId]: updated };
    });

    await fetch(`/api/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' });
  };

  const moveTask = (taskId: string, toColumn: TaskStatus, toIndex: number) => {
    // Optimistically update task state so the UI is instant
    setTasksByProject((prev) => {
      const cols = prev[projectId] || emptyColumns();
      // Find and remove the task from its current column
      let task: Task | undefined;
      const updated: TaskColumns = { ...cols };
      for (const status of ['todo', 'in-progress', 'verify', 'done'] as TaskStatus[]) {
        const idx = updated[status].findIndex((t) => t.id === taskId);
        if (idx !== -1) {
          task = updated[status][idx];
          updated[status] = [...updated[status]];
          updated[status].splice(idx, 1);
          break;
        }
      }
      if (!task) return prev;

      // Apply optimistic field changes
      const optimistic: Task = { ...task, status: toColumn };
      if (toColumn === 'in-progress' && task.status === 'todo') {
        optimistic.agentStatus = 'starting';
      } else if (toColumn === 'todo') {
        optimistic.agentStatus = null;
        optimistic.findings = '';
        optimistic.humanSteps = '';
      }

      // Insert at target position
      updated[toColumn] = [...updated[toColumn]];
      updated[toColumn].splice(toIndex, 0, optimistic);
      return { ...prev, [projectId]: updated };
    });

    // Fire API in background
    fetch(`/api/projects/${projectId}/tasks/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, toColumn, toIndex }),
    }).catch(() => {
      refreshTasks(projectId);
    });
  };

  const updateTask = async (taskId: string, data: Partial<Task>) => {
    // Optimistic update for modal
    setModalTask((prev) =>
      prev && prev.id === taskId
        ? { ...prev, ...data, updatedAt: new Date().toISOString() }
        : prev
    );
    // Optimistic update for board
    if (data.status || data.title) {
      setTasksByProject((prev) => {
        const cols = prev[projectId] || emptyColumns();
        const updated: TaskColumns = { ...cols };
        // Find the task
        let task: Task | undefined;
        let fromStatus: TaskStatus | undefined;
        for (const status of ['todo', 'in-progress', 'verify', 'done'] as TaskStatus[]) {
          const idx = updated[status].findIndex((t) => t.id === taskId);
          if (idx !== -1) {
            task = updated[status][idx];
            fromStatus = status;
            break;
          }
        }
        if (!task || !fromStatus) return prev;

        const merged = { ...task, ...data, updatedAt: new Date().toISOString() };
        const toStatus = (data.status || fromStatus) as TaskStatus;

        if (toStatus !== fromStatus) {
          // Move between columns
          updated[fromStatus] = updated[fromStatus].filter((t) => t.id !== taskId);
          updated[toStatus] = [...updated[toStatus], merged];
        } else {
          // Update in place
          updated[fromStatus] = [...updated[fromStatus]];
          const idx = updated[fromStatus].findIndex((t) => t.id === taskId);
          updated[fromStatus][idx] = merged;
        }
        return { ...prev, [projectId]: updated };
      });
    }
    await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  };

  // Build map of proq/* branch → task title for the branch switcher
  const taskBranchMap: Record<string, string> = {};
  for (const col of Object.values(columns)) {
    for (const t of col) {
      if (t.branch) {
        taskBranchMap[t.branch] = t.title || t.description.slice(0, 40);
      }
    }
  }

  const handleSwitchBranch = useCallback(async (branch: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch }),
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentBranch(data.current || branch);
      }
    } catch {
      // best effort
    }
  }, [projectId]);

  const hasTasksInFlight = columns['in-progress'].length > 0 || columns['verify'].length > 0;

  const handleExecutionModeChange = async (mode: ExecutionMode) => {
    // Block mode switch if tasks are in-progress or verify
    if (hasTasksInFlight) {
      setShowModeBlockedModal(true);
      return;
    }
    // Show confirmation modal when switching to parallel
    if (mode === 'parallel' && executionMode !== 'parallel') {
      setShowParallelModal(true);
      return;
    }
    setExecutionMode(mode);
    await fetch(`/api/projects/${projectId}/execution-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    refresh();
  };

  const applyParallelMode = async () => {
    setShowParallelModal(false);
    setExecutionMode('parallel');
    await fetch(`/api/projects/${projectId}/execution-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'parallel' }),
    });
    refresh();
  };

  const handleAddTask = async () => {
    const res = await fetch(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '', description: '' }),
    });
    const newTask: Task = await res.json();
    setModalTask(newTask);
    // SSE will pick up the new task
  };

  const handleBoardDragEnter = useCallback((e: DragEvent) => {
    // Only respond to file drags, not dnd-kit task drags
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    boardDragCounter.current++;
    setBoardDragOver(true);
  }, []);

  const handleBoardDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    boardDragCounter.current--;
    if (boardDragCounter.current <= 0) {
      boardDragCounter.current = 0;
      setBoardDragOver(false);
    }
  }, []);

  const handleBoardDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleBoardDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    boardDragCounter.current = 0;
    setBoardDragOver(false);
    if (!e.dataTransfer.files.length) return;

    // Capture files synchronously — dataTransfer is invalidated after yielding
    const files = Array.from(e.dataTransfer.files);

    // Create a new task
    const res = await fetch(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '', description: '' }),
    });
    const newTask: Task = await res.json();

    // Upload files to disk and get attachment metadata
    const attachments = await uploadFiles(files);

    // Patch the task with attachments
    await fetch(`/api/projects/${projectId}/tasks/${newTask.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachments }),
    });

    setModalTask({ ...newTask, attachments });
    // SSE will pick up the new task
  }, [projectId]);

  const handleTabChange = useCallback((tab: TabOption) => {
    setActiveTab(tab);
    fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeTab: tab }),
    }).catch(() => {});
  }, [projectId]);

  const patchWorkbenchState = useCallback((data: { open?: boolean; height?: number }) => {
    fetch(`/api/projects/${projectId}/workbench-state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => {});
  }, [projectId]);

  const toggleWorkbenchCollapsed = useCallback(() => {
    setTerminalCollapsed((prev) => {
      const next = !prev;
      patchWorkbenchState({ open: !next });
      return next;
    });
  }, [patchWorkbenchState]);

  const expandWorkbench = useCallback(() => {
    setTerminalCollapsed((prev) => {
      if (!prev) return prev; // already open
      patchWorkbenchState({ open: true });
      return false;
    });
    setChatPercent((prev) => Math.max(prev, 25));
  }, [patchWorkbenchState]);

  // Resize handle (tab bar is the drag target)
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const percent = ((rect.height - y) / rect.height) * 100;
      // Drag up from closed state → expand
      if (workbenchCollapsed && percent > 5) {
        toggleWorkbenchCollapsed();
      }
      // Allow dragging down to 3% so snap-to-close is visible
      setChatPercent(Math.min(100, Math.max(3, percent)));
    };
    const handleMouseUp = (e: MouseEvent) => {
      // Snap closed if terminal height < 200px
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const pixelHeight = rect.height - y;
        if (pixelHeight < 200) {
          toggleWorkbenchCollapsed();
          setChatPercent(25); // reset for next open
        } else {
          // Persist the terminal height
          const finalPercent = Math.min(100, Math.max(3, ((rect.height - y) / rect.height) * 100));
          patchWorkbenchState({ height: finalPercent });
        }
      }
      setIsDragging(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, workbenchCollapsed, toggleWorkbenchCollapsed, patchWorkbenchState]);

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
        Project not found
      </div>
    );
  }

  return (
    <>
      <TopBar
        project={project}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        currentBranch={currentBranch}
        branches={branches}
        taskBranchMap={taskBranchMap}
        onSwitchBranch={handleSwitchBranch}
      />

      <main ref={containerRef} className="flex-1 flex flex-col overflow-hidden relative">
        {activeTab === 'project' && (
          <>
            <div
              className="flex-1 min-h-0 overflow-hidden relative"
              style={workbenchCollapsed ? undefined : { flexBasis: `${100 - chatPercent}%` }}
              onDragEnter={handleBoardDragEnter}
              onDragLeave={handleBoardDragLeave}
              onDragOver={handleBoardDragOver}
              onDrop={handleBoardDrop}
            >
              {boardDragOver && (
                <div className="absolute inset-0 z-40 bg-steel/10 border-2 border-dashed border-steel/40 rounded-lg flex items-center justify-center pointer-events-none">
                  <div className="bg-zinc-900/90 border border-steel/30 rounded-lg px-6 py-4 shadow-xl">
                    <p className="text-sm font-medium text-steel">Drop to create new task</p>
                  </div>
                </div>
              )}
              <KanbanBoard
                tasks={columns}
                onMoveTask={moveTask}
                onAddTask={handleAddTask}
                onDeleteTask={deleteTask}
                onClickTask={(task) => {
                  if (task.status === 'todo') {
                    setModalTask(task);
                  } else {
                    setAgentModalTask(task);
                  }
                }}
                onRefreshTasks={refresh}
                executionMode={executionMode}
                onExecutionModeChange={handleExecutionModeChange}
                activeBranch={currentBranch}
              />
            </div>

            <WorkbenchPanel
              projectId={projectId}
              projectPath={project.path}
              style={{ flexBasis: `${chatPercent}%` }}
              collapsed={workbenchCollapsed}
              onToggleCollapsed={toggleWorkbenchCollapsed}
              onExpand={expandWorkbench}
              onResizeStart={handleResizeStart}
              isDragging={isDragging}
            />
          </>
        )}

        {activeTab === 'live' && project && <LiveTab project={project} />}
        {activeTab === 'code' && project && <CodeTab project={project} />}
      </main>

      {isDragging && <div className="fixed inset-0 z-50 cursor-grabbing" />}

      {agentModalTask && (
        <TaskAgentModal
          task={agentModalTask}
          projectId={projectId}
          isQueued={agentModalTask.agentStatus === 'queued'}
          cleanupExpiresAt={cleanupTimes[agentModalTask.id]}
          followUpDraft={followUpDraftsRef.current.get(agentModalTask.id)}
          onFollowUpDraftChange={(draft) => {
            if (draft) followUpDraftsRef.current.set(agentModalTask.id, draft);
            else followUpDraftsRef.current.delete(agentModalTask.id);
          }}
          onClose={() => setAgentModalTask(null)}
          onUpdateTitle={(taskId, title) => updateTask(taskId, { title })}
          onComplete={async (taskId) => {
            followUpDraftsRef.current.delete(taskId);
            await updateTask(taskId, { status: 'done' });
            setAgentModalTask(null);
            fetchBranchState();
          }}
          onResumeEditing={async (taskId) => {
            await updateTask(taskId, { status: 'verify' });
          }}
          parallelMode={executionMode === 'parallel'}
          currentBranch={currentBranch}
          onSwitchBranch={handleSwitchBranch}
        />
      )}

      {undoEntry && (
        <UndoModal
          task={undoEntry.task}
          column={undoEntry.column}
          isOpen={true}
          onRestore={async () => {
            await fetch(`/api/projects/${projectId}/tasks/undo`, { method: 'POST' });
            setUndoEntry(null);
            refreshTasks(projectId);
          }}
          onDiscard={() => {
            setUndoEntry(null);
          }}
        />
      )}

      {modalTask && (
        <TaskModal
          task={modalTask}
          isOpen={true}
          onClose={async (isEmpty: boolean) => {
            if (isEmpty) {
              await deleteTask(modalTask.id);
            }
            setModalTask(null);
          }}
          onSave={updateTask}
          onMoveToInProgress={async (taskId, currentData) => {
            // Close modal and optimistically update immediately
            setModalTask(null);
            setTasksByProject((prev) => {
              const cols = prev[projectId] || emptyColumns();
              const todoCol = cols.todo.filter((t) => t.id !== taskId);
              const task = cols.todo.find((t) => t.id === taskId);
              if (!task) return prev;
              const updatedTask = { ...task, ...currentData, status: 'in-progress' as const, agentStatus: 'starting' as const };
              return {
                ...prev,
                [projectId]: {
                  ...cols,
                  todo: todoCol,
                  "in-progress": [updatedTask, ...cols["in-progress"]],
                },
              };
            });
            // Save content + dispatch in background
            fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(currentData),
            }).then(() =>
              fetch(`/api/projects/${projectId}/tasks/reorder`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId, toColumn: 'in-progress', toIndex: 0 }),
              })
            );
          }}
        />
      )}

      <ParallelModeModal
        isOpen={showParallelModal}
        onConfirm={applyParallelMode}
        onCancel={() => setShowParallelModal(false)}
      />

      <AlertModal
        isOpen={showModeBlockedModal}
        onClose={() => setShowModeBlockedModal(false)}
        title="Can't switch execution mode"
      >
        Complete or move all in-progress and verify tasks back to Todo before switching modes.
      </AlertModal>
    </>
  );
}
