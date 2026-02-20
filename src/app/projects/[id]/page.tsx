'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { TopBar, type TabOption } from '@/components/TopBar';
import { KanbanBoard } from '@/components/KanbanBoard';
import TerminalPanel from '@/components/TerminalPanel';
import { LiveTab } from '@/components/LiveTab';
import { CodeTab } from '@/components/CodeTab';
import { TaskModal } from '@/components/TaskModal';
import { TaskAgentModal } from '@/components/TaskAgentModal';
import { useProjects } from '@/components/ProjectsProvider';
import type { Task, ExecutionMode } from '@/lib/types';

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { projects, tasksByProject, refreshTasks } = useProjects();

  const [activeTab, setActiveTab] = useState<TabOption>('project');
  const [chatPercent, setChatPercent] = useState(60);
  const [isDragging, setIsDragging] = useState(false);
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  const [modalTask, setModalTask] = useState<Task | null>(null);
  const [agentModalTask, setAgentModalTask] = useState<Task | null>(null);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('sequential');
  const [dispatchedTaskIds, setDispatchedTaskIds] = useState<Set<string>>(new Set());
  const [cleanupTimes, setCleanupTimes] = useState<Record<string, number>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  const project = projects.find((p) => p.id === projectId);
  const tasks = tasksByProject[projectId] || [];

  // Update document title with project id (slug)
  useEffect(() => {
    document.title = project ? `proq | ${project.name}` : 'proq';
  }, [project?.id]);

  // Restore last tab when switching projects
  useEffect(() => {
    if (project) setActiveTab(project.activeTab || 'project');
  }, [project?.id]);

  // Fetch terminal open/closed state from server
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/terminal-open`)
      .then((res) => res.json())
      .then((data) => setTerminalCollapsed(!data.open))
      .catch(() => {});
  }, [projectId]);

  const fetchExecutionMode = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/execution-mode`);
      const data = await res.json();
      setExecutionMode(data.mode);
      setDispatchedTaskIds(new Set(data.dispatchedTaskIds || []));
      setCleanupTimes(data.cleanupTimes || {});
    } catch (e) {
      console.error('Failed to fetch execution mode:', e);
    }
  }, [projectId]);

  const refresh = useCallback(() => {
    refreshTasks(projectId);
    fetchExecutionMode();
  }, [projectId, refreshTasks, fetchExecutionMode]);

  // Fetch execution mode on project load
  useEffect(() => {
    if (projectId) fetchExecutionMode();
  }, [projectId, fetchExecutionMode]);

  // Auto-refresh tasks every 5 seconds
  useEffect(() => {
    if (!projectId) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [projectId, refresh]);

  // Keep agent modal in sync with polled task data
  useEffect(() => {
    if (agentModalTask) {
      const updated = tasks.find((t) => t.id === agentModalTask.id);
      if (updated) setAgentModalTask(updated);
    }
  }, [tasks]);

  const deleteTask = async (taskId: string) => {
    await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
      method: 'DELETE',
    });
    refresh();
  };

  const reorderTasks = async (reordered: Task[]) => {
    const items = reordered.map((t) => ({
      id: t.id,
      order: t.order ?? 0,
      status: t.status,
    }));

    await fetch(`/api/projects/${projectId}/tasks/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });

    refresh();
  };

  const updateTask = async (taskId: string, data: Partial<Task>) => {
    setModalTask((prev) =>
      prev && prev.id === taskId
        ? { ...prev, ...data, updatedAt: new Date().toISOString() }
        : prev
    );
    await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    refresh();
  };

  const handleExecutionModeChange = async (mode: ExecutionMode) => {
    setExecutionMode(mode);
    await fetch(`/api/projects/${projectId}/execution-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
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
    refresh();
  };

  const handleTabChange = useCallback((tab: TabOption) => {
    setActiveTab(tab);
    fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeTab: tab }),
    }).catch(() => {});
  }, [projectId]);

  const toggleTerminalCollapsed = useCallback(() => {
    setTerminalCollapsed((prev) => {
      const next = !prev;
      fetch(`/api/projects/${projectId}/terminal-open`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ open: !next }),
      }).catch(() => {});
      return next;
    });
  }, [projectId]);

  // Resize handle
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
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
      setChatPercent(Math.min(85, Math.max(15, percent)));
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
        Project not found
      </div>
    );
  }

  return (
    <>
      <TopBar project={project} activeTab={activeTab} onTabChange={handleTabChange} />

      <main ref={containerRef} className="flex-1 flex flex-col overflow-hidden relative">
        {activeTab === 'project' && (
          <>
            <div
              className="flex-1 min-h-0 overflow-hidden"
              style={terminalCollapsed ? undefined : { flexBasis: `${100 - chatPercent}%` }}
            >
              <KanbanBoard
                tasks={tasks}
                onReorderTasks={reorderTasks}
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
                dispatchedTaskIds={dispatchedTaskIds}
              />
            </div>

            {!terminalCollapsed && (
              <div
                onMouseDown={handleMouseDown}
                className={`w-full h-0 border-t border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 cursor-row-resize relative z-10 ${
                  isDragging ? 'border-zinc-400 dark:border-zinc-600' : ''
                }`}
                style={{ margin: '-2px 0', padding: '2px 0' }}
              />
            )}

            <TerminalPanel
              projectId={projectId}
              projectPath={project?.path}
              style={{ flexBasis: `${chatPercent}%` }}
              collapsed={terminalCollapsed}
              onToggleCollapsed={toggleTerminalCollapsed}
            />
          </>
        )}

        {activeTab === 'live' && <LiveTab project={project} />}
        {activeTab === 'code' && <CodeTab project={project} />}
      </main>

      {isDragging && <div className="fixed inset-0 z-50 cursor-row-resize" />}

      {agentModalTask && (
        <TaskAgentModal
          task={agentModalTask}
          projectId={projectId}
          isQueued={agentModalTask.status === 'in-progress' && agentModalTask.locked && dispatchedTaskIds.size > 0 && !dispatchedTaskIds.has(agentModalTask.id)}
          cleanupExpiresAt={cleanupTimes[agentModalTask.id]}
          onClose={() => setAgentModalTask(null)}
          onComplete={async (taskId) => {
            const doneTasks = tasks.filter(t => t.status === 'done');
            const minOrder = doneTasks.length > 0
              ? Math.min(...doneTasks.map(t => t.order ?? 0))
              : 0;
            await updateTask(taskId, { status: 'done', order: minOrder - 1 });
            setAgentModalTask(null);
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
            refresh();
          }}
          onSave={updateTask}
          onMoveToInProgress={async (taskId, currentData) => {
            const taskData = tasks.find((t) => t.id === taskId) || modalTask!;
            // Save task content first
            await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(currentData),
            });
            // Move to in-progress via reorder — same code path as drag-drop
            await fetch(`/api/projects/${projectId}/tasks/reorder`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                items: [{ id: taskId, order: taskData.order ?? 0, status: 'in-progress' }],
              }),
            });
            const freshTask = { ...taskData, ...currentData, status: 'in-progress' as const, locked: true };
            setModalTask(null);
            setAgentModalTask(freshTask);
            refresh();
          }}
        />
      )}
    </>
  );
}
