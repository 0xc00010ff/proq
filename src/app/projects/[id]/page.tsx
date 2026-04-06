'use client';

import { useState, useEffect, useCallback, useRef, type DragEvent } from 'react';
import { useParams } from 'next/navigation';
import { TopBar, type TabOption, type GitStatus } from '@/components/TopBar';
import { KanbanBoard } from '@/components/KanbanBoard';
import { GridView } from '@/components/GridView';
import WorkbenchPanel, { type WorkbenchPanelHandle } from '@/components/WorkbenchPanel';
import { LiveTab } from '@/components/LiveTab';
import { CodeTab } from '@/components/CodeTab';
import { TaskDraft } from '@/components/TaskDraft';
import { TaskAgentModal } from '@/components/TaskAgentModal';
import { UndoModal } from '@/components/UndoModal';
import { ExecutionModeInfoModal } from '@/components/ExecutionModeInfoModal';
import { AlertModal } from '@/components/Modal';
import { ProjectSettingsModal } from '@/components/ProjectSettingsModal';
import { CronJobsModal } from '@/components/CronJobsModal';
import { AgentsView } from '@/components/AgentsView';
import { CommitModal } from '@/components/CommitModal';
import { useProjects } from '@/components/ProjectsProvider';
import { emptyTasks } from '@/components/ProjectsProvider';
import { useShellActions } from '@/components/ClientShell';
import type { Task, TaskStatus, TaskColumns, ExecutionMode, FollowUpDraft, TaskAttachment, ViewType } from '@/lib/types';
import { uploadFiles } from '@/lib/upload';
import { useTaskEvents, type TaskUpdateEvent, type TaskCreatedEvent, type ProjectUpdateEvent } from '@/hooks/useTaskEvents';

