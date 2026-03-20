import { v4 as uuidv4 } from "uuid";
import { existsSync as fsExists, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "fs";
import path from "path";
import type {
  WorkspaceData,
  Project,
  ProjectState,
  Task,
  TaskStatus,
  TaskColumns,
  ChatLogEntry,
  ExecutionMode,
  DeletedTaskEntry,
  ProqSettings,
  AgentBlock,
  CronJob,
} from "./types";
import { slugify } from "./utils";

const DATA_DIR = path.join(process.cwd(), "data");

// Ensure data directories exist on first access (idempotent)
mkdirSync(path.join(DATA_DIR, "projects"), { recursive: true });
mkdirSync(path.join(DATA_DIR, "agent-blocks"), { recursive: true });

// ── Write locks (attached to globalThis to survive HMR) ──
const g = globalThis as unknown as {
  __proqWriteLocks?: Map<string, Promise<void>>;
};
if (!g.__proqWriteLocks) g.__proqWriteLocks = new Map();

const writeLocks = g.__proqWriteLocks;

async function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>((r) => { resolve = r; });
  writeLocks.set(key, next);
  await prev;
  try {
    return await fn();
  } finally {
    resolve!();
  }
}

function emptyTasks(): TaskColumns {
  return { "todo": [], "in-progress": [], "verify": [], "done": [] };
}

