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
  cpSync,
} from "fs";
import path from "path";
import type {
  WorkspaceData,
  ProjectStub,
  Project,
  ProjectConfig,
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
  CronJobDefinition,
  ActiveCronState,
  Agent,
} from "./types";
import { slugify } from "./utils";

const DATA_DIR = path.join(process.cwd(), "data");

// Ensure root data directory exists
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
  const ws = getWorkspaceData();
  const stub = ws.projects.find(p => p.id === projectId);
  if (stub?.path) {
    const resolved = stub.path.replace(/^~/, process.env.HOME || '~');
    const proqDir = path.join(resolved, '.proq');
    if (stub.workspaceInProject || fsExists(proqDir)) {
      // Auto-detect .proq/ even if flag wasn't set on this machine
      if (!stub.workspaceInProject) {
        stub.workspaceInProject = true;
        writeWorkspace(ws);
      }
      return proqDir;
    }
  }
  return path.join(DATA_DIR, "projects", projectId);
}

function workspaceDir(projectId: string): string {
  return path.join(projectDir(projectId), "workspace");
}

/** Migrate old flat layout (tasks/, sessions/ etc at root) into workspace/ subdir. */
function migrateToWorkspaceSubdir(projectId: string): void {
  const dir = projectDir(projectId);
  const wsDir = path.join(dir, "workspace");
  // Already migrated or fresh project
  if (fsExists(wsDir)) return;
  // Check if old flat layout exists
  const oldTasks = path.join(dir, "tasks");
  if (!fsExists(oldTasks)) return;

  mkdirSync(wsDir, { recursive: true });
  const toMove = ["workspace.json", "tasks", "sessions", "reports", "attachments"];
  for (const entry of toMove) {
    const src = path.join(dir, entry);
    if (fsExists(src)) {
      renameSync(src, path.join(wsDir, entry));
    }
  }
}

function ensureProjectDir(projectId: string): void {
  const dir = projectDir(projectId);
  migrateToWorkspaceSubdir(projectId);
  mkdirSync(path.join(dir, "agents"), { recursive: true });
  const ws = workspaceDir(projectId);
  mkdirSync(path.join(ws, "tasks"), { recursive: true });
  mkdirSync(path.join(ws, "reports"), { recursive: true });
  mkdirSync(path.join(ws, "sessions"), { recursive: true });
  mkdirSync(path.join(ws, "attachments"), { recursive: true });
}

