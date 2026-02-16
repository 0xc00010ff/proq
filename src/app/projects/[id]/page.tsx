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
import type { Task } from '@/lib/types';

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { projects, tasksByProject, refreshTasks } = useProjects();

  const [activeTab, setActiveTab] = useState<TabOption>('project');
  const [chatPercent, setChatPercent] = useState(60);
  const [isDragging, setIsDragging] = useState(false);
  const [modalTask, setModalTask] = useState<Task | null>(null);
  const [agentModalTask, setAgentModalTask] = useState<Task | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const project = projects.find((p) => p.id === projectId);
  const tasks = tasksByProject[projectId] || [];

  const refresh = useCallback(() => {
    refreshTasks(projectId);
  }, [projectId, refreshTasks]);

  // Auto-refresh tasks every 5 seconds
  useEffect(() => {
    if (!projectId) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [projectId, refresh]);

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
      <TopBar project={project} activeTab={activeTab} onTabChange={setActiveTab} />

      <main ref={containerRef} className="flex-1 flex flex-col overflow-hidden relative">
        {activeTab === 'project' && (
          <>
            <div
              className="flex-1 min-h-0 overflow-hidden"
              style={{ flexBasis: `${100 - chatPercent}%` }}
            >
              <KanbanBoard
                tasks={tasks}
                onReorderTasks={reorderTasks}
                onAddTask={handleAddTask}
                onDeleteTask={deleteTask}
                onClickTask={(task) => {
                  if (task.status === 'in-progress' && task.locked) {
                    setAgentModalTask(task);
                  } else {
                    setModalTask(task);
                  }
                }}
                onRefreshTasks={refresh}
              />
            </div>

            <div
              onMouseDown={handleMouseDown}
              className={`w-full h-0 border-t border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 cursor-row-resize relative z-10 ${
                isDragging ? 'border-zinc-400 dark:border-zinc-600' : ''
              }`}
              style={{ margin: '-2px 0', padding: '2px 0' }}
            />

            <TerminalPanel
              projectId={projectId}
              style={{ flexBasis: `${chatPercent}%` }}
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
          onClose={() => setAgentModalTask(null)}
        />
      )}

      {modalTask && (
        <TaskModal
          task={modalTask}
          isOpen={true}
          onClose={async () => {
            const current = tasks.find((t) => t.id === modalTask.id);
            if (current && !current.title.trim()) {
              await deleteTask(current.id);
            }
            setModalTask(null);
            refresh();
          }}
          onSave={updateTask}
        />
      )}
    </>
  );
}
