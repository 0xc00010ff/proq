import { v4 as uuidv4 } from "uuid";
import { renameSync, existsSync as fsExists, mkdirSync, readFileSync, writeFileSync } from "fs";
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
} from "./types";
import { slugify } from "./utils";

const DATA_DIR = path.join(process.cwd(), "data");

// ── Auto-migration from old naming ──
const oldConfigPath = path.join(DATA_DIR, "config.json");
const newWorkspacePath = path.join(DATA_DIR, "workspace.json");
if (fsExists(oldConfigPath) && !fsExists(newWorkspacePath)) {
  renameSync(oldConfigPath, newWorkspacePath);
}
const oldStateDir = path.join(DATA_DIR, "state");
const newProjectsDir = path.join(DATA_DIR, "projects");
if (fsExists(oldStateDir) && !fsExists(newProjectsDir)) {
  renameSync(oldStateDir, newProjectsDir);
}

// Ensure data directories exist on first access (idempotent)
mkdirSync(path.join(DATA_DIR, "projects"), { recursive: true });

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

function emptyColumns(): TaskColumns {
  return { "todo": [], "in-progress": [], "verify": [], "done": [] };
}

// ── File I/O helpers ──
function readJSON<T>(filePath: string, defaultData: T): T {
  try {
    if (fsExists(filePath)) {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    }
  } catch {
    // Corrupt file — use default
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

// ── Project DB (per-project columns + chat) ────────────────
function getProjectData(projectId: string): ProjectState {
  const filePath = path.join(DATA_DIR, "projects", `${projectId}.json`);
  const raw = readJSON<ProjectState & { tasks?: Task[] }>(filePath, {
    columns: emptyColumns(),
    chatLog: [],
  });

  // Auto-migration: old flat tasks[] → column-oriented
  if (raw.tasks && !raw.columns) {
    const columns = emptyColumns();
    const sorted = [...raw.tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const task of sorted) {
      const col = columns[task.status];
      if (col) {
        delete task.order;
        col.push(task);
      }
    }
    raw.columns = columns;
    delete raw.tasks;
    // Write migrated data back immediately
    writeJSON(filePath, raw);
  }

  // Ensure columns exist even if file was empty
  if (!raw.columns) raw.columns = emptyColumns();
  if (!raw.chatLog) raw.chatLog = [];
  if (!raw.recentlyDeleted) raw.recentlyDeleted = [];

  return raw as ProjectState;
}

function writeProject(projectId: string, data: ProjectState): void {
  const filePath = path.join(DATA_DIR, "projects", `${projectId}.json`);
  writeJSON(filePath, data);
}

// Helper: find a task across all columns, returns [task, columnKey, index]
function findTask(data: ProjectState, taskId: string): [Task, TaskStatus, number] | null {
  for (const status of ["todo", "in-progress", "verify", "done"] as TaskStatus[]) {
    const col = data.columns[status];
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
  data: Partial<Pick<Project, "name" | "path" | "status" | "serverUrl" | "activeTab">>
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
  return data.columns;
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
  data: Pick<Task, "description"> & { title?: string; priority?: Task["priority"] }
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
      createdAt: now,
      updatedAt: now,
    };
    state.columns.todo.unshift(task);
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
    state.columns[fromColumn].splice(fromIndex, 1);

    // Update status
    task.status = toColumn;
    task.updatedAt = new Date().toISOString();

    // Insert at target index (clamped)
    const targetCol = state.columns[toColumn];
    const clampedIndex = Math.max(0, Math.min(toIndex, targetCol.length));
    targetCol.splice(clampedIndex, 0, task);

    writeProject(projectId, state);
    return task;
  });
}