export function projectAttachmentsDir(projectId: string): string {
  return path.join(workspaceDir(projectId), "attachments");
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

// ── Per-project config (shared, git-trackable) ──────────

function projectConfigPath(projectId: string): string {
  return path.join(projectDir(projectId), "project.json");
}

export function getProjectConfig(projectId: string): ProjectConfig {
  ensureProjectDir(projectId);
  const configPath = projectConfigPath(projectId);
  // Auto-migrate from old settings.json if needed
  if (!fsExists(configPath) && fsExists(projectSettingsPath(projectId))) {
    migrateSettingsToProjectConfig(projectId);
  }
  return readJSON<ProjectConfig>(configPath, {});
}

export function writeProjectConfig(projectId: string, config: ProjectConfig): void {
  ensureProjectDir(projectId);
  writeJSON(projectConfigPath(projectId), config);
}

// ── Per-project settings (DEPRECATED — kept for migration) ──

function projectSettingsPath(projectId: string): string {
  return path.join(projectDir(projectId), "settings.json");
}

/** @deprecated Use getProjectConfig() instead. Only used for migration. */
function getProjectSettings(projectId: string): ProjectSettings {
  ensureProjectDir(projectId);
  return readJSON<ProjectSettings>(projectSettingsPath(projectId), {});
}

// ── Per-project workspace (local/live) ───────────────────

function projectWorkspacePath(projectId: string): string {
  return path.join(workspaceDir(projectId), "workspace.json");
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
  return path.join(workspaceDir(projectId), "tasks", `${taskId}.json`);
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

/** Assemble a full Project from stub + config + workspace fields */
function assembleProject(stub: ProjectStub): Project {
  const config = getProjectConfig(stub.id);
  const ws = getProjectWorkspace(stub.id);
  return {
    ...stub,
    status: ws.status,
    serverUrl: ws.serverUrl,
    activeTab: ws.activeTab,
    viewType: ws.viewType,
    liveViewport: ws.liveViewport,
    liveUrl: ws.liveUrl,
    defaultBranch: config.defaultBranch,
    systemPrompt: config.systemPrompt,
    defaultAgentId: ws.defaultAgentId,
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
  const config = getProjectConfig(projectId);
  return config.defaultBranch || "main";
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

    // Auto-detect existing .proq/ in the project directory
    const resolved = data.path?.replace(/^~/, process.env.HOME || '~');
    const hasProqDir = resolved && fsExists(path.join(resolved, '.proq'));

    const stub: ProjectStub = {
      id,
      name: data.name,
      path: data.path,
      ...(hasProqDir ? { workspaceInProject: true } : {}),
      createdAt: new Date().toISOString(),
    };

    // Write stub first so projectDir() can resolve the path
    ws.projects.push(stub);
    writeWorkspace(ws);

    // Create project directory structure
    ensureProjectDir(id);

    // Write initial workspace with serverUrl if provided
    if (data.serverUrl) {
      const projWs = getProjectWorkspace(id);
      projWs.serverUrl = data.serverUrl;
      writeProjectWorkspace(id, projWs);
    }

    return assembleProject(stub);
  });
}

export async function updateProject(
  id: string,
  data: Partial<Pick<Project, "name" | "path" | "status" | "serverUrl" | "activeTab" | "viewType" | "defaultBranch" | "systemPrompt" | "defaultAgentId">>
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

      // Only rename data dir when workspace lives in data/ (not in project .proq/)
      if (!stub.workspaceInProject) {
        const oldDir = projectDir(id);
        const newDir = path.join(DATA_DIR, "projects", newId);
        if (fsExists(oldDir)) {
          renameSync(oldDir, newDir);
        }
      }

      stub.id = newId;
      effectiveId = newId;
    }

    // Update stub fields
    if (data.name) stub.name = data.name;
    if (data.path !== undefined) stub.path = data.path;

    // Update shared project config fields
    const configUpdates: Partial<ProjectConfig> = {};
    if (data.defaultBranch !== undefined) configUpdates.defaultBranch = data.defaultBranch;
    if (data.systemPrompt !== undefined) configUpdates.systemPrompt = data.systemPrompt;
    if (Object.keys(configUpdates).length > 0) {
      const config = getProjectConfig(effectiveId);
      Object.assign(config, configUpdates);
      writeProjectConfig(effectiveId, config);
    }

    // Update workspace fields (UI state + per-user overrides)
    const wsUpdates: Partial<ProjectWorkspace> = {};
    if (data.status !== undefined) wsUpdates.status = data.status;
    if (data.activeTab !== undefined) wsUpdates.activeTab = data.activeTab;
    if (data.viewType !== undefined) wsUpdates.viewType = data.viewType;
    if (data.serverUrl !== undefined) wsUpdates.serverUrl = data.serverUrl;
    if (data.defaultAgentId !== undefined) wsUpdates.defaultAgentId = data.defaultAgentId || undefined;
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

    // Data stays on disk — just unlink from workspace

    return true;
  });
}

