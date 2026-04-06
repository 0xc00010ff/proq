import { v7 as uuidv7 } from "uuid";
import {
  existsSync as fsExists,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  rmSync,
  readdirSync,
} from "fs";
import path from "path";
import type {
  WorkspaceData,
  ProjectStub,
  Project,
  ProjectSettings,
  ProjectWorkspace,
  Task,
  TaskStatus,
  TaskColumns,
  TaskColumnIds,
  TaskReport,
  ChatLogEntry,
  ExecutionMode,
  DeletedTaskEntry,
  ProqSettings,
  AgentBlock,
  CronJob,
  Agent,
} from "./types";
import { slugify } from "./utils";

const DATA_DIR = path.join(process.cwd(), "data");

// Ensure root data directory exists
mkdirSync(path.join(DATA_DIR, "projects"), { recursive: true });

// ── Write locks (attached to globalThis to survive HMR) ──
const g = globalThis as unknown as {
  __proqWriteLocks?: Map<string, Promise<void>>;
  __proqMigrationDone?: boolean;
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

function emptyTaskColumnIds(): TaskColumnIds {
  return { "todo": [], "in-progress": [], "verify": [], "done": [] };
}

function emptyTaskColumns(): TaskColumns {
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

// ── Project directory helpers ────────────────────────────

function projectDir(projectId: string): string {
  return path.join(DATA_DIR, "projects", projectId);
}

function ensureProjectDir(projectId: string): void {
  const dir = projectDir(projectId);
  mkdirSync(path.join(dir, "tasks"), { recursive: true });
  mkdirSync(path.join(dir, "reports"), { recursive: true });
  mkdirSync(path.join(dir, "logs"), { recursive: true });
  mkdirSync(path.join(dir, "attachments"), { recursive: true });
  mkdirSync(path.join(dir, "agents"), { recursive: true });
}

export function projectAttachmentsDir(projectId: string): string {
  return path.join(projectDir(projectId), "attachments");
}

// ── Root Workspace DB (project stubs) ────────────────────

function getWorkspaceData(): WorkspaceData {
  const filePath = path.join(DATA_DIR, "workspace.json");
  return readJSON<WorkspaceData>(filePath, { projects: [] });
}

function writeWorkspace(ws: WorkspaceData): void {
  const filePath = path.join(DATA_DIR, "workspace.json");
  writeJSON(filePath, ws);
}

// ── Per-project settings (shareable) ─────────────────────

function projectSettingsPath(projectId: string): string {
  return path.join(projectDir(projectId), "settings.json");
}

export function getProjectSettings(projectId: string): ProjectSettings {
  ensureProjectDir(projectId);
  return readJSON<ProjectSettings>(projectSettingsPath(projectId), {});
}

export function writeProjectSettings(projectId: string, settings: ProjectSettings): void {
  ensureProjectDir(projectId);
  writeJSON(projectSettingsPath(projectId), settings);
}

// ── Per-project workspace (local/live) ───────────────────

function projectWorkspacePath(projectId: string): string {
  return path.join(projectDir(projectId), "workspace.json");
}

export function getProjectWorkspace(projectId: string): ProjectWorkspace {
  ensureProjectDir(projectId);
  const raw = readJSON<ProjectWorkspace>(projectWorkspacePath(projectId), {
    tasks: emptyTaskColumnIds(),
    chatLog: [],
  });

  if (!raw.tasks) raw.tasks = emptyTaskColumnIds();
  if (!raw.chatLog) raw.chatLog = [];
  if (!raw.recentlyDeleted) raw.recentlyDeleted = [];

  return raw;
}

function writeProjectWorkspace(projectId: string, ws: ProjectWorkspace): void {
  writeJSON(projectWorkspacePath(projectId), ws);
}

// ── Task file I/O ────────────────────────────────────────

function taskFilePath(projectId: string, taskId: string): string {
  return path.join(projectDir(projectId), "tasks", `${taskId}.json`);
}

function readTaskFile(projectId: string, taskId: string): Task | null {
  const fp = taskFilePath(projectId, taskId);
  if (!fsExists(fp)) return null;
  return readJSON<Task | null>(fp, null);
}

function writeTaskFile(projectId: string, task: Task): void {
  ensureProjectDir(projectId);
  writeJSON(taskFilePath(projectId, task.id), task);
}

function deleteTaskFile(projectId: string, taskId: string): void {
  const fp = taskFilePath(projectId, taskId);
  try {
    if (fsExists(fp)) unlinkSync(fp);
  } catch { /* best effort */ }
}

// Helper: find which column a task is in within workspace
function findTaskColumn(ws: ProjectWorkspace, taskId: string): [TaskStatus, number] | null {
  for (const status of ["todo", "in-progress", "verify", "done"] as TaskStatus[]) {
    const col = ws.tasks[status];
    const idx = col.indexOf(taskId);
    if (idx !== -1) return [status, idx];
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════════════════════════

/** Assemble a full Project from stub + settings + workspace UI fields */
function assembleProject(stub: ProjectStub): Project {
  const settings = getProjectSettings(stub.id);
  const ws = getProjectWorkspace(stub.id);
  return {
    ...stub,
    status: ws.status,
    serverUrl: settings.serverUrl,
    activeTab: ws.activeTab,
    viewType: ws.viewType,
    liveViewport: ws.liveViewport,
    liveUrl: ws.liveUrl,
    defaultBranch: settings.defaultBranch,
    systemPrompt: settings.systemPrompt,
  };
}

export async function getAllProjects(): Promise<Project[]> {
  const ws = getWorkspaceData();
  const sorted = [...ws.projects].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return sorted.map(assembleProject);
}

export async function getProject(id: string): Promise<Project | undefined> {
  const ws = getWorkspaceData();
  const stub = ws.projects.find((p) => p.id === id);
  if (!stub) return undefined;
  return assembleProject(stub);
}

export async function getProjectDefaultBranch(projectId: string): Promise<string> {
  const settings = getProjectSettings(projectId);
  return settings.defaultBranch || "main";
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
    const id = uniqueSlug(slugify(data.name), existingIds);

    const stub: ProjectStub = {
      id,
      name: data.name,
      path: data.path,
      createdAt: new Date().toISOString(),
    };

    // Create project directory structure
    ensureProjectDir(id);

    // Write initial settings
    if (data.serverUrl) {
      writeProjectSettings(id, { serverUrl: data.serverUrl });
    }

    ws.projects.push(stub);
    writeWorkspace(ws);

    return assembleProject(stub);
  });
}

export async function updateProject(
  id: string,
  data: Partial<Pick<Project, "name" | "path" | "status" | "serverUrl" | "activeTab" | "viewType" | "defaultBranch" | "systemPrompt">>
): Promise<Project | null> {
  return withWriteLock('workspace', async () => {
    const ws = getWorkspaceData();
    const stub = ws.projects.find((p) => p.id === id);
    if (!stub) return null;

    let effectiveId = id;

    // If name is changing, update the slug-based id and rename directory
    if (data.name && data.name !== stub.name) {
      const newSlug = slugify(data.name);
      const existingIds = ws.projects.filter((p) => p.id !== id).map((p) => p.id);
      const newId = uniqueSlug(newSlug, existingIds);

      const oldDir = projectDir(id);
      const newDir = projectDir(newId);
      if (fsExists(oldDir)) {
        renameSync(oldDir, newDir);
      }

      stub.id = newId;
      effectiveId = newId;
    }

    // Update stub fields
    if (data.name) stub.name = data.name;
    if (data.path !== undefined) stub.path = data.path;

    // Update settings fields
    const settingsUpdates: Partial<ProjectSettings> = {};
    if (data.serverUrl !== undefined) settingsUpdates.serverUrl = data.serverUrl;
    if (data.defaultBranch !== undefined) settingsUpdates.defaultBranch = data.defaultBranch;
    if (data.systemPrompt !== undefined) settingsUpdates.systemPrompt = data.systemPrompt;
    if (Object.keys(settingsUpdates).length > 0) {
      const settings = getProjectSettings(effectiveId);
      Object.assign(settings, settingsUpdates);
      writeProjectSettings(effectiveId, settings);
    }

    // Update workspace UI fields
    const wsUpdates: Partial<ProjectWorkspace> = {};
    if (data.status !== undefined) wsUpdates.status = data.status;
    if (data.activeTab !== undefined) wsUpdates.activeTab = data.activeTab;
    if (data.viewType !== undefined) wsUpdates.viewType = data.viewType;
    if (Object.keys(wsUpdates).length > 0) {
      const projWs = getProjectWorkspace(effectiveId);
      Object.assign(projWs, wsUpdates);
      writeProjectWorkspace(effectiveId, projWs);
    }

    writeWorkspace(ws);
    return assembleProject(stub);
  });
}

export async function deleteProject(id: string): Promise<boolean> {
  return withWriteLock('workspace', async () => {
    const ws = getWorkspaceData();
    const idx = ws.projects.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    ws.projects.splice(idx, 1);
    writeWorkspace(ws);

    // Remove project directory
    const dir = projectDir(id);
    try {
      if (fsExists(dir)) rmSync(dir, { recursive: true, force: true });
    } catch { /* best effort */ }

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

/** Read all tasks, hydrating from individual task files. */
export async function getAllTasks(projectId: string): Promise<TaskColumns> {
  const ws = getProjectWorkspace(projectId);
  const result = emptyTaskColumns();

  for (const status of ["todo", "in-progress", "verify", "done"] as TaskStatus[]) {
    for (const taskId of ws.tasks[status]) {
      const task = readTaskFile(projectId, taskId);
      if (task) {
        task.status = status; // ensure consistency with column placement
        result[status].push(task);
      }
    }
  }

  return result;
}

export async function getTask(
  projectId: string,
  taskId: string
): Promise<Task | undefined> {
  const task = readTaskFile(projectId, taskId);
  return task ?? undefined;
}

export async function createTask(
  projectId: string,
  data: Pick<Task, "description"> & { title?: string; priority?: Task["priority"]; mode?: Task["mode"]; agentId?: string }
): Promise<Task> {
  return withWriteLock(`workspace:${projectId}`, async () => {
    const now = new Date().toISOString();
    const task: Task = {
      id: uuidv7(),
      title: data.title || "",
      description: data.description,
      status: "todo",
      priority: data.priority,
      mode: data.mode,
      agentId: data.agentId,
      createdAt: now,
      updatedAt: now,
    };

    // Write task file
    writeTaskFile(projectId, task);

    // Add to workspace column
    const ws = getProjectWorkspace(projectId);
    ws.tasks.todo.unshift(task.id);
    writeProjectWorkspace(projectId, ws);

    return task;
  });
}

export async function moveTask(
  projectId: string,
  taskId: string,
  toColumn: TaskStatus,
  toIndex: number
): Promise<Task | null> {
  return withWriteLock(`workspace:${projectId}`, async () => {
    const ws = getProjectWorkspace(projectId);
    const found = findTaskColumn(ws, taskId);
    if (!found) return null;

    const [fromColumn] = found;

    // Remove from source column
    ws.tasks[fromColumn] = ws.tasks[fromColumn].filter((id) => id !== taskId);

    // Insert at target index (clamped)
    const targetCol = ws.tasks[toColumn];
    const clampedIndex = Math.max(0, Math.min(toIndex, targetCol.length));
    targetCol.splice(clampedIndex, 0, taskId);
    writeProjectWorkspace(projectId, ws);

    // Update task file with new status
    const task = readTaskFile(projectId, taskId);
    if (!task) return null;
    task.status = toColumn;
    task.updatedAt = new Date().toISOString();
    writeTaskFile(projectId, task);

    return task;
  });
}

export async function updateTask(
  projectId: string,
  taskId: string,
  data: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "summary" | "nextSteps" | "needsAttention" | "agentLog" | "agentStatus" | "attachments" | "mode" | "worktreePath" | "branch" | "baseBranch" | "mergeConflict" | "renderMode" | "sessionId" | "startCommit" | "commitHashes" | "cronJobId" | "agentId">>
): Promise<Task | null> {
  return withWriteLock(`task:${taskId}`, async () => {
    const task = readTaskFile(projectId, taskId);
    if (!task) return null;

    const currentStatus = task.status;

    // If status is changing, update workspace columns
    if (data.status && data.status !== currentStatus) {
      await withWriteLock(`workspace:${projectId}`, async () => {
        const ws = getProjectWorkspace(projectId);
        // Remove from current column
        ws.tasks[currentStatus] = ws.tasks[currentStatus].filter((id) => id !== taskId);
        // Add to new column
        ws.tasks[data.status!].unshift(taskId);
        writeProjectWorkspace(projectId, ws);
      });
    }

    Object.assign(task, data, { updatedAt: new Date().toISOString() });
    writeTaskFile(projectId, task);
    return task;
  });
}

export async function deleteTask(
  projectId: string,
  taskId: string
): Promise<boolean> {
  return withWriteLock(`workspace:${projectId}`, async () => {
    const task = readTaskFile(projectId, taskId);
    if (!task) return false;

    const ws = getProjectWorkspace(projectId);
    const found = findTaskColumn(ws, taskId);
    if (!found) return false;

    const [column, index] = found;

    // Archive to recentlyDeleted for undo support
    if (!ws.recentlyDeleted) ws.recentlyDeleted = [];
    ws.recentlyDeleted.push({
      task: { ...task },
      column,
      index,
      deletedAt: new Date().toISOString(),
    });

    // Prune entries older than 24 hours
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    ws.recentlyDeleted = ws.recentlyDeleted.filter(
      (e) => new Date(e.deletedAt).getTime() > cutoff
    );

    // Remove from column
    ws.tasks[column] = ws.tasks[column].filter((id) => id !== taskId);
    writeProjectWorkspace(projectId, ws);

    // Remove task file
    deleteTaskFile(projectId, taskId);

    return true;
  });
}

/** Peek at the most recent deleted task (within 60s) without restoring it. */
export async function peekDeletedTask(
  projectId: string
): Promise<DeletedTaskEntry | null> {
  const ws = getProjectWorkspace(projectId);
  if (!ws.recentlyDeleted || ws.recentlyDeleted.length === 0) return null;

  const cutoff = Date.now() - 60 * 1000;
  for (let i = ws.recentlyDeleted.length - 1; i >= 0; i--) {
    if (new Date(ws.recentlyDeleted[i].deletedAt).getTime() > cutoff) {
      return ws.recentlyDeleted[i];
    }
  }
  return null;
}

/** Actually restore the most recent deleted task (within 60s) back into its column. */
export async function restoreDeletedTask(
  projectId: string
): Promise<DeletedTaskEntry | null> {
  return withWriteLock(`workspace:${projectId}`, async () => {
    const ws = getProjectWorkspace(projectId);
    if (!ws.recentlyDeleted || ws.recentlyDeleted.length === 0) return null;

    const cutoff = Date.now() - 60 * 1000;
    const recentIdx = ws.recentlyDeleted.findLastIndex(
      (e) => new Date(e.deletedAt).getTime() > cutoff
    );
    if (recentIdx === -1) return null;

    const entry = ws.recentlyDeleted.splice(recentIdx, 1)[0];

    // Restore task file
    writeTaskFile(projectId, entry.task);

    // Restore into workspace column
    const col = ws.tasks[entry.column];
    const insertIdx = Math.min(entry.index, col.length);
    col.splice(insertIdx, 0, entry.task.id);

    writeProjectWorkspace(projectId, ws);
    return entry;
  });
}

// ═══════════════════════════════════════════════════════════
// EXECUTION MODE (from project settings)
// ═══════════════════════════════════════════════════════════

export async function getExecutionMode(projectId: string): Promise<ExecutionMode> {
  const settings = getProjectSettings(projectId);
  return settings.executionMode ?? 'sequential';
}

export async function setExecutionMode(projectId: string, mode: ExecutionMode): Promise<void> {
  return withWriteLock(`settings:${projectId}`, async () => {
    const settings = getProjectSettings(projectId);
    settings.executionMode = mode;
    writeProjectSettings(projectId, settings);
  });
}

// ═══════════════════════════════════════════════════════════
// WORKBENCH STATE (from project workspace)
// ═══════════════════════════════════════════════════════════

export async function getWorkbenchState(projectId: string): Promise<{ open: boolean; height: number | null }> {
  const ws = getProjectWorkspace(projectId);
  return { open: ws.projectWorkbenchOpen ?? false, height: ws.projectWorkbenchHeight ?? null };
}

export async function setWorkbenchState(projectId: string, state: { open?: boolean; height?: number }): Promise<void> {
  return withWriteLock(`workspace:${projectId}`, async () => {
    const ws = getProjectWorkspace(projectId);
    if (state.open !== undefined) ws.projectWorkbenchOpen = state.open;
    if (state.height !== undefined) ws.projectWorkbenchHeight = state.height;
    writeProjectWorkspace(projectId, ws);
  });
}

export async function getWorkbenchTabs(projectId: string): Promise<{ tabs: import("./types").WorkbenchTabInfo[]; activeTabId?: string }> {
  const ws = getProjectWorkspace(projectId);
  return { tabs: ws.projectWorkbenchTabs ?? [], activeTabId: ws.projectWorkbenchActiveTabId };
}

export async function setWorkbenchTabs(projectId: string, tabs: import("./types").WorkbenchTabInfo[], activeTabId?: string): Promise<void> {
  return withWriteLock(`workspace:${projectId}`, async () => {
    const ws = getProjectWorkspace(projectId);
    ws.projectWorkbenchTabs = tabs;
    ws.projectWorkbenchActiveTabId = activeTabId;
    writeProjectWorkspace(projectId, ws);
  });
}

// ═══════════════════════════════════════════════════════════
// WORKBENCH SESSIONS
// ═══════════════════════════════════════════════════════════

export async function getWorkbenchSession(projectId: string, tabId: string): Promise<import("./types").WorkbenchSessionData | null> {
  const ws = getProjectWorkspace(projectId);
  return ws.projectWorkbenchSessions?.[tabId] ?? null;
}

export async function setWorkbenchSession(projectId: string, tabId: string, sessionData: import("./types").WorkbenchSessionData): Promise<void> {
  return withWriteLock(`workspace:${projectId}`, async () => {
    const ws = getProjectWorkspace(projectId);
    if (!ws.projectWorkbenchSessions) ws.projectWorkbenchSessions = {};
    ws.projectWorkbenchSessions[tabId] = sessionData;
    writeProjectWorkspace(projectId, ws);
  });
}

// ═══════════════════════════════════════════════════════════
// TASK LOGS (renamed from agent-blocks, per-project)
// ═══════════════════════════════════════════════════════════

function taskLogsPath(projectId: string, taskId: string): string {
  return path.join(projectDir(projectId), "logs", `${taskId}.json`);
}

export async function getTaskLogs(projectId: string, taskId: string): Promise<AgentBlock[]> {
  return readTaskLogsFile(projectId, taskId).blocks;
}

export async function setTaskLogs(projectId: string, taskId: string, blocks: AgentBlock[], sessionId?: string): Promise<void> {
  return withWriteLock(`logs:${taskId}`, async () => {
    ensureProjectDir(projectId);
    const filePath = taskLogsPath(projectId, taskId);
    writeJSON(filePath, { blocks, sessionId });
  });
}

export async function deleteTaskLogs(projectId: string, taskId: string): Promise<void> {
  const filePath = taskLogsPath(projectId, taskId);
  try {
    if (fsExists(filePath)) unlinkSync(filePath);
  } catch {
    // best effort
  }
}

export function readTaskLogsFile(projectId: string, taskId: string): { blocks: AgentBlock[]; sessionId?: string } {
  const filePath = taskLogsPath(projectId, taskId);
  const data = readJSON<{ blocks?: AgentBlock[]; sessionId?: string }>(filePath, {});
  // Handle legacy format (plain array) vs new format ({ blocks, sessionId })
  if (Array.isArray(data)) return { blocks: data };
  return { blocks: data.blocks || [], sessionId: data.sessionId };
}

// Backward-compat aliases (old names → new names)
export const getTaskAgentBlocks = getTaskLogs;
export const setTaskAgentBlocks = setTaskLogs;
export const deleteTaskAgentBlocks = deleteTaskLogs;
export const readAgentBlocksFile = readTaskLogsFile;

// ═══════════════════════════════════════════════════════════
// TASK REPORTS
// ═══════════════════════════════════════════════════════════

function taskReportPath(projectId: string, taskId: string): string {
  return path.join(projectDir(projectId), "reports", `${taskId}.json`);
}

export async function getTaskReport(projectId: string, taskId: string): Promise<TaskReport | null> {
  const filePath = taskReportPath(projectId, taskId);
  if (!fsExists(filePath)) return null;
  return readJSON<TaskReport | null>(filePath, null);
}

export async function writeTaskReport(projectId: string, taskId: string, report: TaskReport): Promise<void> {
  return withWriteLock(`report:${taskId}`, async () => {
    ensureProjectDir(projectId);
    writeJSON(taskReportPath(projectId, taskId), report);
  });
}

export async function deleteTaskReport(projectId: string, taskId: string): Promise<void> {
  const filePath = taskReportPath(projectId, taskId);
  try {
    if (fsExists(filePath)) unlinkSync(filePath);
  } catch { /* best effort */ }
}

// ═══════════════════════════════════════════════════════════
// CHAT LOG (from project workspace)
// ═══════════════════════════════════════════════════════════

export async function getChatLog(projectId: string): Promise<ChatLogEntry[]> {
  const ws = getProjectWorkspace(projectId);
  return ws.chatLog;
}

export async function addChatMessage(
  projectId: string,
  data: Pick<ChatLogEntry, "role" | "message" | "toolCalls" | "attachments">
): Promise<ChatLogEntry> {
  return withWriteLock(`workspace:${projectId}`, async () => {
    const ws = getProjectWorkspace(projectId);
    const entry: ChatLogEntry = {
      role: data.role,
      message: data.message,
      timestamp: new Date().toISOString(),
      toolCalls: data.toolCalls,
      attachments: data.attachments,
    };
    ws.chatLog.push(entry);
    writeProjectWorkspace(projectId, ws);
    return entry;
  });
}

// ═══════════════════════════════════════════════════════════
// SUPERVISOR CHAT (unchanged — not project-scoped)
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
// CRON JOBS (from project settings)
// ═══════════════════════════════════════════════════════════

export async function getCronJobs(projectId: string): Promise<CronJob[]> {
  const settings = getProjectSettings(projectId);
  return settings.cronJobs ?? [];
}

export async function createCronJob(
  projectId: string,
  data: Pick<CronJob, "name" | "prompt" | "schedule"> & { mode?: CronJob["mode"]; enabled?: boolean; agentId?: string }
): Promise<CronJob> {
  return withWriteLock(`settings:${projectId}`, async () => {
    const settings = getProjectSettings(projectId);
    if (!settings.cronJobs) settings.cronJobs = [];
    const job: CronJob = {
      id: uuidv7(),
      name: data.name,
      prompt: data.prompt,
      schedule: data.schedule,
      mode: data.mode,
      agentId: data.agentId,
      enabled: data.enabled ?? true,
      runCount: 0,
      createdAt: new Date().toISOString(),
    };
    settings.cronJobs.push(job);
    writeProjectSettings(projectId, settings);
    return job;
  });
}

export async function updateCronJob(
  projectId: string,
  cronId: string,
  data: Partial<Pick<CronJob, "name" | "prompt" | "schedule" | "mode" | "enabled" | "lastRunAt" | "lastTaskId" | "nextRunAt" | "runCount" | "agentId">>
): Promise<CronJob | null> {
  return withWriteLock(`settings:${projectId}`, async () => {
    const settings = getProjectSettings(projectId);
    if (!settings.cronJobs) return null;
    const job = settings.cronJobs.find((j) => j.id === cronId);
    if (!job) return null;
    Object.assign(job, data);
    writeProjectSettings(projectId, settings);
    return job;
  });
}

export async function deleteCronJob(
  projectId: string,
  cronId: string
): Promise<boolean> {
  return withWriteLock(`settings:${projectId}`, async () => {
    const settings = getProjectSettings(projectId);
    if (!settings.cronJobs) return false;
    const idx = settings.cronJobs.findIndex((j) => j.id === cronId);
    if (idx === -1) return false;
    settings.cronJobs.splice(idx, 1);
    writeProjectSettings(projectId, settings);
    return true;
  });
}

// ═══════════════════════════════════════════════════════════
// AGENTS (per-file storage in agents/)
// ═══════════════════════════════════════════════════════════

function agentFilePath(projectId: string, agentId: string): string {
  return path.join(projectDir(projectId), "agents", `${agentId}.json`);
}

function readAgentFile(projectId: string, agentId: string): Agent | null {
  const fp = agentFilePath(projectId, agentId);
  if (!fsExists(fp)) return null;
  return readJSON<Agent | null>(fp, null);
}

function writeAgentFile(projectId: string, agent: Agent): void {
  ensureProjectDir(projectId);
  writeJSON(agentFilePath(projectId, agent.id), agent);
}

export async function getAllAgents(projectId: string): Promise<Agent[]> {
  ensureProjectDir(projectId);
  const dir = path.join(projectDir(projectId), "agents");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const agents: Agent[] = [];
  for (const f of files) {
    const id = f.replace(/\.json$/, "");
    const agent = readAgentFile(projectId, id);
    if (agent) agents.push(agent);
  }
  agents.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return agents;
}

export async function getAgent(
  projectId: string,
  agentId: string
): Promise<Agent | null> {
  return readAgentFile(projectId, agentId);
}

/** Get or auto-create the Default agent for a project. */
export async function getOrCreateDefaultAgent(projectId: string): Promise<Agent> {
  const agents = await getAllAgents(projectId);
  if (agents.length > 0) return agents[0];

  // Seed from project's current systemPrompt
  const settings = getProjectSettings(projectId);
  const now = new Date().toISOString();
  const agent: Agent = {
    id: uuidv7(),
    name: "Default",
    role: "General-purpose agent",
    systemPrompt: settings.systemPrompt || "",
    avatar: { color: "#3b82f6" }, // blue-500
    position: { x: 250, y: 200 },
    createdAt: now,
    updatedAt: now,
  };
  writeAgentFile(projectId, agent);
  return agent;
}

export async function createAgent(
  projectId: string,
  data: Pick<Agent, "name"> & Partial<Pick<Agent, "role" | "systemPrompt" | "model" | "avatar" | "position">>
): Promise<Agent> {
  const now = new Date().toISOString();
  const agent: Agent = {
    id: uuidv7(),
    name: data.name,
    role: data.role,
    systemPrompt: data.systemPrompt,
    model: data.model,
    avatar: data.avatar ?? { color: "#8b5cf6" }, // violet-500 default
    position: data.position,
    createdAt: now,
    updatedAt: now,
  };
  writeAgentFile(projectId, agent);
  return agent;
}

export async function updateAgent(
  projectId: string,
  agentId: string,
  data: Partial<Pick<Agent, "name" | "role" | "systemPrompt" | "model" | "avatar" | "position">>
): Promise<Agent | null> {
  return withWriteLock(`agent:${agentId}`, async () => {
    const agent = readAgentFile(projectId, agentId);
    if (!agent) return null;
    Object.assign(agent, data, { updatedAt: new Date().toISOString() });
    writeAgentFile(projectId, agent);
    return agent;
  });
}

export async function deleteAgent(
  projectId: string,
  agentId: string
): Promise<boolean> {
  const fp = agentFilePath(projectId, agentId);
  try {
    if (fsExists(fp)) {
      unlinkSync(fp);
      return true;
    }
  } catch { /* best effort */ }
  return false;
}

// ═══════════════════════════════════════════════════════════
// GLOBAL SETTINGS (unchanged)
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
  allowAgentInterrupts: false,

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

// ═══════════════════════════════════════════════════════════
// MIGRATION: Old flat-file format → per-project directories
// ═══════════════════════════════════════════════════════════

function migrateToProjectDirs(): void {
  if (g.__proqMigrationDone) return;
  g.__proqMigrationDone = true;

  const projectsDir = path.join(DATA_DIR, "projects");

  // Detect old format: look for .json files directly in projects/
  let jsonFiles: string[];
  try {
    jsonFiles = readdirSync(projectsDir).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  if (jsonFiles.length === 0) return;

  console.log(`[db] Migrating ${jsonFiles.length} project(s) to per-project directories...`);

  // Build taskId → projectId map for agent-blocks migration
  const taskToProject = new Map<string, string>();

  // Build attachmentId → projectId map for attachment migration
  const attachmentToProject = new Map<string, string>();

  for (const file of jsonFiles) {
    const projectId = file.replace(/\.json$/, "");
    const oldPath = path.join(projectsDir, file);

    // Read old project state
    const oldState = readJSON<{
      tasks?: Record<string, Array<Record<string, unknown>>>;
      chatLog?: ChatLogEntry[];
      executionMode?: ExecutionMode;
      recentlyDeleted?: DeletedTaskEntry[];
      cronJobs?: CronJob[];
      projectWorkbenchOpen?: boolean;
      projectWorkbenchHeight?: number;
      projectWorkbenchTabs?: import("./types").WorkbenchTabInfo[];
      projectWorkbenchActiveTabId?: string;
      liveWorkbenchTabs?: import("./types").WorkbenchTabInfo[];
      liveWorkbenchActiveTabId?: string;
      projectWorkbenchSessions?: Record<string, import("./types").WorkbenchSessionData>;
    }>(oldPath, { tasks: {}, chatLog: [] });

    // Create project directory structure
    ensureProjectDir(projectId);

    // Build settings.json from old state + workspace.json project entry
    // During migration, root workspace still has old full Project shape
    const rootWs = readJSON<{ projects: Record<string, unknown>[] }>(path.join(DATA_DIR, "workspace.json"), { projects: [] });
    const projectEntry = rootWs.projects.find((p) => p.id === projectId);

    const settings: ProjectSettings = {
      version: 1,
      executionMode: oldState.executionMode,
      cronJobs: oldState.cronJobs,
    };
    if (projectEntry) {
      if (projectEntry.systemPrompt) settings.systemPrompt = projectEntry.systemPrompt as string;
      if (projectEntry.defaultBranch) settings.defaultBranch = projectEntry.defaultBranch as string;
      if (projectEntry.serverUrl) settings.serverUrl = projectEntry.serverUrl as string;
    }
    writeJSON(path.join(projectDir(projectId), "settings.json"), settings);

    // Build workspace.json
    const taskColumnIds = emptyTaskColumnIds();
    const tasks = (oldState.tasks || {}) as Record<string, Array<Record<string, unknown>>>;

    for (const status of ["todo", "in-progress", "verify", "done"] as TaskStatus[]) {
      const taskList = tasks[status] || [];
      for (const task of taskList) {
        const taskId = task.id as string;
        if (!taskId) continue;

        taskColumnIds[status].push(taskId);
        taskToProject.set(taskId, projectId);

        // Write individual task file
        writeJSON(taskFilePath(projectId, taskId), task);

        // Create report from existing summary/nextSteps
        const summary = task.summary as string | undefined;
        if (summary) {
          const report: TaskReport = {
            taskId,
            title: (task.title as string) || "Untitled",
            summary,
            nextSteps: task.nextSteps as string | undefined,
            commitHashes: task.commitHashes as string[] | undefined,
            timestamp: (task.updatedAt as string) || new Date().toISOString(),
            updatedAt: (task.updatedAt as string) || new Date().toISOString(),
          };
          writeJSON(taskReportPath(projectId, taskId), report);
        }

        // Track attachment ownership
        const attachments = task.attachments as Array<{ id?: string; filePath?: string }> | undefined;
        if (attachments) {
          for (const att of attachments) {
            if (att.id) attachmentToProject.set(att.id, projectId);
          }
        }
      }
    }

    // Also check recentlyDeleted for task→project mapping
    if (oldState.recentlyDeleted) {
      for (const entry of oldState.recentlyDeleted) {
        if (entry.task?.id) {
          taskToProject.set(entry.task.id as string, projectId);
        }
      }
    }

    const workspace: ProjectWorkspace = {
      tasks: taskColumnIds,
      chatLog: oldState.chatLog || [],
      recentlyDeleted: oldState.recentlyDeleted,
      projectWorkbenchOpen: oldState.projectWorkbenchOpen,
      projectWorkbenchHeight: oldState.projectWorkbenchHeight,
      projectWorkbenchTabs: oldState.projectWorkbenchTabs,
      projectWorkbenchActiveTabId: oldState.projectWorkbenchActiveTabId,
      liveWorkbenchTabs: oldState.liveWorkbenchTabs,
      liveWorkbenchActiveTabId: oldState.liveWorkbenchActiveTabId,
      projectWorkbenchSessions: oldState.projectWorkbenchSessions,
    };
    // Also migrate UI state from the root workspace project entry
    if (projectEntry) {
      if (projectEntry.status) workspace.status = projectEntry.status as ProjectWorkspace["status"];
      if (projectEntry.activeTab) workspace.activeTab = projectEntry.activeTab as ProjectWorkspace["activeTab"];
      if (projectEntry.viewType) workspace.viewType = projectEntry.viewType as ProjectWorkspace["viewType"];
      if (projectEntry.liveViewport) workspace.liveViewport = projectEntry.liveViewport as ProjectWorkspace["liveViewport"];
      if (projectEntry.liveUrl) workspace.liveUrl = projectEntry.liveUrl as string;
    }
    writeJSON(path.join(projectDir(projectId), "workspace.json"), workspace);

    // Remove old project file
    try { unlinkSync(oldPath); } catch { /* best effort */ }
  }

  // Migrate agent-blocks → logs
  const oldBlocksDir = path.join(DATA_DIR, "agent-blocks");
  if (fsExists(oldBlocksDir)) {
    try {
      const blockFiles = readdirSync(oldBlocksDir).filter((f) => f.endsWith(".json"));
      for (const file of blockFiles) {
        const taskId = file.replace(/\.json$/, "");
        const pid = taskToProject.get(taskId);
        if (pid) {
          const src = path.join(oldBlocksDir, file);
          const dst = taskLogsPath(pid, taskId);
          try { renameSync(src, dst); } catch { /* best effort */ }
        }
      }
      // Clean up empty directory
      try { rmSync(oldBlocksDir, { recursive: true, force: true }); } catch { /* best effort */ }
    } catch { /* best effort */ }
  }

  // Note: legacy data/attachments/ migration is handled by migrateLegacyAttachments()
  // which runs independently after this function.

  // Slim root workspace.json — strip extra fields from project entries
  const rootWsRaw = readJSON<{ projects: Record<string, unknown>[] }>(path.join(DATA_DIR, "workspace.json"), { projects: [] });
  let wsChanged = false;
  for (const proj of rootWsRaw.projects) {
    for (const key of ["status", "serverUrl", "pathValid", "activeTab", "viewType", "liveViewport", "liveUrl", "defaultBranch", "systemPrompt"]) {
      if (key in proj) {
        delete proj[key];
        wsChanged = true;
      }
    }
  }
  if (wsChanged) writeJSON(path.join(DATA_DIR, "workspace.json"), rootWsRaw);

  console.log("[db] Migration complete.");
}

/**
 * Move any remaining data/attachments/ contents into data/supervisor/attachments/.
 * Runs independently of the main migration — handles cases where the project
 * migration already ran but the legacy attachments dir still exists.
 */
function migrateLegacyAttachments(): void {
  const oldAttDir = path.join(DATA_DIR, "attachments");
  if (!fsExists(oldAttDir)) return;

  let entries: string[];
  try {
    entries = readdirSync(oldAttDir);
  } catch { return; }
  if (entries.length === 0) {
    try { rmSync(oldAttDir, { recursive: true, force: true }); } catch { /* best effort */ }
    return;
  }

  // Build attachmentId → projectId map from all existing project task files
  const attachmentToProject = new Map<string, string>();
  const projectsDir = path.join(DATA_DIR, "projects");
  try {
    for (const projId of readdirSync(projectsDir)) {
      const tasksDir = path.join(projectsDir, projId, "tasks");
      if (!fsExists(tasksDir)) continue;
      try {
        for (const taskFile of readdirSync(tasksDir).filter((f) => f.endsWith(".json"))) {
          const taskData = readJSON<Record<string, unknown>>(path.join(tasksDir, taskFile), {});
          const atts = taskData.attachments as Array<{ id?: string }> | undefined;
          if (atts) {
            for (const att of atts) {
              if (att.id) attachmentToProject.set(att.id, projId);
            }
          }
        }
      } catch { /* best effort */ }
    }
  } catch { /* best effort */ }

  console.log(`[db] Migrating ${entries.length} legacy attachment(s)...`);

  for (const attId of entries) {
    const src = path.join(oldAttDir, attId);
    const pid = attachmentToProject.get(attId);

    if (pid) {
      // Move to project attachments dir
      const dst = path.join(projectAttachmentsDir(pid), attId);
      try {
        mkdirSync(path.dirname(dst), { recursive: true });
        renameSync(src, dst);
      } catch { /* best effort */ }
    } else {
      // Supervisor / orphaned — move to data/supervisor/attachments/
      const supAttDir = path.join(DATA_DIR, "supervisor", "attachments");
      mkdirSync(supAttDir, { recursive: true });
      const dst = path.join(supAttDir, attId);
      try { renameSync(src, dst); } catch { /* best effort */ }
    }
  }

  // Clean up empty legacy directory
  try {
    const remaining = readdirSync(oldAttDir);
    if (remaining.length === 0) rmSync(oldAttDir, { recursive: true, force: true });
  } catch { /* best effort */ }
}

// Run migrations on module load
migrateToProjectDirs();
migrateLegacyAttachments();