export async function updateTask(
  projectId: string,
  taskId: string,
  data: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "findings" | "humanSteps" | "agentLog" | "dispatch" | "attachments" | "mode" | "worktreePath" | "branch" | "mergeConflict">>
): Promise<Task | null> {
  return withWriteLock(`project:${projectId}`, async () => {
    const state = getProjectData(projectId);
    const found = findTask(state, taskId);
    if (!found) return null;

    const [task, currentColumn, currentIndex] = found;

    // If status is changing, move between columns
    if (data.status && data.status !== currentColumn) {
      state.columns[currentColumn].splice(currentIndex, 1);
      task.status = data.status;
      state.columns[data.status].unshift(task);
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

    state.columns[column].splice(index, 1);
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
    const col = state.columns[entry.column];
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
// TERMINAL STATE
// ═══════════════════════════════════════════════════════════

export async function getTerminalOpen(projectId: string): Promise<boolean> {
  const data = getProjectData(projectId);
  return data.terminalOpen ?? false;
}

export async function setTerminalOpen(projectId: string, open: boolean): Promise<void> {
  return withWriteLock(`project:${projectId}`, async () => {
    const data = getProjectData(projectId);
    data.terminalOpen = open;
    writeProject(projectId, data);
  });
}

export async function getTerminalTabs(projectId: string): Promise<{ tabs: import("./types").TerminalTabInfo[]; activeTabId?: string }> {
  const data = getProjectData(projectId);
  return { tabs: data.terminalTabs ?? [], activeTabId: data.terminalActiveTabId };
}

export async function setTerminalTabs(projectId: string, tabs: import("./types").TerminalTabInfo[], activeTabId?: string): Promise<void> {
  return withWriteLock(`project:${projectId}`, async () => {
    const data = getProjectData(projectId);
    data.terminalTabs = tabs;
    data.terminalActiveTabId = activeTabId;
    writeProject(projectId, data);
  });
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
  data: Pick<ChatLogEntry, "role" | "message" | "toolCalls">
): Promise<ChatLogEntry> {
  return withWriteLock(`project:${projectId}`, async () => {
    const state = getProjectData(projectId);
    const entry: ChatLogEntry = {
      role: data.role,
      message: data.message,
      timestamp: new Date().toISOString(),
      toolCalls: data.toolCalls,
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
}

const SUPERVISOR_FILE = path.join(DATA_DIR, "supervisor.json");

function readSupervisorData(): SupervisorData {
  return readJSON<SupervisorData>(SUPERVISOR_FILE, { chatLog: [] });
}

function writeSupervisorData(data: SupervisorData): void {
  writeJSON(SUPERVISOR_FILE, data);
}

export async function getSupervisorChatLog(): Promise<ChatLogEntry[]> {
  return readSupervisorData().chatLog;
}

export async function addSupervisorMessage(
  data: Pick<ChatLogEntry, "role" | "message" | "toolCalls">
): Promise<ChatLogEntry> {
  return withWriteLock("supervisor", async () => {
    const state = readSupervisorData();
    const entry: ChatLogEntry = {
      role: data.role,
      message: data.message,
      timestamp: new Date().toISOString(),
      toolCalls: data.toolCalls,
    };
    state.chatLog.push(entry);
    writeSupervisorData(state);
    return entry;
  });
}

export async function clearSupervisorChatLog(): Promise<void> {
  return withWriteLock("supervisor", async () => {
    writeSupervisorData({ chatLog: [] });
  });
}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════

const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const DEFAULT_SETTINGS: ProqSettings = {
  claudeBin: "claude",
  openclawBin: "",
  slackChannel: "",
  theme: "dark",
};

export async function getSettings(): Promise<ProqSettings> {
  return { ...DEFAULT_SETTINGS, ...readJSON<Partial<ProqSettings>>(SETTINGS_FILE, {}) };
}

export async function updateSettings(data: Partial<ProqSettings>): Promise<ProqSettings> {
  return withWriteLock("settings", async () => {
    const current = { ...DEFAULT_SETTINGS, ...readJSON<Partial<ProqSettings>>(SETTINGS_FILE, {}) };
    Object.assign(current, data);
    writeJSON(SETTINGS_FILE, current);
    return current;
  });
}