export async function moveWorkspaceToProject(projectId: string, gitignoreWorkspace?: boolean): Promise<void> {
  return withWriteLock('workspace', async () => {
    const ws = getWorkspaceData();
    const stub = ws.projects.find(p => p.id === projectId);
    if (!stub?.path) throw new Error("Project has no path");
    if (stub.workspaceInProject) return; // already moved

    const resolved = stub.path.replace(/^~/, process.env.HOME || '~');
    const destDir = path.join(resolved, '.proq');
    const srcDir = path.join(DATA_DIR, "projects", projectId);

    if (fsExists(destDir)) {
      // .proq/ already exists — just flip the flag
      stub.workspaceInProject = true;
      writeWorkspace(ws);
      return;
    }

    // Copy source to destination.
    // If src already has the new workspace/ layout, copy as-is.
    // Otherwise, separate shared (project.json, agents/) from personal data.
    if (fsExists(srcDir)) {
      const alreadyMigrated = fsExists(path.join(srcDir, "workspace"));
      if (alreadyMigrated) {
        // Already has workspace/ subdir — copy entire tree directly
        mkdirSync(destDir, { recursive: true });
        const entries = readdirSync(srcDir);
        for (const entry of entries) {
          cpSync(`${srcDir}/${entry}`, `${destDir}/${entry}`, { recursive: true });
        }
      } else {
        // Old flat layout — separate shared from personal
        const wsDestDir = path.join(destDir, "workspace");
        mkdirSync(wsDestDir, { recursive: true });
        mkdirSync(path.join(destDir, "agents"), { recursive: true });

        const sharedEntries = new Set(["project.json", "agents"]);
        const personalRenames: Record<string, string> = { "logs": "sessions" };

        const entries = readdirSync(srcDir);
        for (const entry of entries) {
          const srcPath = `${srcDir}/${entry}`;
          if (sharedEntries.has(entry)) {
            cpSync(srcPath, `${destDir}/${entry}`, { recursive: true });
          } else {
            const destName = personalRenames[entry] || entry;
            cpSync(srcPath, `${wsDestDir}/${destName}`, { recursive: true });
          }
        }
      }
      // Remove old data dir
      try { rmSync(srcDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }

    // Ensure directory structure exists at new location
    stub.workspaceInProject = true;
    writeWorkspace(ws);
    ensureProjectDir(projectId);

    // Add .proq/workspace/ to .gitignore for team projects
    if (gitignoreWorkspace) {
      const gitignorePath = path.join(resolved, '.gitignore');
      let content = '';
      try { content = readFileSync(gitignorePath, 'utf-8'); } catch { /* file may not exist */ }

      const entry = '.proq/workspace/';
      if (!content.includes(entry)) {
        const section = `\n# proq\n${entry}\n`;
        writeFileSync(gitignorePath, content.trimEnd() + '\n' + section);
      }
    }
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
// EXECUTION MODE (per-user workspace)
// ═══════════════════════════════════════════════════════════

export async function getExecutionMode(projectId: string): Promise<ExecutionMode> {
  const ws = getProjectWorkspace(projectId);
  return ws.executionMode ?? 'sequential';
}

export async function setExecutionMode(projectId: string, mode: ExecutionMode): Promise<void> {
  return withWriteLock(`workspace:${projectId}`, async () => {
    const ws = getProjectWorkspace(projectId);
    ws.executionMode = mode;
    writeProjectWorkspace(projectId, ws);
  });
}

// ═══════════════════════════════════════════════════════════
// WORKBENCH STATE (from project workspace)
// ═══════════════════════════════════════════════════════════

export async function getWorkbenchState(projectId: string): Promise<{ open: boolean; height: number | null; orientation: 'horizontal' | 'vertical'; width: number | null }> {
  const ws = getProjectWorkspace(projectId);
  return { open: ws.projectWorkbenchOpen ?? false, height: ws.projectWorkbenchHeight ?? null, orientation: ws.projectWorkbenchOrientation ?? 'horizontal', width: ws.projectWorkbenchWidth ?? null };
}

export async function setWorkbenchState(projectId: string, state: { open?: boolean; height?: number; orientation?: 'horizontal' | 'vertical'; width?: number }): Promise<void> {
  return withWriteLock(`workspace:${projectId}`, async () => {
    const ws = getProjectWorkspace(projectId);
    if (state.open !== undefined) ws.projectWorkbenchOpen = state.open;
    if (state.height !== undefined) ws.projectWorkbenchHeight = state.height;
    if (state.orientation !== undefined) ws.projectWorkbenchOrientation = state.orientation;
    if (state.width !== undefined) ws.projectWorkbenchWidth = state.width;
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

function workbenchSessionPath(projectId: string, tabId: string): string {
  return path.join(workspaceDir(projectId), "sessions", `${tabId}.json`);
}

export async function getWorkbenchSession(projectId: string, tabId: string): Promise<import("./types").WorkbenchSessionData | null> {
  // Try file-based session first
  const filePath = workbenchSessionPath(projectId, tabId);
  if (fsExists(filePath)) {
    return readJSON<import("./types").WorkbenchSessionData | null>(filePath, null);
  }
  // Fall back to legacy inline data in workspace.json (pre-migration)
  const ws = getProjectWorkspace(projectId);
  return ws.projectWorkbenchSessions?.[tabId] ?? null;
}

export async function setWorkbenchSession(projectId: string, tabId: string, sessionData: import("./types").WorkbenchSessionData): Promise<void> {
  return withWriteLock(`wbsession:${tabId}`, async () => {
    ensureProjectDir(projectId);
    writeJSON(workbenchSessionPath(projectId, tabId), sessionData);
  });
}

export async function deleteWorkbenchSession(projectId: string, tabId: string): Promise<void> {
  const filePath = workbenchSessionPath(projectId, tabId);
  try {
    if (fsExists(filePath)) unlinkSync(filePath);
  } catch {
    // best effort
  }
}

// ═══════════════════════════════════════════════════════════
// TASK SESSIONS (agent conversation blocks per task)
// ═══════════════════════════════════════════════════════════

function taskSessionPath(projectId: string, taskId: string): string {
  return path.join(workspaceDir(projectId), "sessions", `${taskId}.json`);
}

export async function getTaskSession(projectId: string, taskId: string): Promise<AgentBlock[]> {
  return readTaskSessionFile(projectId, taskId).blocks;
}

export async function setTaskSession(projectId: string, taskId: string, blocks: AgentBlock[], sessionId?: string): Promise<void> {
  return withWriteLock(`session:${taskId}`, async () => {
    ensureProjectDir(projectId);
    const filePath = taskSessionPath(projectId, taskId);
    writeJSON(filePath, { blocks, sessionId });
  });
}

export async function deleteTaskSession(projectId: string, taskId: string): Promise<void> {
  const filePath = taskSessionPath(projectId, taskId);
  try {
    if (fsExists(filePath)) unlinkSync(filePath);
  } catch {
    // best effort
  }
}

export function readTaskSessionFile(projectId: string, taskId: string): { blocks: AgentBlock[]; sessionId?: string } {
  const filePath = taskSessionPath(projectId, taskId);
  const data = readJSON<{ blocks?: AgentBlock[]; sessionId?: string }>(filePath, {});
  // Handle legacy format (plain array) vs new format ({ blocks, sessionId })
  if (Array.isArray(data)) return { blocks: data };
  return { blocks: data.blocks || [], sessionId: data.sessionId };
}

// ═══════════════════════════════════════════════════════════
// TASK REPORTS
// ═══════════════════════════════════════════════════════════

function taskReportPath(projectId: string, taskId: string): string {
  return path.join(workspaceDir(projectId), "reports", `${taskId}.json`);
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
// CRON JOBS (definitions in project.json, activation in workspace.json)
// ═══════════════════════════════════════════════════════════

/** Compose a CronJob from definition + activation state */
function composeCronJob(def: CronJobDefinition, state?: ActiveCronState): CronJob {
  return {
    id: def.id,
    name: def.name,
    prompt: def.prompt,
    defaultSchedule: def.defaultSchedule,
    schedule: state?.schedule ?? def.defaultSchedule,
    mode: def.mode,
    agentId: def.agentId,
    enabled: !!state,
    lastRunAt: state?.lastRunAt,
    lastTaskId: state?.lastTaskId,
    nextRunAt: state?.nextRunAt,
    runCount: state?.runCount ?? 0,
    createdAt: def.createdAt,
  };
}

export async function getCronJobs(projectId: string): Promise<CronJob[]> {
  const config = getProjectConfig(projectId);
  const ws = getProjectWorkspace(projectId);
  const defs = config.cronJobs ?? [];
  const active = ws.activeCrons ?? {};
  return defs.map(def => composeCronJob(def, active[def.id]));
}

export async function createCronJob(
  projectId: string,
  data: Pick<CronJobDefinition, "name" | "prompt"> & { schedule: string; mode?: CronJobDefinition["mode"]; enabled?: boolean; agentId?: string }
): Promise<CronJob> {
  return withWriteLock(`config:${projectId}`, async () => {
    return withWriteLock(`workspace:${projectId}`, async () => {
      const config = getProjectConfig(projectId);
      if (!config.cronJobs) config.cronJobs = [];

      const id = uuidv7();
      const def: CronJobDefinition = {
        id,
        name: data.name,
        prompt: data.prompt,
        defaultSchedule: data.schedule,
        mode: data.mode,
        agentId: data.agentId,
        createdAt: new Date().toISOString(),
      };
      config.cronJobs.push(def);
      writeProjectConfig(projectId, config);

      // Crons are off by default; only activate if explicitly enabled
      const enabled = data.enabled ?? false;
      let state: ActiveCronState | undefined;
      if (enabled) {
        state = { runCount: 0 };
        const ws = getProjectWorkspace(projectId);
        if (!ws.activeCrons) ws.activeCrons = {};
        ws.activeCrons[id] = state;
        writeProjectWorkspace(projectId, ws);
      }

      return composeCronJob(def, state);
    });
  });
}

export async function updateCronJob(
  projectId: string,
  cronId: string,
  data: Partial<Pick<CronJob, "name" | "prompt" | "schedule" | "defaultSchedule" | "mode" | "enabled" | "lastRunAt" | "lastTaskId" | "nextRunAt" | "runCount" | "agentId">>
): Promise<CronJob | null> {
  return withWriteLock(`config:${projectId}`, async () => {
    return withWriteLock(`workspace:${projectId}`, async () => {
      const config = getProjectConfig(projectId);
      if (!config.cronJobs) return null;
      const def = config.cronJobs.find((j) => j.id === cronId);
      if (!def) return null;

      // Update definition fields in project.json
      // "schedule" from callers updates the shared defaultSchedule (backward compat)
      const newDefaultSchedule = data.defaultSchedule ?? data.schedule;
      let configDirty = false;
      if (data.name !== undefined) { def.name = data.name; configDirty = true; }
      if (data.prompt !== undefined) { def.prompt = data.prompt; configDirty = true; }
      if (newDefaultSchedule !== undefined) { def.defaultSchedule = newDefaultSchedule; configDirty = true; }
      if (data.mode !== undefined) { def.mode = data.mode; configDirty = true; }
      if (data.agentId !== undefined) { def.agentId = data.agentId; configDirty = true; }
      if (configDirty) writeProjectConfig(projectId, config);

      // Update activation / runtime state in workspace.json
      const ws = getProjectWorkspace(projectId);
      if (!ws.activeCrons) ws.activeCrons = {};
      let wsDirty = false;

      if (data.enabled === true && !ws.activeCrons[cronId]) {
        ws.activeCrons[cronId] = { runCount: 0 };
        wsDirty = true;
      } else if (data.enabled === false && ws.activeCrons[cronId]) {
        delete ws.activeCrons[cronId];
        wsDirty = true;
      }

      const state = ws.activeCrons[cronId];
      if (state) {
        if (data.lastRunAt !== undefined) { state.lastRunAt = data.lastRunAt; wsDirty = true; }
        if (data.lastTaskId !== undefined) { state.lastTaskId = data.lastTaskId; wsDirty = true; }
        if (data.nextRunAt !== undefined) { state.nextRunAt = data.nextRunAt; wsDirty = true; }
        if (data.runCount !== undefined) { state.runCount = data.runCount; wsDirty = true; }
      }

      if (wsDirty) writeProjectWorkspace(projectId, ws);

      return composeCronJob(def, ws.activeCrons[cronId]);
    });
  });
}

export async function deleteCronJob(
  projectId: string,
  cronId: string
): Promise<boolean> {
  return withWriteLock(`config:${projectId}`, async () => {
    return withWriteLock(`workspace:${projectId}`, async () => {
      const config = getProjectConfig(projectId);
      if (!config.cronJobs) return false;
      const idx = config.cronJobs.findIndex((j) => j.id === cronId);
      if (idx === -1) return false;
      config.cronJobs.splice(idx, 1);
      writeProjectConfig(projectId, config);

      // Remove activation state if present
      const ws = getProjectWorkspace(projectId);
      if (ws.activeCrons?.[cronId]) {
        delete ws.activeCrons[cronId];
        writeProjectWorkspace(projectId, ws);
      }

      return true;
    });
  });
}

// ═══════════════════════════════════════════════════════════
// AGENTS (per-file storage in agents/)
// ═══════════════════════════════════════════════════════════

function agentsDir(projectId: string): string {
  return path.join(projectDir(projectId), "agents");
}

function agentFileById(projectId: string, id: string): string {
  return path.join(agentsDir(projectId), `${id}.json`);
}

function writeAgentFile(projectId: string, agent: Agent): void {
  ensureProjectDir(projectId);
  writeJSON(agentFileById(projectId, agent.id), agent);
}

export async function getAllAgents(projectId: string): Promise<Agent[]> {
  ensureProjectDir(projectId);
  const dir = agentsDir(projectId);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const agents: Agent[] = [];
  for (const f of files) {
    const fp = path.join(dir, f);
    const raw = readJSON<Agent | null>(fp, null);
    if (!raw) continue;
    agents.push(raw);
  }
  agents.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return agents;
}

export async function getAgent(
  projectId: string,
  agentId: string
): Promise<Agent | null> {
  ensureProjectDir(projectId);
  return readJSON<Agent | null>(agentFileById(projectId, agentId), null);
}

/** Get or auto-create the Default agent for a project. */
export async function getOrCreateDefaultAgent(projectId: string): Promise<Agent> {
  const agents = await getAllAgents(projectId);
  if (agents.length > 0) return agents[0];

  // Seed from project's current systemPrompt
  const config = getProjectConfig(projectId);
  const now = new Date().toISOString();
  const agent: Agent = {
    id: uuidv7(),
    name: "Claude",
    role: "General-purpose agent",
    systemPrompt: config.systemPrompt || "",
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
  data: Pick<Agent, "name"> & Partial<Pick<Agent, "role" | "systemPrompt" | "avatar" | "position">>
): Promise<Agent> {
  const now = new Date().toISOString();
  const agent: Agent = {
    id: uuidv7(),
    name: data.name,
    role: data.role,
    systemPrompt: data.systemPrompt,
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
  data: Partial<Pick<Agent, "name" | "role" | "systemPrompt" | "avatar" | "position">>
): Promise<Agent | null> {
  return withWriteLock(`agent:${agentId}`, async () => {
    const agent = await getAgent(projectId, agentId);
    if (!agent) return null;

    // Use explicit key iteration so undefined values clear fields (Object.assign skips them)
    for (const key of Object.keys(data) as (keyof typeof data)[]) {
      (agent as unknown as Record<string, unknown>)[key] = data[key];
    }

    agent.updatedAt = new Date().toISOString();
    writeAgentFile(projectId, agent);
    return agent;
  });
}

export async function deleteAgent(
  projectId: string,
  agentId: string
): Promise<boolean> {
  const fp = agentFileById(projectId, agentId);
  try {
    if (fsExists(fp)) {
      unlinkSync(fp);
      // Clear defaultAgentId if it pointed to the deleted agent
      const ws = getProjectWorkspace(projectId);
      if (ws.defaultAgentId === agentId) {
        ws.defaultAgentId = undefined;
        writeProjectWorkspace(projectId, ws);
      }
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
  returnKeyNewline: false,
  useChrome: false,

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

// Migrate logs/ → sessions/
function migrateLogsToSessions(): void {
  const ws = getWorkspaceData();
  for (const stub of ws.projects) {
    const dir = projectDir(stub.id);
    const oldLogsDir = path.join(dir, "logs");
    const newSessionsDir = path.join(dir, "sessions");
    if (!fsExists(oldLogsDir)) continue;
    if (fsExists(newSessionsDir)) {
      // sessions/ may have been created empty by ensureProjectDir — move files from logs/ into it
      try {
        const files = readdirSync(oldLogsDir);
        for (const file of files) {
          const dst = path.join(newSessionsDir, file);
          if (!fsExists(dst)) {
            try { renameSync(path.join(oldLogsDir, file), dst); } catch { /* best effort */ }
          }
        }
        // Remove logs/ if now empty
        const remaining = readdirSync(oldLogsDir);
        if (remaining.length === 0) rmSync(oldLogsDir, { recursive: true, force: true });
      } catch { /* best effort */ }
    } else {
      try { renameSync(oldLogsDir, newSessionsDir); } catch { /* best effort */ }
    }
  }
}

// Migrate settings.json → project.json + workspace.json
function migrateSettingsToProjectConfig(projectId: string): void {
  const settingsPath = projectSettingsPath(projectId);
  if (!fsExists(settingsPath)) return;
  const configPath = projectConfigPath(projectId);
  if (fsExists(configPath)) return; // already migrated

  try {
    const old = getProjectSettings(projectId);

    // Build project.json from shared fields
    const config: ProjectConfig = {};
    if (old.systemPrompt) config.systemPrompt = old.systemPrompt;
    if (old.defaultBranch) config.defaultBranch = old.defaultBranch;
    if (old.cronJobs?.length) {
      config.cronJobs = old.cronJobs.map((j) => ({
        id: j.id,
        name: j.name,
        prompt: j.prompt,
        defaultSchedule: j.schedule ?? j.defaultSchedule ?? "0 9 * * *",
        mode: j.mode,
        agentId: j.agentId,
        createdAt: j.createdAt,
      }));
    }
    writeProjectConfig(projectId, config);

    // Merge per-user fields into workspace.json
    const ws = getProjectWorkspace(projectId);
    if (old.executionMode) ws.executionMode = old.executionMode;
    if (old.serverUrl) ws.serverUrl = old.serverUrl;
    if (old.defaultAgentId) ws.defaultAgentId = old.defaultAgentId;

    // Migrate enabled crons → activeCrons
    if (old.cronJobs?.length) {
      if (!ws.activeCrons) ws.activeCrons = {};
      for (const j of old.cronJobs) {
        if (j.enabled) {
          ws.activeCrons[j.id] = {
            schedule: j.schedule ?? j.defaultSchedule,
            lastRunAt: j.lastRunAt,
            lastTaskId: j.lastTaskId,
            nextRunAt: j.nextRunAt,
            runCount: j.runCount ?? 0,
          };
        }
      }
    }
    writeProjectWorkspace(projectId, ws);

    // Remove old settings.json
    try { unlinkSync(settingsPath); } catch { /* best effort */ }
    console.log(`[migration] ${projectId}: settings.json → project.json + workspace.json`);
  } catch (err) {
    console.error(`[migration] ${projectId}: failed to migrate settings.json:`, err);
  }
}

function migrateAllSettingsToProjectConfig(): void {
  const ws = getWorkspaceData();
  for (const stub of ws.projects) {
    const settingsPath = projectSettingsPath(stub.id);
    const configPath = projectConfigPath(stub.id);
    if (fsExists(settingsPath) && !fsExists(configPath)) {
      migrateSettingsToProjectConfig(stub.id);
    }
  }
}

// Migrate inline workbench sessions from workspace.json → sessions/{tabId}.json
function migrateInlineWorkbenchSessions(): void {
  const ws = getWorkspaceData();
  for (const stub of ws.projects) {
    const workspace = getProjectWorkspace(stub.id);
    if (!workspace.projectWorkbenchSessions) continue;
    const entries = Object.entries(workspace.projectWorkbenchSessions);
    if (entries.length === 0) continue;
    ensureProjectDir(stub.id);
    for (const [tabId, sessionData] of entries) {
      const filePath = workbenchSessionPath(stub.id, tabId);
      if (!fsExists(filePath) && sessionData?.agentBlocks?.length) {
        writeJSON(filePath, sessionData);
      }
    }
    delete workspace.projectWorkbenchSessions;
    writeProjectWorkspace(stub.id, workspace);
  }
}

// Run migrations on module load
migrateLogsToSessions();
migrateAllSettingsToProjectConfig();
migrateInlineWorkbenchSessions();