// ── File I/O helpers ──
function readJSON<T>(filePath: string, defaultData: T): T {
  try {
    if (fsExists(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      return JSON.parse(raw);
    }
  } catch (err) {
    // Non-empty file that failed to parse — log a warning so data loss is visible
    try {
      const content = readFileSync(filePath, "utf-8");
      if (content.trim().length > 0) {
        console.error(`[db] Failed to parse ${filePath}, falling back to defaults:`, err);
      }
    } catch {
      // Can't read the file at all
    }
  }
  return defaultData;
}

function writeJSON(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ── Workspace DB (projects list) ─────────────────────────
function getWorkspaceData(): WorkspaceData {
  const filePath = path.join(DATA_DIR, "workspace.json");
  return readJSON<WorkspaceData>(filePath, { projects: [] });
}

function writeWorkspace(ws: WorkspaceData): void {
  const filePath = path.join(DATA_DIR, "workspace.json");
  writeJSON(filePath, ws);
}

// ── Project DB (per-project tasks + chat) ────────────────
function getProjectData(projectId: string): ProjectState {
  const filePath = path.join(DATA_DIR, "projects", `${projectId}.json`);
  const raw = readJSON<ProjectState>(filePath, {
    tasks: emptyTasks(),
    chatLog: [],
  });

  // ── Migrations ──
  // Add future migrations here. Each should be idempotent and write back if changed.

  // Ensure tasks exist even if file was empty
  if (!raw.tasks) raw.tasks = emptyTasks();
  if (!raw.chatLog) raw.chatLog = [];
  if (!raw.recentlyDeleted) raw.recentlyDeleted = [];

  return raw as ProjectState;
}

function writeProject(projectId: string, data: ProjectState): void {
  const filePath = path.join(DATA_DIR, "projects", `${projectId}.json`);
  writeJSON(filePath, data);
}

// Helper: find a task across all status lists, returns [task, status, index]
function findTask(data: ProjectState, taskId: string): [Task, TaskStatus, number] | null {
  for (const status of ["todo", "in-progress", "verify", "done"] as TaskStatus[]) {
    const col = data.tasks[status];
    const idx = col.findIndex((t) => t.id === taskId);
    if (idx !== -1) return [col[idx], status, idx];
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════════════════════════

export async function getAllProjects(): Promise<Project[]> {
  const ws = getWorkspaceData();
  return [...ws.projects].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function getProject(id: string): Promise<Project | undefined> {
  const ws = getWorkspaceData();
  return ws.projects.find((p) => p.id === id);
}

export async function getProjectDefaultBranch(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  return project?.defaultBranch || "main";
}

function uniqueSlug(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export async function createProject(
  data: Pick<Project, "name" | "path" | "serverUrl">
): Promise<Project> {
  return withWriteLock('workspace', async () => {
    const ws = getWorkspaceData();
    const existingIds = ws.projects.map((p) => p.id);
    const project: Project = {
      id: uniqueSlug(slugify(data.name), existingIds),
      name: data.name,
      path: data.path,
      serverUrl: data.serverUrl,
      createdAt: new Date().toISOString(),
    };
    ws.projects.push(project);
    writeWorkspace(ws);
    return project;
  });
}

export async function updateProject(
  id: string,
  data: Partial<Pick<Project, "name" | "path" | "status" | "serverUrl" | "activeTab" | "viewType" | "defaultBranch" | "systemPrompt">>
): Promise<Project | null> {
  return withWriteLock('workspace', async () => {
    const ws = getWorkspaceData();
    const project = ws.projects.find((p) => p.id === id);
    if (!project) return null;

    // If name is changing, update the slug-based id
    if (data.name && data.name !== project.name) {
      const newSlug = slugify(data.name);
      const existingIds = ws.projects.filter((p) => p.id !== id).map((p) => p.id);
      const newId = uniqueSlug(newSlug, existingIds);

      // Rename state file
      const oldFile = path.join(DATA_DIR, "projects", `${id}.json`);
      const newFile = path.join(DATA_DIR, "projects", `${newId}.json`);
      if (fsExists(oldFile)) {
        renameSync(oldFile, newFile);
      }

      project.id = newId;
    }

    Object.assign(project, data);
    writeWorkspace(ws);
    return project;
  });
}

export async function deleteProject(id: string): Promise<boolean> {
  return withWriteLock('workspace', async () => {
    const ws = getWorkspaceData();
    const idx = ws.projects.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    ws.projects.splice(idx, 1);
    writeWorkspace(ws);
    return true;
  });
}

export async function reorderProjects(
  orderedIds: string[]
): Promise<boolean> {
  return withWriteLock('workspace', async () => {
    const ws = getWorkspaceData();
    for (let i = 0; i < orderedIds.length; i++) {
      const project = ws.projects.find((p) => p.id === orderedIds[i]);
      if (project) project.order = i;
    }
    writeWorkspace(ws);
    return true;
  });
}

// ═══════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════

export async function getAllTasks(projectId: string): Promise<TaskColumns> {
  const data = getProjectData(projectId);
  return data.tasks;
}

export async function getTask(
  projectId: string,
  taskId: string
): Promise<Task | undefined> {
  const data = getProjectData(projectId);
  const found = findTask(data, taskId);
  return found ? found[0] : undefined;
}

export async function createTask(
  projectId: string,
  data: Pick<Task, "description"> & { title?: string; priority?: Task["priority"]; mode?: Task["mode"] }
): Promise<Task> {
  return withWriteLock(`project:${projectId}`, async () => {
    const state = getProjectData(projectId);
    const now = new Date().toISOString();
    const task: Task = {
      id: uuidv4(),
      title: data.title || "",
      description: data.description,
      status: "todo",
      priority: data.priority,
      mode: data.mode,
      createdAt: now,
      updatedAt: now,
    };
    state.tasks.todo.unshift(task);
    writeProject(projectId, state);
    return task;
  });
}

export async function moveTask(
  projectId: string,
  taskId: string,
  toColumn: TaskStatus,
  toIndex: number
): Promise<Task | null> {
  return withWriteLock(`project:${projectId}`, async () => {
    const state = getProjectData(projectId);
    const found = findTask(state, taskId);
    if (!found) return null;

    const [task, fromColumn, fromIndex] = found;

    // Splice from source
    state.tasks[fromColumn].splice(fromIndex, 1);

    // Update status
    task.status = toColumn;
    task.updatedAt = new Date().toISOString();

    // Insert at target index (clamped)
    const targetCol = state.tasks[toColumn];
    const clampedIndex = Math.max(0, Math.min(toIndex, targetCol.length));
    targetCol.splice(clampedIndex, 0, task);

    writeProject(projectId, state);
    return task;
  });
}

export async function updateTask(
  projectId: string,
  taskId: string,
  data: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "summary" | "nextSteps" | "needsAttention" | "agentLog" | "agentStatus" | "attachments" | "mode" | "worktreePath" | "branch" | "baseBranch" | "mergeConflict" | "renderMode" | "sessionId" | "startCommit" | "commitHashes" | "cronJobId">>
): Promise<Task | null> {
  return withWriteLock(`project:${projectId}`, async () => {
    const state = getProjectData(projectId);
    const found = findTask(state, taskId);
    if (!found) return null;

    const [task, currentColumn, currentIndex] = found;

    // If status is changing, move between lists
    if (data.status && data.status !== currentColumn) {
      state.tasks[currentColumn].splice(currentIndex, 1);
      task.status = data.status;
      state.tasks[data.status].unshift(task);
    }

    Object.assign(task, data, { updatedAt: new Date().toISOString() });
    writeProject(projectId, state);
    return task;
  });
}

export async function deleteTask(
  projectId: string,
  taskId: string
): Promise<boolean> {
  return withWriteLock(`project:${projectId}`, async () => {
    const state = getProjectData(projectId);
    const found = findTask(state, taskId);
    if (!found) return false;

    const [task, column, index] = found;

    // Archive to recentlyDeleted for undo support
    if (!state.recentlyDeleted) state.recentlyDeleted = [];
    state.recentlyDeleted.push({
      task: { ...task },
      column,
      index,
      deletedAt: new Date().toISOString(),
    });

    // Prune entries older than 24 hours
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    state.recentlyDeleted = state.recentlyDeleted.filter(
      (e) => new Date(e.deletedAt).getTime() > cutoff
    );

    state.tasks[column].splice(index, 1);
    writeProject(projectId, state);
    return true;
  });
}

/** Peek at the most recent deleted task (within 60s) without restoring it. */
export async function peekDeletedTask(
  projectId: string
): Promise<DeletedTaskEntry | null> {
  const state = getProjectData(projectId);
  if (!state.recentlyDeleted || state.recentlyDeleted.length === 0) return null;

  const cutoff = Date.now() - 60 * 1000;
  // Walk backwards to find the most recent within window
  for (let i = state.recentlyDeleted.length - 1; i >= 0; i--) {
    if (new Date(state.recentlyDeleted[i].deletedAt).getTime() > cutoff) {
      return state.recentlyDeleted[i];
    }
  }
  return null;
}

/** Actually restore the most recent deleted task (within 60s) back into its column. */
export async function restoreDeletedTask(
  projectId: string
): Promise<DeletedTaskEntry | null> {
  return withWriteLock(`project:${projectId}`, async () => {
    const state = getProjectData(projectId);
    if (!state.recentlyDeleted || state.recentlyDeleted.length === 0) return null;

    const cutoff = Date.now() - 60 * 1000;
    const recentIdx = state.recentlyDeleted.findLastIndex(
      (e) => new Date(e.deletedAt).getTime() > cutoff
    );
    if (recentIdx === -1) return null;

    const entry = state.recentlyDeleted.splice(recentIdx, 1)[0];

    // Restore task into its original column
    const col = state.tasks[entry.column];
    const insertIdx = Math.min(entry.index, col.length);
    col.splice(insertIdx, 0, entry.task);

    writeProject(projectId, state);
    return entry;
  });
}

// ═══════════════════════════════════════════════════════════
// EXECUTION MODE
// ═══════════════════════════════════════════════════════════

export async function getExecutionMode(projectId: string): Promise<ExecutionMode> {
  const data = getProjectData(projectId);
  return data.executionMode ?? 'sequential';
}

export async function setExecutionMode(projectId: string, mode: ExecutionMode): Promise<void> {
  return withWriteLock(`project:${projectId}`, async () => {
    const data = getProjectData(projectId);
    data.executionMode = mode;
    writeProject(projectId, data);
  });
}

// ═══════════════════════════════════════════════════════════
// WORKBENCH STATE
// ═══════════════════════════════════════════════════════════

export async function getWorkbenchState(projectId: string): Promise<{ open: boolean; height: number | null }> {
  const data = getProjectData(projectId);
  return { open: data.projectWorkbenchOpen ?? false, height: data.projectWorkbenchHeight ?? null };
}

export async function setWorkbenchState(projectId: string, state: { open?: boolean; height?: number }): Promise<void> {
  return withWriteLock(`project:${projectId}`, async () => {
    const data = getProjectData(projectId);
    if (state.open !== undefined) data.projectWorkbenchOpen = state.open;
    if (state.height !== undefined) data.projectWorkbenchHeight = state.height;
    writeProject(projectId, data);
  });
}

export async function getWorkbenchTabs(projectId: string, scope?: string): Promise<{ tabs: import("./types").WorkbenchTabInfo[]; activeTabId?: string }> {
  const data = getProjectData(projectId);
  if (scope === 'live') {
    return { tabs: data.liveWorkbenchTabs ?? [], activeTabId: data.liveWorkbenchActiveTabId };
  }
  return { tabs: data.projectWorkbenchTabs ?? [], activeTabId: data.projectWorkbenchActiveTabId };
}

export async function setWorkbenchTabs(projectId: string, tabs: import("./types").WorkbenchTabInfo[], activeTabId?: string, scope?: string): Promise<void> {
  return withWriteLock(`project:${projectId}`, async () => {
    const data = getProjectData(projectId);
    if (scope === 'live') {
      data.liveWorkbenchTabs = tabs;
      data.liveWorkbenchActiveTabId = activeTabId;
    } else {
      data.projectWorkbenchTabs = tabs;
      data.projectWorkbenchActiveTabId = activeTabId;
    }
    writeProject(projectId, data);
  });
}

// ═══════════════════════════════════════════════════════════
// WORKBENCH SESSIONS
// ═══════════════════════════════════════════════════════════

export async function getWorkbenchSession(projectId: string, tabId: string): Promise<import("./types").WorkbenchSessionData | null> {
  const data = getProjectData(projectId);
  return data.projectWorkbenchSessions?.[tabId] ?? null;
}

export async function setWorkbenchSession(projectId: string, tabId: string, sessionData: import("./types").WorkbenchSessionData): Promise<void> {
  return withWriteLock(`project:${projectId}`, async () => {
    const data = getProjectData(projectId);
    if (!data.projectWorkbenchSessions) data.projectWorkbenchSessions = {};
    data.projectWorkbenchSessions[tabId] = sessionData;
    writeProject(projectId, data);
  });
}

// ═══════════════════════════════════════════════════════════
// TASK AGENT BLOCKS (separate file per task)
// ═══════════════════════════════════════════════════════════

const AGENT_BLOCKS_DIR = path.join(DATA_DIR, "agent-blocks");

function agentBlocksPath(taskId: string): string {
  return path.join(AGENT_BLOCKS_DIR, `${taskId}.json`);
}

export async function getTaskAgentBlocks(taskId: string): Promise<AgentBlock[]> {
  return readAgentBlocksFile(taskId).blocks;
}

export async function setTaskAgentBlocks(taskId: string, blocks: AgentBlock[], sessionId?: string): Promise<void> {
  return withWriteLock(`agent-blocks:${taskId}`, async () => {
    const filePath = agentBlocksPath(taskId);
    writeJSON(filePath, { blocks, sessionId });
  });
}

export async function deleteTaskAgentBlocks(taskId: string): Promise<void> {
  const filePath = agentBlocksPath(taskId);
  try {
    if (fsExists(filePath)) unlinkSync(filePath);
  } catch {
    // best effort
  }
}

export function readAgentBlocksFile(taskId: string): { blocks: AgentBlock[]; sessionId?: string } {
  const filePath = agentBlocksPath(taskId);
  const data = readJSON<{ blocks?: AgentBlock[]; sessionId?: string }>(filePath, {});
  // Handle legacy format (plain array) vs new format ({ blocks, sessionId })
  if (Array.isArray(data)) return { blocks: data };
  return { blocks: data.blocks || [], sessionId: data.sessionId };
}

// ═══════════════════════════════════════════════════════════
// CHAT LOG
// ═══════════════════════════════════════════════════════════

export async function getChatLog(projectId: string): Promise<ChatLogEntry[]> {
  const data = getProjectData(projectId);
  return data.chatLog;
}

export async function addChatMessage(
  projectId: string,
  data: Pick<ChatLogEntry, "role" | "message" | "toolCalls" | "attachments">
): Promise<ChatLogEntry> {
  return withWriteLock(`project:${projectId}`, async () => {
    const state = getProjectData(projectId);
    const entry: ChatLogEntry = {
      role: data.role,
      message: data.message,
      timestamp: new Date().toISOString(),
      toolCalls: data.toolCalls,
      attachments: data.attachments,
    };
    state.chatLog.push(entry);
    writeProject(projectId, state);
    return entry;
  });
}

// ═══════════════════════════════════════════════════════════
// SUPERVISOR CHAT
// ═══════════════════════════════════════════════════════════

interface SupervisorData {
  chatLog: ChatLogEntry[];
  agentBlocks?: AgentBlock[];
  sessionId?: string;
}

const SUPERVISOR_FILE = path.join(DATA_DIR, "supervisor.json");

function readSupervisorData(): SupervisorData {
  const data = readJSON<SupervisorData & Record<string, unknown>>(SUPERVISOR_FILE, { chatLog: [] });

  // Migrate old prettyLog → agentBlocks
  if ('prettyLog' in data && !('agentBlocks' in data)) {
    data.agentBlocks = data.prettyLog as AgentBlock[];
    delete data.prettyLog;
    writeJSON(SUPERVISOR_FILE, data);
  }

  return data as SupervisorData;
}

function writeSupervisorData(data: SupervisorData): void {
  writeJSON(SUPERVISOR_FILE, data);
}

export async function getSupervisorAgentBlocks(): Promise<{ agentBlocks?: AgentBlock[]; sessionId?: string }> {
  const data = readSupervisorData();
  return { agentBlocks: data.agentBlocks, sessionId: data.sessionId };
}

export async function setSupervisorAgentBlocks(agentBlocks: AgentBlock[], sessionId?: string): Promise<void> {
  return withWriteLock("supervisor", async () => {
    const state = readSupervisorData();
    state.agentBlocks = agentBlocks;
    if (sessionId !== undefined) state.sessionId = sessionId;
    writeSupervisorData(state);
  });
}

export async function clearSupervisorSession(): Promise<void> {
  return withWriteLock("supervisor", async () => {
    writeSupervisorData({ chatLog: [] });
  });
}

// ═══════════════════════════════════════════════════════════
// CRON JOBS
// ═══════════════════════════════════════════════════════════

export async function getCronJobs(projectId: string): Promise<CronJob[]> {
  const data = getProjectData(projectId);
  return data.cronJobs ?? [];
}

export async function createCronJob(
  projectId: string,
  data: Pick<CronJob, "name" | "prompt" | "schedule"> & { mode?: CronJob["mode"]; enabled?: boolean }
): Promise<CronJob> {
  return withWriteLock(`project:${projectId}`, async () => {
    const state = getProjectData(projectId);
    if (!state.cronJobs) state.cronJobs = [];
    const job: CronJob = {
      id: uuidv4(),
      name: data.name,
      prompt: data.prompt,
      schedule: data.schedule,
      mode: data.mode,
      enabled: data.enabled ?? true,
      runCount: 0,
      createdAt: new Date().toISOString(),
    };
    state.cronJobs.push(job);
    writeProject(projectId, state);
    return job;
  });
}

export async function updateCronJob(
  projectId: string,
  cronId: string,
  data: Partial<Pick<CronJob, "name" | "prompt" | "schedule" | "mode" | "enabled" | "lastRunAt" | "lastTaskId" | "nextRunAt" | "runCount">>
): Promise<CronJob | null> {
  return withWriteLock(`project:${projectId}`, async () => {
    const state = getProjectData(projectId);
    if (!state.cronJobs) return null;
    const job = state.cronJobs.find((j) => j.id === cronId);
    if (!job) return null;
    Object.assign(job, data);
    writeProject(projectId, state);
    return job;
  });
}

export async function deleteCronJob(
  projectId: string,
  cronId: string
): Promise<boolean> {
  return withWriteLock(`project:${projectId}`, async () => {
    const state = getProjectData(projectId);
    if (!state.cronJobs) return false;
    const idx = state.cronJobs.findIndex((j) => j.id === cronId);
    if (idx === -1) return false;
    state.cronJobs.splice(idx, 1);
    writeProject(projectId, state);
    return true;
  });
}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════

const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const DEFAULT_SETTINGS: ProqSettings = {
  // Agent
  claudeBin: "claude",
  defaultModel: "",
  systemPromptAdditions: "",
  executionMode: "sequential",
  agentRenderMode: "structured",
  showCosts: false,
  codingAgent: "claude-code",

  // Updates
  autoUpdate: true,

  // Appearance
  theme: "system",

  // Notifications
  soundNotifications: false,
  localNotifications: false,
  webhooks: [],
};

export async function getSettings(): Promise<ProqSettings> {
  const stored = readJSON<Partial<ProqSettings> & Record<string, unknown>>(SETTINGS_FILE, {});

  let dirty = false;

  // Migrate old render mode values
  if (stored.agentRenderMode === 'pretty' as string) {
    stored.agentRenderMode = 'structured';
    dirty = true;
  } else if (stored.agentRenderMode === 'terminal' as string) {
    stored.agentRenderMode = 'cli';
    dirty = true;
  }

  // Migrate webhooks from string to string[]
  if (typeof stored.webhooks === 'string') {
    const raw = stored.webhooks as string;
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      stored.webhooks = Array.isArray(parsed) ? parsed : [];
    } catch {
      stored.webhooks = [];
    }
    dirty = true;
  }

  if (dirty) writeJSON(SETTINGS_FILE, stored);

  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function updateSettings(data: Partial<ProqSettings>): Promise<ProqSettings> {
  return withWriteLock("settings", async () => {
    const current = { ...DEFAULT_SETTINGS, ...readJSON<Partial<ProqSettings>>(SETTINGS_FILE, {}) };
    Object.assign(current, data);
    writeJSON(SETTINGS_FILE, current);
    return current;
  });
}
