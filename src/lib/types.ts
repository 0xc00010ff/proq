// ── Project ──────────────────────────────────────────────
export type ProjectTab = 'project' | 'live' | 'code';
export type ViewType = 'kanban' | 'list' | 'grid';

export interface Project {
  id: string;
  name: string;
  path: string;
  status?: 'active' | 'review' | 'idle' | 'error';
  serverUrl?: string;
  order?: number;
  pathValid?: boolean;
  activeTab?: ProjectTab;
  viewType?: ViewType;
  liveViewport?: 'desktop' | 'tablet' | 'mobile';
  defaultBranch?: string;
  systemPrompt?: string;
  createdAt: string;
}

export interface WorkspaceData {
  projects: Project[];
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
  | { type: 'status';      subtype: 'init' | 'complete' | 'error' | 'abort';
      sessionId?: string; model?: string; costUsd?: number;
      durationMs?: number; turns?: number; error?: string; timestamp?: string }
  | { type: 'task_update'; summary: string; nextSteps?: string; timestamp: string }
  | { type: 'stream_delta'; text: string };

// ── Agent WS Protocol ───────────────────────────────────
// Server → Client
export type AgentWsServerMsg =
  | { type: 'replay'; blocks: AgentBlock[]; live?: boolean }
  | { type: 'block';  block: AgentBlock }
  | { type: 'stream_delta'; text: string }
  | { type: 'error';  error: string };

// Client → Server
export type AgentWsClientMsg =
  | { type: 'followup'; text: string; attachments?: TaskAttachment[] }
  | { type: 'plan-approve'; text: string }
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
  summary?: string;
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
  agentBlocks?: AgentBlock[];
  sessionId?: string;
  attachments?: TaskAttachment[];
  cronJobId?: string;             // links task to source cron job
  createdAt: string;
  updatedAt: string;
}

export type TaskColumns = Record<TaskStatus, Task[]>;

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

  // Updates
  autoUpdate: boolean;

  // Appearance
  theme: 'dark' | 'light' | 'system';

  // Notifications
  soundNotifications: boolean;
  localNotifications: boolean;
  webhooks: string[];
}

// ── Cron Jobs ───────────────────────────────────────────
export interface CronJob {
  id: string;
  name: string;
  prompt: string;
  schedule: string;           // cron expression: "0 9 * * *" or "every 6h"
  mode?: TaskMode;            // default: auto
  enabled: boolean;
  lastRunAt?: string;
  lastTaskId?: string;
  nextRunAt?: string;
  runCount: number;
  createdAt: string;
}

// ── Per-project state ────────────────────────────────────
export type ExecutionMode = 'sequential' | 'parallel' | 'worktrees';

export interface WorkbenchTabInfo {
  id: string;
  label: string;
  type?: 'shell' | 'agent'; // defaults to 'shell' for backward compat
}

export interface WorkbenchSessionData {
  agentBlocks: AgentBlock[];
  sessionId?: string;
}


export interface ProjectState {
  tasks: TaskColumns;
  chatLog: ChatLogEntry[];
  agentSession?: AgentSession;
  executionMode?: ExecutionMode;
  projectWorkbenchOpen?: boolean;
  projectWorkbenchHeight?: number;
  projectWorkbenchTabs?: WorkbenchTabInfo[];
  projectWorkbenchActiveTabId?: string;
  liveWorkbenchTabs?: WorkbenchTabInfo[];
  liveWorkbenchActiveTabId?: string;
  projectWorkbenchSessions?: Record<string, WorkbenchSessionData>;
  recentlyDeleted?: DeletedTaskEntry[];
  cronJobs?: CronJob[];
}
