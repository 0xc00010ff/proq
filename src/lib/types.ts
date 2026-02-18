// ── Project ──────────────────────────────────────────────
export type ProjectStatus = 'active' | 'review' | 'idle' | 'error';

export interface Project {
  id: string;
  name: string;
  path: string;
  status?: ProjectStatus;
  serverUrl?: string;
  order?: number;
  pathValid?: boolean;
  createdAt: string;
}

export interface ConfigData {
  projects: Project[];
}

// ── Task ─────────────────────────────────────────────────
export type TaskStatus = "todo" | "in-progress" | "verify" | "done";

export interface TaskAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  dataUrl?: string;
}

export type TaskMode = 'code' | 'plan' | 'answer';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority?: 'low' | 'medium' | 'high';
  mode?: TaskMode;
  order?: number;
  findings?: string;
  humanSteps?: string;
  agentLog?: string;
  locked?: boolean;
  attachments?: TaskAttachment[];
  createdAt: string;
  updatedAt: string;
}

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
}

// ── Agent session ────────────────────────────────────────
export interface AgentSession {
  sessionKey: string;
  status: string;
}

// ── Per-project state ────────────────────────────────────
export type ExecutionMode = 'sequential' | 'parallel';

export interface ProjectState {
  tasks: Task[];
  chatLog: ChatLogEntry[];
  agentSession?: AgentSession;
  executionMode?: ExecutionMode;
}
