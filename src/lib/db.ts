import { JSONFilePreset } from "lowdb/node";
import { v4 as uuidv4 } from "uuid";
import { renameSync, existsSync as fsExists, mkdirSync } from "fs";
import path from "path";
import type {
  WorkspaceData,
  Project,
  ProjectState,
  Task,
  ChatLogEntry,
  ExecutionMode,
} from "./types";
import type { Low } from "lowdb";
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

// ── Singleton caches to prevent concurrent write corruption ──
let workspaceDbInstance: Low<WorkspaceData> | null = null;
const projectDbInstances = new Map<string, Low<ProjectState>>();
const writeLocks = new Map<string, Promise<void>>();

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

// ── Workspace DB (projects list) ─────────────────────────
async function getWorkspaceDb() {
  if (!workspaceDbInstance) {
    const filePath = path.join(DATA_DIR, "workspace.json");
    const defaultData: WorkspaceData = { projects: [] };
    workspaceDbInstance = await JSONFilePreset<WorkspaceData>(filePath, defaultData);
  }
  return workspaceDbInstance;
}

// ── Project DB (per-project tasks + chat) ────────────────
async function getProjectDb(projectId: string) {
  let db = projectDbInstances.get(projectId);
  if (!db) {
    const filePath = path.join(DATA_DIR, "projects", `${projectId}.json`);
    const defaultData: ProjectState = { tasks: [], chatLog: [] };
    db = await JSONFilePreset<ProjectState>(filePath, defaultData);
    projectDbInstances.set(projectId, db);
  }
  return db;
}

// ═══════════════════════════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════════════════════════

export async function getAllProjects(): Promise<Project[]> {
  const db = await getWorkspaceDb();
  return [...db.data.projects].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await getWorkspaceDb();
  return db.data.projects.find((p) => p.id === id);
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
  const db = await getWorkspaceDb();
  const existingIds = db.data.projects.map((p) => p.id);
  const project: Project = {
    id: uniqueSlug(slugify(data.name), existingIds),
    name: data.name,
    path: data.path,
    serverUrl: data.serverUrl,
    createdAt: new Date().toISOString(),
  };
  db.data.projects.push(project);
  await db.write();
  return project;
  });
}

export async function updateProject(
  id: string,
  data: Partial<Pick<Project, "name" | "path" | "status" | "serverUrl">>
): Promise<Project | null> {
  return withWriteLock('workspace', async () => {
    const db = await getWorkspaceDb();
    const project = db.data.projects.find((p) => p.id === id);
    if (!project) return null;

    // If name is changing, update the slug-based id
    if (data.name && data.name !== project.name) {
      const newSlug = slugify(data.name);
      const existingIds = db.data.projects.filter((p) => p.id !== id).map((p) => p.id);
      const newId = uniqueSlug(newSlug, existingIds);

      // Rename state file
      const oldFile = path.join(DATA_DIR, "projects", `${id}.json`);
      const newFile = path.join(DATA_DIR, "projects", `${newId}.json`);
      if (fsExists(oldFile)) {
        renameSync(oldFile, newFile);
      }

      // Update cache
      const cached = projectDbInstances.get(id);
      if (cached) {
        projectDbInstances.delete(id);
        projectDbInstances.set(newId, cached);
      }

      project.id = newId;
    }

    Object.assign(project, data);
    await db.write();
    return project;
  });
}

export async function deleteProject(id: string): Promise<boolean> {
  return withWriteLock('workspace', async () => {
    const db = await getWorkspaceDb();
    const idx = db.data.projects.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    db.data.projects.splice(idx, 1);
    await db.write();
    return true;
  });
}

export async function reorderProjects(
  orderedIds: string[]
): Promise<boolean> {
  return withWriteLock('workspace', async () => {
    const db = await getWorkspaceDb();
    for (let i = 0; i < orderedIds.length; i++) {
      const project = db.data.projects.find((p) => p.id === orderedIds[i]);
      if (project) project.order = i;
    }
    await db.write();
    return true;
  });
}

// ═══════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════

