// ── Project ──────────────────────────────────────────────
export type ProjectTab = 'project' | 'live' | 'code' | 'agents';
export type ViewType = 'kanban' | 'grid';

/** Slim stub stored in root data/workspace.json */
export interface ProjectStub {
  id: string;
  name: string;
  path: string;
  order?: number;
  workspaceInProject?: boolean;
  createdAt: string;
}

/** Full project object returned by the API (assembled from stub + settings + workspace) */
export interface Project extends ProjectStub {
  status?: 'active' | 'review' | 'idle' | 'error';
  serverUrl?: string;
  pathValid?: boolean;
  activeTab?: ProjectTab;
  viewType?: ViewType;
  liveViewport?: 'desktop' | 'tablet' | 'mobile';
  liveUrl?: string;
  defaultBranch?: string;
  systemPrompt?: string;
  defaultAgentId?: string;
}

export interface WorkspaceData {
  projects: ProjectStub[];
}

// ── Render Mode ─────────────────────────────────────────
export type AgentRenderMode = 'cli' | 'structured';

// ── Agent Block Types ───────────────────────────────────
export type AgentBlock =
  | { type: 'text';        text: string }
  | { type: 'thinking';    thinking: string }
  | { type: 'tool_use';    toolId: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolId: string; name: string; output: string; isError?: boolean }
  | { type: 'user';        text: string; attachments?: TaskAttachment[] }
  | { type: 'status';      subtype: 'init' | 'complete' | 'error' | 'abort' | 'interrupted';
      sessionId?: string; model?: string; costUsd?: number;
      durationMs?: number; turns?: number; error?: string; timestamp?: string }
  | { type: 'task_update'; summary: string; nextSteps?: string; timestamp: string }
  | { type: 'stream_delta'; text: string };

// ── Agent WS Protocol ───────────────────────────────────
// Server → Client
export type AgentWsServerMsg =
  | { type: 'replay'; blocks: AgentBlock[]; active: boolean }
  | { type: 'block';  block: AgentBlock; active: boolean }
  | { type: 'active'; active: boolean }
  | { type: 'stream_delta'; text: string }
  | { type: 'error';  error: string };

// Client → Server
export type AgentWsClientMsg =
  | { type: 'followup'; text: string; attachments?: TaskAttachment[]; mode?: TaskMode }
  | { type: 'plan-approve'; text: string }
  | { type: 'interrupt'; text: string; attachments?: TaskAttachment[] }
  | { type: 'stop' }
  | { type: 'clear' };

// ── Task ─────────────────────────────────────────────────
export type TaskStatus = "todo" | "in-progress" | "verify" | "done";

export interface TaskAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  filePath?: string;
  url?: string;
}

export type TaskMode = 'auto' | 'answer' | 'plan' | 'build';

export interface FollowUpDraft {
  text: string;
  attachments: TaskAttachment[];
}

export interface Task {
  id: string;
  title?: string;
  description: string;
  status: TaskStatus;
  priority?: 'low' | 'medium' | 'high';
  mode?: TaskMode;
  /** @deprecated Will move to TaskReport in a future release */
  summary?: string;
  /** @deprecated Will move to TaskReport in a future release */
  nextSteps?: string;
  needsAttention?: boolean;
  agentLog?: string;
  agentStatus?: "queued" | "starting" | "running" | null;
  worktreePath?: string;
  branch?: string;
  baseBranch?: string;
  mergeConflict?: {
    error: string;
    files: string[];
    branch: string;
    diff?: string; // unified diff showing what conflicts
  };
  startCommit?: string;
  commitHashes?: string[];
  renderMode?: AgentRenderMode;
  sessionId?: string;
  attachments?: TaskAttachment[];
  cronJobId?: string;             // links task to source cron job
  agentId?: string;               // links task to assigned agent
  createdAt: string;
  updatedAt: string;
}

export type TaskColumns = Record<TaskStatus, Task[]>;
export type TaskColumnIds = Record<TaskStatus, string[]>;

// ── Chat ─────────────────────────────────────────────────
export interface ToolCall {
  action: string;
  detail: string;
}

export interface ChatLogEntry {
  role: "proq" | "user";
  message: string;
  timestamp: string;
  toolCalls?: ToolCall[];
  attachments?: TaskAttachment[];
}

// ── Agent session ────────────────────────────────────────
export interface AgentSession {
  sessionKey: string;
  status: string;
}

// ── Deleted task entry (for undo) ────────────────────────
export interface DeletedTaskEntry {
  task: Task;
  column: TaskStatus;
  index: number;
  deletedAt: string; // ISO timestamp
}

// ── Settings ─────────────────────────────────────────
export interface ProqSettings {
  // Agent
  claudeBin: string;
  defaultModel: string;
  systemPromptAdditions: string;
  executionMode: ExecutionMode;
  agentRenderMode: AgentRenderMode;
  showCosts: boolean;
  codingAgent: string;
  allowAgentInterrupts: boolean;
  returnKeyNewline: boolean;
  useChrome: boolean;

  // Updates
  autoUpdate: boolean;

  // Appearance
  theme: 'dark' | 'light' | 'system';

  // Notifications
  soundNotifications: boolean;
  localNotifications: boolean;
  webhooks: string[];

  // Read-only (injected by API, not stored)
  version?: string;
}