import { useRouteState } from '@/hooks/useRouteState';
import { useShortcut } from '@/hooks/useShortcut';
import { useAgents } from '@/hooks/useAgents';

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { projects, tasksByProject, refreshTasks, setTasksByProject, setProjects } = useProjects();
  const { sidebarCollapsed, expandSidebar } = useShellActions();

  const { agentMap } = useAgents(projectId);

  const [enableAgentDesigner, setEnableAgentDesigner] = useState(false);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('sequential');
  const [cleanupTimes, setCleanupTimes] = useState<Record<string, number>>({});
  const [undoEntry, setUndoEntry] = useState<{ task: Task; column: TaskStatus } | null>(null);
  const [pendingModeSwitch, setPendingModeSwitch] = useState<'parallel' | 'worktrees' | null>(null);
  const [showModeBlockedModal, setShowModeBlockedModal] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [showCronJobs, setShowCronJobs] = useState(false);
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [currentBranch, setCurrentBranch] = useState<string>('main');
  const [branches, setBranches] = useState<string[]>([]);
  const [defaultBranch, setDefaultBranch] = useState<string | undefined>(undefined);
  const [gitStatus, setGitStatus] = useState<GitStatus>({ hasGit: true, hasRemote: false, ahead: 0, behind: 0, dirty: 0 });
  const workbenchRef = useRef<WorkbenchPanelHandle>(null);

  const followUpDraftsRef = useRef<Map<string, FollowUpDraft>>(new Map());
  const [boardDragOver, setBoardDragOver] = useState(false);
  const boardDragCounter = useRef(0);
  const kanbanDraggingRef = useRef(false);
  const viewingTaskIdRef = useRef<string | null>(null);
  const dispatchingTaskRef = useRef<string | null>(null);

  const project = projects.find((p) => p.id === projectId);
  const columns: TaskColumns = tasksByProject[projectId] || emptyTasks();

  // URL-driven tab and task modal state
  const { activeTab, openTaskId, setTab, openTask: routeOpenTask, closeTask } = useRouteState(
    projectId,
    project?.activeTab || 'project',
  );

  // Clear dispatching ref once the URL has caught up (openTaskId no longer points to it)
  if (dispatchingTaskRef.current && dispatchingTaskRef.current !== openTaskId) {
    dispatchingTaskRef.current = null;
  }

  // Derive open modal task from URL param + loaded columns
  const findTask = useCallback((id: string): Task | undefined => {
    for (const col of Object.values(columns)) {
      const t = col.find((t) => t.id === id);
      if (t) return t;
    }
  }, [columns]);

  const openModalTask = openTaskId ? findTask(openTaskId) : null;
  // "todo" tasks open the edit draft; everything else opens the agent modal
  // Skip showing agent modal for tasks we just dispatched (URL hasn't caught up yet)
  const modalTask = openModalTask?.status === 'todo' ? openModalTask : null;
  const agentModalTask = openModalTask && openModalTask.status !== 'todo' && openModalTask.id !== dispatchingTaskRef.current ? openModalTask : null;

  // Keep the ref in sync with URL-driven openTaskId (ref avoids stale closures in SSE callbacks)
  useEffect(() => { viewingTaskIdRef.current = openTaskId; }, [openTaskId]);

  // Update document title with project id (slug)
  useEffect(() => {
    document.title = project ? `proq | ${project.name}` : 'proq';
  }, [project?.id]);


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
        const newBranch = data.current || 'main';
        const newBranches = data.branches || [];
        const newStatus: GitStatus = {
          hasGit: data.hasGit !== false,
          hasRemote: data.hasRemote || false,
          ahead: data.ahead || 0,
          behind: data.behind || 0,
          dirty: data.dirty || 0,
          aheadOfMain: data.aheadOfMain,
        };
        setCurrentBranch(prev => prev === newBranch ? prev : newBranch);
        setBranches(prev => JSON.stringify(prev) === JSON.stringify(newBranches) ? prev : newBranches);
        setDefaultBranch(prev => data.defaultBranch === prev ? prev : data.defaultBranch);
        setGitStatus(prev => JSON.stringify(prev) === JSON.stringify(newStatus) ? prev : newStatus);
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

  // Fetch settings flag once on mount
  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(s => {
      setEnableAgentDesigner(!!s.enableAgentDesigner);
    }).catch(() => {});
  }, []);

  // Fetch tasks, execution mode, and branch state on project load / switch
  useEffect(() => {
    if (projectId) {
      refreshTasks(projectId);
      fetchExecutionMode();
      fetchBranchState();
    }
  }, [projectId, refreshTasks, fetchExecutionMode, fetchBranchState]);

  const dismissAttention = useCallback((taskId: string) => {
    // Optimistically clear needsAttention in local state
    setTasksByProject((prev) => {
      const cols = prev[projectId] || emptyTasks();
      for (const status of ['todo', 'in-progress', 'verify', 'done'] as TaskStatus[]) {
        const idx = cols[status].findIndex((t) => t.id === taskId);
        if (idx === -1) continue;
        if (!cols[status][idx].needsAttention) return prev;
        const updated = { ...cols };
        updated[status] = [...cols[status]];
        updated[status][idx] = { ...cols[status][idx], needsAttention: false };
        return { ...prev, [projectId]: updated };
      }
      return prev;
    });
    // Fire-and-forget PATCH
    fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ needsAttention: false }),
    }).catch(() => {});
  }, [projectId, setTasksByProject]);

  // SSE delivers targeted {taskId, changes} — merge directly into local state.
  // No fetching. Only server-initiated changes (agentStatus, status) come via SSE.
  const handleTaskUpdate = useCallback((event: TaskUpdateEvent) => {
    const newStatus = event.changes.status as TaskStatus | undefined;

    // Reactively refresh git state when a task completes (verify/done = agent committed)
    if (newStatus === 'verify' || newStatus === 'done') {
      fetchBranchState();
    }

    setTasksByProject((prev) => {
      const cols = prev[projectId] || emptyTasks();
      const { taskId, changes } = event;

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
          updated[newStatus] = [merged, ...cols[newStatus]];
        } else {
          // Update in place
          updated[status] = [...cols[status]];
          updated[status][idx] = merged;
        }
        return { ...prev, [projectId]: updated };
      }
      return prev; // task not found — ignore
    });

    // Auto-dismiss needsAttention if the user is already viewing this task
    if (event.changes.needsAttention && viewingTaskIdRef.current === event.taskId) {
      dismissAttention(event.taskId);
    }
  }, [projectId, setTasksByProject, fetchBranchState, dismissAttention]);

  // Handle externally-created tasks (e.g. supervisor) — insert into todo column
  const handleTaskCreated = useCallback((event: TaskCreatedEvent) => {
    const task = event.task as unknown as Task;
    if (!task.id) return;
    setTasksByProject((prev) => {
      const cols = prev[projectId] || emptyTasks();
      // Skip if task already exists (e.g. we created it locally)
      for (const status of ['todo', 'in-progress', 'verify', 'done'] as TaskStatus[]) {
        if (cols[status].some((t) => t.id === task.id)) return prev;
      }
      return { ...prev, [projectId]: { ...cols, todo: [task, ...cols.todo] } };
    });
  }, [projectId, setTasksByProject]);

  // Handle project-level SSE updates (e.g. agent sets live URL)
  const handleProjectUpdate = useCallback((event: ProjectUpdateEvent) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, ...event.changes } : p))
    );
  }, [projectId, setProjects]);

  // On SSE reconnect, refresh tasks to catch any events missed during the gap
  const handleSSEReconnect = useCallback(() => {
    refreshTasks(projectId);
    fetchBranchState();
  }, [projectId, refreshTasks, fetchBranchState]);

  useTaskEvents(projectId, handleTaskUpdate, handleTaskCreated, handleProjectUpdate, handleSSEReconnect);

  // Refresh tasks immediately when tab becomes visible — SSE events may have
  // been lost while the browser throttled the background tab's connection.
  useEffect(() => {
    if (!projectId) return;
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refreshTasks(projectId);
        fetchBranchState();
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [projectId, refreshTasks, fetchBranchState]);

  // 30s poll as consistency backstop — SSE handles real-time updates.
  // Refreshes both tasks (skipped during drags) and project-level data (e.g. serverUrl).
  useEffect(() => {
    if (!projectId) return;
    const interval = setInterval(async () => {
      if (!kanbanDraggingRef.current) refreshTasks(projectId);
      // Also refresh project-level fields (serverUrl, etc.) that SSE may have missed
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (res.ok) {
          const data = await res.json();
          setProjects((prev) =>
            prev.map((p) => (p.id === projectId ? { ...p, ...data } : p))
          );
        }
      } catch { /* ignore */ }
    }, 30_000);
    return () => clearInterval(interval);
  }, [projectId, refreshTasks, setProjects]);

  // Poll for branch state (local dirty count, branch list, preview fast-forward)
  // Git changes are true externalities that don't pass through our API.
  useEffect(() => {
    if (!projectId) return;
    const interval = setInterval(() => {
      fetchBranchState();
      refreshDetachedHead();
    }, 5_000);
    return () => clearInterval(interval);
  }, [projectId, fetchBranchState, refreshDetachedHead]);

  // 5-min upstream fetch to keep ahead/behind counts fresh
  useEffect(() => {
    if (!projectId) return;
    const interval = setInterval(async () => {
      try {
        await fetch(`/api/projects/${projectId}/git`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'fetch' }),
        });
        fetchBranchState();
      } catch { /* best effort */ }
    }, 5 * 60_000);
    return () => clearInterval(interval);
  }, [projectId, fetchBranchState]);

  const handlePush = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/git`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'push' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Push failed');
    setGitStatus(prev => ({ ...prev, ahead: data.ahead || 0, behind: data.behind || 0 }));
  }, [projectId]);

  const handlePull = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/git`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pull' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Pull failed');
    setGitStatus(prev => ({ ...prev, ahead: data.ahead || 0, behind: data.behind || 0 }));
  }, [projectId]);

  const handleInitGit = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'init' }),
      });
      if (res.ok) {
        fetchBranchState();
      }
    } catch { /* best effort */ }
  }, [projectId, fetchBranchState]);

  // Cmd+Z to undo last delete — peeks without restoring
  useShortcut('undo-delete', useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks/undo`);
      if (res.ok) {
        const data = await res.json();
        setUndoEntry({ task: data.task, column: data.column });
      }
    } catch {
      // no-op
    }
  }, [projectId]), !undoEntry);

  const deleteTask = async (taskId: string) => {
    // Optimistically remove from UI
    setTasksByProject((prev) => {
      const cols = prev[projectId] || emptyTasks();
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
      const cols = prev[projectId] || emptyTasks();
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
        optimistic.summary = '';
        optimistic.nextSteps = '';
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
    }).then(async (res) => {
      if (!res.ok) {
        // Merge conflict or other server error — refresh to get real state
        refreshTasks(projectId);
      } else {
        const data = await res.json();
        if (data.success === false) {
          // Reorder returned failure (e.g. merge conflict) — refresh
          refreshTasks(projectId);
        }
      }
    }).catch(() => {
      refreshTasks(projectId);
    });
  };

  const updateTask = async (taskId: string, data: Partial<Task>) => {
    // Optimistic update for board
    if (data.status || data.title) {
      setTasksByProject((prev) => {
        const cols = prev[projectId] || emptyTasks();
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
          updated[toStatus] = [merged, ...updated[toStatus]];
        } else {
          // Update in place
          updated[fromStatus] = [...updated[fromStatus]];
          const idx = updated[fromStatus].findIndex((t) => t.id === taskId);
          updated[fromStatus][idx] = merged;
        }
        return { ...prev, [projectId]: updated };
      });
    }
    const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    // Reconcile local state if server disagreed (e.g. merge conflict bounced task back)
    if (res.ok) {
      const serverTask: Task = await res.json();
      if (data.status && serverTask.status !== data.status) {
        setTasksByProject((prev) => {
          const cols = prev[projectId] || emptyTasks();
          const updated: TaskColumns = { ...cols };
          // Remove from the optimistic column
          const optimisticCol = data.status as TaskStatus;
          updated[optimisticCol] = updated[optimisticCol].filter((t) => t.id !== taskId);
          // Place in the server's actual column with full server state
          const serverCol = serverTask.status as TaskStatus;
          updated[serverCol] = [...updated[serverCol].filter((t) => t.id !== taskId), serverTask];
          return { ...prev, [projectId]: updated };
        });
      }
    }
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

  const handleCreateBranch = useCallback(async (name: string) => {
    const res = await fetch(`/api/projects/${projectId}/git`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create-branch', name }),
    });
    if (res.ok) {
      const data = await res.json();
      setCurrentBranch(data.current || name);
      fetchBranchState();
    } else {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create branch');
    }
  }, [projectId, fetchBranchState]);

  const hasTasksInFlight = columns['in-progress'].length > 0 || columns['verify'].length > 0;

  const handleExecutionModeChange = async (mode: ExecutionMode) => {
    // Block mode switch if tasks are in-progress or verify
    if (hasTasksInFlight) {
      setShowModeBlockedModal(true);
      return;
    }
    // Show info modal when switching to parallel or worktrees
    if ((mode === 'parallel' || mode === 'worktrees') && executionMode !== mode) {
      setPendingModeSwitch(mode);
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

  const applyPendingMode = async () => {
    if (!pendingModeSwitch) return;
    const mode = pendingModeSwitch;
    setPendingModeSwitch(null);
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
    // Add to local state immediately so deleteTask can find it on discard.
    // Guard against duplicates — SSE task-created may arrive before the POST response.
    setTasksByProject((prev) => {
      const cols = prev[projectId] || emptyTasks();
      if (cols.todo.some((t) => t.id === newTask.id)) return prev;
      return { ...prev, [projectId]: { ...cols, todo: [newTask, ...cols.todo] } };
    });
    routeOpenTask(newTask.id);
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
    const attachments = await uploadFiles(files, projectId);

    // Patch the task with attachments
    await fetch(`/api/projects/${projectId}/tasks/${newTask.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachments }),
    });

    // Update local state with attachments then open via URL
    setTasksByProject((prev) => {
      const cols = prev[projectId] || emptyTasks();
      const updated = { ...cols };
      updated.todo = cols.todo.map((t) => t.id === newTask.id ? { ...t, attachments } : t);
      return { ...prev, [projectId]: updated };
    });
    routeOpenTask(newTask.id);
    // SSE will pick up the new task
  }, [projectId]);

  const handleTabChange = useCallback((tab: TabOption) => {
    setTab(tab);
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, activeTab: tab } : p));
    fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeTab: tab }),
    }).catch(() => {});
  }, [projectId, setProjects, setTab]);

  // Cmd+Option+Left/Right to cycle tabs, Cmd+1/2/3/4 to jump directly
  const tabOrder: TabOption[] = enableAgentDesigner
    ? ['agents', 'project', 'live', 'code']
    : ['project', 'live', 'code'];
  useShortcut('tab-prev', useCallback(() => {
    const idx = tabOrder.indexOf(activeTab);
    handleTabChange(tabOrder[(idx - 1 + tabOrder.length) % tabOrder.length]);
  }, [activeTab, handleTabChange, tabOrder]));
  useShortcut('tab-next', useCallback(() => {
    const idx = tabOrder.indexOf(activeTab);
    handleTabChange(tabOrder[(idx + 1) % tabOrder.length]);
  }, [activeTab, handleTabChange, tabOrder]));
  useShortcut('tab-1', useCallback(() => handleTabChange(tabOrder[0]), [handleTabChange, tabOrder]));
  useShortcut('tab-2', useCallback(() => handleTabChange(tabOrder[1]), [handleTabChange, tabOrder]));
  useShortcut('tab-3', useCallback(() => { if (tabOrder[2]) handleTabChange(tabOrder[2]); }, [handleTabChange, tabOrder]));
  useShortcut('tab-4', useCallback(() => { if (tabOrder[3]) handleTabChange(tabOrder[3]); }, [handleTabChange, tabOrder]));
  useShortcut('toggle-workbench', useCallback(() => {
    workbenchRef.current?.toggle();
  }, []));

  const handleViewTypeChange = useCallback((vt: ViewType) => {
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, viewType: vt } : p));
    fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ viewType: vt }),
    }).catch(() => {});
  }, [projectId, setProjects]);

  const handleProjectSettingsSave = useCallback((data: Partial<import('@/lib/types').Project>) => {
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, ...data } : p));
    fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => {});
  }, [projectId, setProjects]);

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
        projectId={projectId}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        currentBranch={currentBranch}
        branches={branches}
        defaultBranch={defaultBranch}
        taskBranchMap={taskBranchMap}
        onSwitchBranch={handleSwitchBranch}
        gitStatus={gitStatus}
        onPush={handlePush}
        onPull={handlePull}
        onInitGit={handleInitGit}
        viewType={project.viewType || 'kanban'}
        onViewTypeChange={handleViewTypeChange}
        onOpenSettings={() => setShowProjectSettings(true)}
        onOpenCronJobs={() => setShowCronJobs(true)}
        onCommit={() => setShowCommitModal(true)}
        onCreateBranch={handleCreateBranch}
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={expandSidebar}
        showAgentsTab={enableAgentDesigner}
      />

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <div className="flex-1 min-h-0 overflow-hidden relative">
          {activeTab === 'project' && (
            <div
              className="h-full overflow-hidden relative"
              onDragEnter={handleBoardDragEnter}
              onDragLeave={handleBoardDragLeave}
              onDragOver={handleBoardDragOver}
              onDrop={handleBoardDrop}
            >
              {boardDragOver && (
                <div className="absolute inset-0 z-40 bg-lazuli/10 border-2 border-dashed border-lazuli/40 rounded-lg flex items-center justify-center pointer-events-none">
                  <div className="bg-zinc-900/90 border border-lazuli/30 rounded-lg px-6 py-4 shadow-xl">
                    <p className="text-sm font-medium text-lazuli">Drop to create new task</p>
                  </div>
                </div>
              )}
              {(project.viewType || 'kanban') === 'grid' ? (
                <GridView
                  tasks={columns}
                  projectId={projectId}
                  executionMode={executionMode}
                  onExecutionModeChange={handleExecutionModeChange}
                  onAddTask={handleAddTask}
                  onClickTask={(task) => {
                    if (task.needsAttention) dismissAttention(task.id);
                    routeOpenTask(task.id);
                  }}
                  followUpDraftsRef={followUpDraftsRef}
                  onFollowUpDraftChange={(taskId, draft) => {
                    if (draft) followUpDraftsRef.current.set(taskId, draft);
                    else followUpDraftsRef.current.delete(taskId);
                  }}
                  parallelMode={executionMode === 'worktrees'}
                  currentBranch={currentBranch}
                  onSwitchBranch={handleSwitchBranch}
                  defaultBranch={project?.defaultBranch || 'main'}
                />
              ) : (
                <KanbanBoard
                  tasks={columns}
                  onMoveTask={moveTask}
                  onAddTask={handleAddTask}
                  onDeleteTask={deleteTask}
                  onClickTask={(task) => {
                    if (task.needsAttention) dismissAttention(task.id);
                    routeOpenTask(task.id);
                  }}
                  onRefreshTasks={refresh}
                  executionMode={executionMode}
                  onExecutionModeChange={handleExecutionModeChange}
                  onDragActiveChange={(active) => { kanbanDraggingRef.current = active; }}
                  activeBranch={currentBranch}
                  agentMap={agentMap}
                />
              )}
            </div>
          )}

          {activeTab === 'live' && project && (
            <LiveTab
              project={project}
              onActivateWorkbenchTab={(type) => {
                if (type === 'agent') workbenchRef.current?.addAgentTab({ reuse: true });
                else workbenchRef.current?.addShellTab({ reuse: true });
                workbenchRef.current?.expand();
              }}
            />
          )}
          {activeTab === 'code' && project && <CodeTab project={project} />}
          {activeTab === 'agents' && project && (
            <AgentsView
              projectId={projectId}
              tasks={columns}
              onSpawnChat={(agentId) => {
                workbenchRef.current?.addAgentTab({ agentId });
                workbenchRef.current?.expand();
              }}
            />
          )}
        </div>

        <WorkbenchPanel
          ref={workbenchRef}
          projectId={projectId}
          projectPath={project.path}
        />
      </main>


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
          onClose={() => closeTask()}
          onUpdateTitle={(taskId, title) => updateTask(taskId, { title })}
          onComplete={async (taskId) => {
            followUpDraftsRef.current.delete(taskId);
            const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'done' }),
            });
            if (res.ok) {
              const serverTask: Task = await res.json();
              // Update columns with server state
              setTasksByProject((prev) => {
                const cols = prev[projectId] || emptyTasks();
                const updated: TaskColumns = { ...cols };
                // Remove from all columns, place in server's actual column
                for (const s of ['todo', 'in-progress', 'verify', 'done'] as TaskStatus[]) {
                  updated[s] = cols[s].filter((t) => t.id !== taskId);
                }
                updated[serverTask.status as TaskStatus] = [serverTask, ...updated[serverTask.status as TaskStatus]];
                return { ...prev, [projectId]: updated };
              });
              // Only close if it actually moved to done (merge conflict keeps it in verify)
              if (serverTask.status === 'done') closeTask();
            }
            fetchBranchState();
          }}
          onResumeEditing={async (taskId) => {
            await updateTask(taskId, { status: 'verify' });
          }}
          parallelMode={executionMode === 'worktrees'}
          currentBranch={currentBranch}
          onSwitchBranch={handleSwitchBranch}
          defaultBranch={project?.defaultBranch || 'main'}
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
        <TaskDraft
          projectId={projectId}
          task={modalTask}
          isOpen={true}
          onClose={(isEmpty: boolean) => {
            const id = modalTask.id;
            closeTask();
            if (isEmpty) {
              deleteTask(id);
            }
          }}
          onSave={updateTask}
          onMoveToInProgress={async (taskId, currentData) => {
            // Mark as dispatching so the agent modal doesn't flash open
            // while router.push from closeTask() is still pending
            dispatchingTaskRef.current = taskId;
            closeTask();
            setTasksByProject((prev) => {
              const cols = prev[projectId] || emptyTasks();
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

      <ExecutionModeInfoModal
        isOpen={pendingModeSwitch !== null}
        mode={pendingModeSwitch || 'parallel'}
        onConfirm={applyPendingMode}
        onCancel={() => setPendingModeSwitch(null)}
      />

      {showProjectSettings && project && (
        <ProjectSettingsModal
          isOpen={showProjectSettings}
          project={project}
          branches={branches}
          onClose={() => setShowProjectSettings(false)}
          onSave={handleProjectSettingsSave}
        />
      )}

      <CronJobsModal
        isOpen={showCronJobs}
        projectId={projectId}
        onClose={() => setShowCronJobs(false)}
      />

      <CommitModal
        isOpen={showCommitModal}
        projectId={projectId}
        onClose={() => setShowCommitModal(false)}
        onCommitted={fetchBranchState}
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