export async function getAllTasks(projectId: string): Promise<Task[]> {
  const db = await getProjectDb(projectId);
  return [...db.data.tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function getTask(
  projectId: string,
  taskId: string
): Promise<Task | undefined> {
  const db = await getProjectDb(projectId);
  return db.data.tasks.find((t) => t.id === taskId);
}

export async function createTask(
  projectId: string,
  data: Pick<Task, "title" | "description"> & { priority?: Task["priority"] }
): Promise<Task> {
  return withWriteLock(`project:${projectId}`, async () => {
    const db = await getProjectDb(projectId);
    const now = new Date().toISOString();
    const maxOrder = db.data.tasks.reduce((max, t) => Math.max(max, t.order ?? 0), 0);
    const task: Task = {
      id: uuidv4(),
      title: data.title,
      description: data.description,
      status: "todo",
      priority: data.priority,
      order: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    };
    db.data.tasks.push(task);
    await db.write();
    return task;
  });
}

export async function reorderTasks(
  projectId: string,
  orderedIds: { id: string; order: number; status?: string }[]
): Promise<boolean> {
  return withWriteLock(`project:${projectId}`, async () => {
    const db = await getProjectDb(projectId);
    for (const item of orderedIds) {
      const task = db.data.tasks.find((t) => t.id === item.id);
      if (task) {
        task.order = item.order;
        if (item.status) task.status = item.status as Task["status"];
        task.updatedAt = new Date().toISOString();
      }
    }
    await db.write();
    return true;
  });
}

export async function updateTask(
  projectId: string,
  taskId: string,
  data: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "order" | "findings" | "humanSteps" | "agentLog" | "locked" | "attachments" | "mode">>
): Promise<Task | null> {
  return withWriteLock(`project:${projectId}`, async () => {
    const db = await getProjectDb(projectId);
    const task = db.data.tasks.find((t) => t.id === taskId);
    if (!task) return null;
    Object.assign(task, data, { updatedAt: new Date().toISOString() });
    await db.write();
    return task;
  });
}

export async function deleteTask(
  projectId: string,
  taskId: string
): Promise<boolean> {
  return withWriteLock(`project:${projectId}`, async () => {
    const db = await getProjectDb(projectId);
    const idx = db.data.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return false;
    db.data.tasks.splice(idx, 1);
    await db.write();
    return true;
  });
}

// ═══════════════════════════════════════════════════════════
// EXECUTION MODE
// ═══════════════════════════════════════════════════════════

export async function getExecutionMode(projectId: string): Promise<ExecutionMode> {
  const db = await getProjectDb(projectId);
  return db.data.executionMode ?? 'sequential';
}

export async function setExecutionMode(projectId: string, mode: ExecutionMode): Promise<void> {
  return withWriteLock(`project:${projectId}`, async () => {
    const db = await getProjectDb(projectId);
    db.data.executionMode = mode;
    await db.write();
  });
}

// ═══════════════════════════════════════════════════════════
// TERMINAL STATE
// ═══════════════════════════════════════════════════════════

export async function getTerminalOpen(projectId: string): Promise<boolean> {
  const db = await getProjectDb(projectId);
  return db.data.terminalOpen ?? false;
}

export async function setTerminalOpen(projectId: string, open: boolean): Promise<void> {
  return withWriteLock(`project:${projectId}`, async () => {
    const db = await getProjectDb(projectId);
    db.data.terminalOpen = open;
    await db.write();
  });
}

// ═══════════════════════════════════════════════════════════
// CHAT LOG
// ═══════════════════════════════════════════════════════════

export async function getChatLog(projectId: string): Promise<ChatLogEntry[]> {
  const db = await getProjectDb(projectId);
  return db.data.chatLog;
}

export async function addChatMessage(
  projectId: string,
  data: Pick<ChatLogEntry, "role" | "message" | "toolCalls">
): Promise<ChatLogEntry> {
  return withWriteLock(`project:${projectId}`, async () => {
    const db = await getProjectDb(projectId);
    const entry: ChatLogEntry = {
      role: data.role,
      message: data.message,
      timestamp: new Date().toISOString(),
      toolCalls: data.toolCalls,
    };
    db.data.chatLog.push(entry);
    await db.write();
    return entry;
  });
}