// ── MCP & Skills (read-only display) ───────────────────
export interface McpServerInfo {
  name: string;
  type: 'http' | 'stdio' | 'sse' | string;
  url?: string;
  command?: string;
  args?: string[];
}

export interface SkillInfo {
  name: string;
  filename: string;
}

// ── Cron Jobs ───────────────────────────────────────────

/** Shared cron job definition — lives in project.json */
export interface CronJobDefinition {
  id: string;
  name: string;
  prompt: string;
  defaultSchedule: string;    // cron expression: "0 9 * * *" or "every 6h"
  mode?: TaskMode;
  agentId?: string;
  createdAt: string;
}

/** Per-user cron activation state — lives in workspace.json activeCrons map */
export interface ActiveCronState {
  schedule?: string;          // override; omit to use defaultSchedule
  lastRunAt?: string;
  lastTaskId?: string;
  nextRunAt?: string;
  runCount?: number;
}

/** Composed cron job — merged from definition + activation for API/scheduler use */
export interface CronJob {
  id: string;
  name: string;
  prompt: string;
  defaultSchedule: string;
  schedule: string;           // resolved: user override or defaultSchedule
  mode?: TaskMode;
  agentId?: string;
  enabled: boolean;           // derived: presence in activeCrons
  lastRunAt?: string;
  lastTaskId?: string;
  nextRunAt?: string;
  runCount: number;
  createdAt: string;
}

// ── Agent ───────────────────────────────────────────────
export interface Agent {
  id: string;           // uuidv7 — stable, never changes
  name: string;         // "Default", "Chief Research Officer"
  role?: string;        // short purpose statement
  systemPrompt?: string;
  avatar?: { color: string; icon?: string };
  position?: { x: number; y: number }; // React Flow canvas position
  createdAt: string;
  updatedAt: string;
}

// ── Per-project state ────────────────────────────────────
export type ExecutionMode = 'sequential' | 'parallel' | 'worktrees';

export interface WorkbenchTabInfo {
  id: string;
  label: string;
  type?: 'shell' | 'agent'; // defaults to 'shell' for backward compat
  agentId?: string;          // links workbench tab to assigned agent
}

export interface WorkbenchSessionData {
  agentBlocks: AgentBlock[];
  sessionId?: string;
  mode?: TaskMode;
}

/** Per-project project.json — shared config, can be committed to git */
export interface ProjectConfig {
  systemPrompt?: string;
  defaultBranch?: string;
  cronJobs?: CronJobDefinition[];
}

/** @deprecated Use ProjectConfig + ProjectWorkspace instead. Kept for migration. */
export interface ProjectSettings {
  version?: number;
  executionMode?: ExecutionMode;
  systemPrompt?: string;
  defaultBranch?: string;
  serverUrl?: string;
  defaultAgentId?: string;
  cronJobs?: Array<{
    id: string; name: string; prompt: string; createdAt: string;
    schedule?: string; defaultSchedule?: string;
    mode?: TaskMode; agentId?: string; enabled?: boolean;
    lastRunAt?: string; lastTaskId?: string; nextRunAt?: string; runCount?: number;
  }>;
}

/** Per-project workspace.json — local/live state, per-user */
export interface ProjectWorkspace {
  tasks: TaskColumnIds;
  chatLog: ChatLogEntry[];
  recentlyDeleted?: DeletedTaskEntry[];
  // UI state
  status?: 'active' | 'review' | 'idle' | 'error';
  activeTab?: ProjectTab;
  viewType?: ViewType;
  liveViewport?: 'desktop' | 'tablet' | 'mobile';
  liveUrl?: string;
  // Workbench
  projectWorkbenchOpen?: boolean;
  projectWorkbenchHeight?: number;
  projectWorkbenchOrientation?: 'horizontal' | 'vertical';
  projectWorkbenchWidth?: number;
  projectWorkbenchTabs?: WorkbenchTabInfo[];
  projectWorkbenchActiveTabId?: string;
  /** @deprecated Workbench sessions now stored in sessions/{tabId}.json files. Kept for migration. */
  projectWorkbenchSessions?: Record<string, WorkbenchSessionData>;
  // Per-user overrides (moved from ProjectSettings)
  executionMode?: ExecutionMode;
  defaultAgentId?: string;
  serverUrl?: string;
  // Cron activation — keyed by cron job id; presence = enabled
  activeCrons?: Record<string, ActiveCronState>;
}

/** Agent work report — stored in reports/{taskId}.json */
export interface TaskReport {
  taskId: string;
  title: string;
  summary: string;
  nextSteps?: string;
  commitHashes?: string[];
  timestamp: string;
  updatedAt: string;
}

/** @deprecated Use ProjectConfig + ProjectWorkspace instead. Kept for migration. */
export interface ProjectState {
  tasks: TaskColumns;
  chatLog: ChatLogEntry[];
  agentSession?: AgentSession;
  executionMode?: ExecutionMode;
  projectWorkbenchOpen?: boolean;
  projectWorkbenchHeight?: number;
  projectWorkbenchTabs?: WorkbenchTabInfo[];
  projectWorkbenchActiveTabId?: string;
  projectWorkbenchSessions?: Record<string, WorkbenchSessionData>;
  recentlyDeleted?: DeletedTaskEntry[];
  cronJobs?: CronJob[];
}
