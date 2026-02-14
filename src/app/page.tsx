'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TerminalIcon } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { TopBar, type TabOption } from '@/components/TopBar';
import { KanbanBoard } from '@/components/KanbanBoard';
import { ChatPanel } from '@/components/ChatPanel';
import { LiveTab } from '@/components/LiveTab';
import { CodeTab } from '@/components/CodeTab';
import { AddProjectModal } from '@/components/AddProjectModal';
import { AddTaskModal } from '@/components/AddTaskModal';
import { TaskDetailModal } from '@/components/TaskDetailModal';
import type { Project, Task, ChatLogEntry } from '@/lib/types';

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Record<string, Task[]>>({});
  const [chatLog, setChatLog] = useState<ChatLogEntry[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabOption>('project');
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [chatPercent, setChatPercent] = useState(60);
  const [isDragging, setIsDragging] = useState(false);
  const [isChatView, setIsChatView] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [mainChatMessages, setMainChatMessages] = useState<ChatLogEntry[]>([
    {
      role: 'twin',
      message: "Hey! I'm your AI assistant. Ask me anything across all your projects.",
      timestamp: new Date().toISOString(),
    },
  ]);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchProjects = useCallback(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data: Project[]) => {
        setProjects(data);
        if (data.length > 0 && !activeProjectId) {
          setActiveProjectId(data[0].id);
        }
        Promise.all(
          data.map((p) =>
            fetch(`/api/projects/${p.id}/tasks`)
              .then((r) => r.json())
              .then((tasks: Task[]) => {
                setTasksByProject((prev) => ({ ...prev, [p.id]: tasks }));
              })
          )
        ).then(() => setInitialLoadDone(true));
      });
  }, [activeProjectId]);

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshTasks = useCallback(() => {
    if (!activeProjectId) return;
    fetch(`/api/projects/${activeProjectId}/tasks`)
      .then((r) => r.json())
      .then((tasks: Task[]) => {
        setTasksByProject((prev) => ({ ...prev, [activeProjectId]: tasks }));
      });
  }, [activeProjectId]);

  // Auto-refresh tasks every 5 seconds
  useEffect(() => {
    if (!activeProjectId) return;
    const interval = setInterval(refreshTasks, 5000);
    return () => clearInterval(interval);
  }, [activeProjectId, refreshTasks]);

  // Fetch chat for active project
  useEffect(() => {
    if (!activeProjectId) return;
    fetch(`/api/projects/${activeProjectId}/chat`)
      .then((r) => r.json())
      .then((log: ChatLogEntry[]) => setChatLog(log));
  }, [activeProjectId]);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const activeTasks = tasksByProject[activeProjectId] || [];

  const deleteTask = async (taskId: string) => {
    setTasksByProject((prev) => ({
      ...prev,
      [activeProjectId]: (prev[activeProjectId] || []).filter((t) => t.id !== taskId),
    }));
    await fetch(`/api/projects/${activeProjectId}/tasks/${taskId}`, {
      method: 'DELETE',
    });
  };

  const reorderTasks = async (reordered: Task[]) => {
    // Optimistic update
    setTasksByProject((prev) => ({
      ...prev,
      [activeProjectId]: reordered,
    }));

    // Build reorder items for all affected columns
    const items = reordered.map((t) => ({
      id: t.id,
      order: t.order ?? 0,
      status: t.status,
    }));

    await fetch(`/api/projects/${activeProjectId}/tasks/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
  };

  const updateTask = async (taskId: string, data: Partial<Task>) => {
    // Optimistic update
    setTasksByProject((prev) => ({
      ...prev,
      [activeProjectId]: (prev[activeProjectId] || []).map((t) =>
        t.id === taskId ? { ...t, ...data, updatedAt: new Date().toISOString() } : t
      ),
    }));
    // Also update selected task if it's the one being edited
    setSelectedTask((prev) =>
      prev && prev.id === taskId
        ? { ...prev, ...data, updatedAt: new Date().toISOString() }
        : prev
    );
    await fetch(`/api/projects/${activeProjectId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  };

  const sendMessage = async (content: string) => {
    const entry: ChatLogEntry = {
      role: 'brian',
      message: content,
      timestamp: new Date().toISOString(),
    };
    setChatLog((prev) => [...prev, entry]);
    await fetch(`/api/projects/${activeProjectId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'brian', message: content }),
    });
  };

  const sendMainChatMessage = (content: string) => {
    const entry: ChatLogEntry = {
      role: 'brian',
      message: content,
      timestamp: new Date().toISOString(),
    };
    setMainChatMessages((prev) => [...prev, entry]);
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

  const handleSelectProject = (id: string) => {
    setActiveProjectId(id);
    setIsChatView(false);
  };

  const handleSelectChat = () => {
    setIsChatView(true);
  };

  const chatPreview =
    mainChatMessages.length > 0
      ? mainChatMessages[mainChatMessages.length - 1].message.slice(0, 60) +
        (mainChatMessages[mainChatMessages.length - 1].message.length > 60 ? '\u2026' : '')
      : undefined;

  if (!initialLoadDone) {
    return (
      <div className="flex h-screen w-full bg-zinc-950 text-zinc-100 items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      <Sidebar
        projects={projects}
        tasksByProject={tasksByProject}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
        onAddProject={() => setShowAddProject(true)}
        isChatActive={isChatView}
        onSelectChat={handleSelectChat}
        chatPreview={chatPreview}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {isChatView ? (
          <>
            <header className="h-16 border-b border-zinc-800 bg-zinc-950 flex items-center px-6 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <TerminalIcon className="w-5 h-5 text-zinc-400" />
                <h1 className="text-lg font-semibold text-zinc-100 leading-tight">Chat</h1>
              </div>
            </header>
            <main className="flex-1 flex flex-col overflow-hidden">
              <ChatPanel
                messages={mainChatMessages}
                onSendMessage={sendMainChatMessage}
                style={{ flex: 1 }}
              />
            </main>
          </>
        ) : activeProject ? (
          <>
            <TopBar project={activeProject} activeTab={activeTab} onTabChange={setActiveTab} />

            <main ref={containerRef} className="flex-1 flex flex-col overflow-hidden relative">
              {activeTab === 'project' && (
                <>
                  <div
                    className="flex-1 min-h-0 overflow-hidden"
                    style={{ flexBasis: `${100 - chatPercent}%` }}
                  >
                    <KanbanBoard
                      tasks={activeTasks}
                      onReorderTasks={reorderTasks}
                      onAddTask={() => setShowAddTask(true)}
                      onDeleteTask={deleteTask}
                      onClickTask={setSelectedTask}
                    />
                  </div>

                  <div
                    onMouseDown={handleMouseDown}
                    className={`w-full h-0 border-t border-zinc-800 hover:border-zinc-600 cursor-row-resize relative z-10 ${
                      isDragging ? 'border-zinc-600' : ''
                    }`}
                    style={{ margin: '-2px 0', padding: '2px 0' }}
                  />

                  <ChatPanel
                    messages={chatLog}
                    onSendMessage={sendMessage}
                    style={{ flexBasis: `${chatPercent}%` }}
                  />
                </>
              )}

              {activeTab === 'live' && <LiveTab project={activeProject} />}
              {activeTab === 'code' && <CodeTab project={activeProject} />}
            </main>
          </>
        ) : null}
      </div>

      {isDragging && <div className="fixed inset-0 z-50 cursor-row-resize" />}

      <AddProjectModal
        open={showAddProject}
        onClose={() => setShowAddProject(false)}
        onCreated={fetchProjects}
      />

      {activeProjectId && (
        <AddTaskModal
          open={showAddTask}
          projectId={activeProjectId}
          onClose={() => setShowAddTask(false)}
          onCreated={refreshTasks}
        />
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={updateTask}
        />
      )}
    </div>
  );
}
