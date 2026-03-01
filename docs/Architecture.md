# Architecture

How proq works under the hood. For a usage walkthrough, see [Getting Started](./Getting-Started.md).

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│  Browser (localhost:1337)                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │  Kanban   │ │   Live   │ │   Code   │ │ Workbench │  │
│  │  Board    │ │  Preview │ │  Browser │ │ (shells + │  │
│  │          │ │  (iframe)│ │  (Monaco)│ │  agents)  │  │
│  └────┬─────┘ └──────────┘ └──────────┘ └─────┬─────┘  │
│       │ REST + polling                   WebSocket      │
└───────┼──────────────────────────────────────┼──────────┘
        │                                      │
┌───────┴──────────────────────────────────────┴──────────┐
│  Next.js Server (:1337)            WS Hub (:42069)      │
│  ┌──────────┐ ┌──────────────┐     ┌──────────────────┐ │
│  │ REST API │ │ Dispatch     │     │ /ws/agent        │ │
│  │          │ │ Engine       │     │ /ws/terminal     │ │
│  │          │ │ (processQ)   │     │ /ws/supervisor   │ │
│  │          │ │              │     │ /ws/agent-tab    │ │
│  └────┬─────┘ └──────┬───────┘     └──────────────────┘ │
│       │              │                                   │
│  ┌────┴─────┐   ┌────┴──────────────────────┐           │
│  │  lowdb   │   │  Agent Processes           │           │
│  │  (JSON)  │   │  ┌────────┐ ┌────────┐    │           │
│  │          │   │  │Struct. │ │  CLI   │    │           │
│  │          │   │  │Session │ │ (tmux) │    │           │
│  └──────────┘   │  │(spawn) │ │        │    │           │
│                 │  └────────┘ └────────┘    │           │
│                 └───────────────────────────┘           │
└─────────────────────────────────────────────────────────┘
        │                    │
        ▼                    ▼
  ┌──────────┐     ┌──────────────────┐
  │  data/   │     │ Project Codebases│
  │  JSON    │     │ ~/project-a/     │
  │  files   │     │ ~/project-b/     │
  └──────────┘     └──────────────────┘
```

**Next.js server** handles the REST API, serves the React SPA, and runs the dispatch engine. **Agent processes** are spawned per-task — either as child processes (structured mode) or inside tmux sessions (CLI mode). **WebSocket hub** on port 42069 streams agent output, terminal PTY data, supervisor messages, and agent tab sessions. **lowdb** stores all state as JSON files — no external database.

## Data Layer

All state lives in `data/`, which is gitignored. Each user gets their own local state, auto-created on first run.

### `data/workspace.json`

The project registry. Array of projects, each with:

```typescript
interface Project {
  id: string;
  name: string;
  path: string;
  status?: 'active' | 'review' | 'idle' | 'error';
  serverUrl?: string;      // dev server URL for live preview
  order?: number;           // sidebar sort order
  activeTab?: 'project' | 'live' | 'code';
  liveViewport?: 'desktop' | 'tablet' | 'mobile';
  createdAt: string;
}
```

### `data/projects/{id}.json`

Per-project state file containing:

```typescript
interface ProjectState {
  columns: Record<TaskStatus, Task[]>;  // todo, in-progress, verify, done
  chatLog: ChatLogEntry[];
  executionMode?: 'sequential' | 'parallel';
  workbenchOpen?: boolean;
  workbenchHeight?: number;
  workbenchTabs?: WorkbenchTabInfo[];
  workbenchActiveTabId?: string;
  agentTabs?: Record<string, AgentTabData>;
  recentlyDeleted?: DeletedTaskEntry[];
}
```

Tasks are stored in ordered arrays within each column — array position is the sort order.

### Auto-Migration

The database layer (`db.ts`) handles schema migration on read. Old formats (single `tasks` array, legacy `config.json`, `state/` directory) are automatically upgraded to the current column-based structure.

## Task Lifecycle

```
todo ────────→ in-progress ────────→ verify ────────→ done
               dispatch: "queued"                │         │
               dispatch: "starting"              │         │ merge branch
               dispatch: "running"               │         │ into main
                                                 │         │ (parallel)
               ◄── abort (back to todo) ─────────┘         │
                                                           │
               ◄── reject (back to todo) ──────────────────┘
```

### Dispatch Sub-States

When a task moves to in-progress, it enters the dispatch pipeline:

1. **queued** — waiting for its turn (sequential) or for processQueue to run (parallel)
2. **starting** — selected by processQueue, agent process is launching
3. **running** — agent is actively working (tmux session alive or child process running)
4. **null** — not dispatched (task is in todo, verify, or done)

### Side Effects Per Transition

| Transition | What happens |
|---|---|
| → in-progress | Set `dispatch: "queued"`, call `processQueue()` |
| in-progress → verify | Keep worktree alive (parallel). Send notification |
| in-progress → todo | Abort agent. Remove worktree/branch (parallel). Clear dispatch/findings |
| in-progress → done | Merge branch into main (parallel). Remove worktree. Send notification |
| verify → done | Merge branch into main (parallel). Remove worktree. On conflict, stay in verify |
| verify → todo | Remove worktree/branch (parallel). Discard work |

All API routes follow the same pattern: **update state → call `processQueue()`**.

### `processQueue()`

The orchestrator. Called after any state change. Has a re-entrancy guard per project to prevent double-dispatching.

- **Sequential mode**: launches the first queued task if nothing is running
- **Parallel mode**: launches all queued tasks simultaneously

## Agent Dispatch

`dispatchTask()` in `agent-dispatch.ts` handles the full launch sequence:

1. **Write MCP config** — creates a temp JSON file pointing to `proq-mcp.js` with the project/task IDs
2. **Build system prompt** — mode-specific instructions (build: commit code; plan/answer: no file changes)
3. **Write image attachments** — base64 data URLs decoded to temp files the agent can read
4. **Create worktree** (parallel mode, build tasks only) — isolated git worktree at `.proq-worktrees/{shortId}/`
5. **Launch agent** — two paths depending on render mode

### Structured Mode (default)

Spawns the Claude CLI as a child process with `--output-format stream-json`:

```
claude -p <prompt> --output-format stream-json --verbose \
  --dangerously-skip-permissions --max-turns 200 \
  --model <model> --append-system-prompt <proq-prompt> \
  --mcp-config <mcp-config.json>
```

stdout emits newline-delimited JSON events (`system`, `assistant`, `user`, `result`). These are parsed into `AgentBlock[]` and broadcast to WebSocket clients in real time.

Session state (`AgentRuntimeSession`) is held in a globalThis map that survives HMR. When the process exits, blocks are persisted to the task's `agentBlocks` field in the database.

Follow-up messages use `--resume <sessionId>` to continue the conversation.

### CLI Mode

Launches inside a tmux session with a PTY bridge:

```
tmux new-session -d -s mc-{shortId} -c {projectPath} \
  node proq-bridge.js {socketPath} {launcherScript}
```

The bridge (`proq-bridge.js`) spawns the Claude CLI in a real PTY via node-pty, exposes a unix socket at `/tmp/proq/mc-{shortId}.sock`, and maintains a 50KB scrollback ring buffer. Clients connect to the socket to stream terminal output. Reconnection replays the scrollback.

tmux acts purely as a process container — crash survival, enumeration (`tmux ls | grep ^mc-`), and kill (`tmux kill-session`).

## MCP Callback

`proq-mcp.js` is a stdio MCP server spawned per-task via `--mcp-config`. It exposes two tools:

| Tool | Description |
|---|---|
| `read_task` | Fetch current task state (title, description, findings, status). Agent uses this before updating to build cumulative findings |
| `update_task` | Set findings + optional humanSteps, move task to Verify. Each call replaces the previous summary |

The MCP server communicates with the proq REST API over localhost. This replaced the earlier curl-based callback — MCP tools are more reliable and the agent discovers them automatically.

## Render Modes

### Structured

The default mode. Agent output is parsed from `--output-format stream-json` into typed blocks:

| Block Type | Content |
|---|---|
| `text` | Agent's text responses |
| `thinking` | Extended thinking / reasoning |
| `tool_use` | Tool call with name + input |
| `tool_result` | Tool output (success or error) |
| `user` | User messages (initial prompt + follow-ups) |
| `status` | Session lifecycle: init, complete, error, abort |
| `task_update` | Findings reported via MCP `update_task` |
| `stream_delta` | Incremental text during streaming |

Blocks are rendered in the agent modal as collapsible sections — thinking folds up, tool calls show input/output on expand, text renders as markdown.

### CLI

Raw terminal rendering via xterm.js. The bridge process (`proq-bridge.js`) maintains a unix socket that the frontend's WebSocket terminal handler connects to. Features:

- 50KB scrollback ring buffer
- Reconnection with full scrollback replay
- Resize propagation (cols/rows via JSON message → `proc.resize()`)
- Session survives server restarts (tmux owns the process tree)

## WebSocket Protocol

Central hub on port 42069 (`ws-server.ts`). Routes by pathname:

| Path | Purpose | Protocol |
|---|---|---|
| `/ws/agent?taskId=X&projectId=Y` | Task agent sessions | Server sends `replay` (all blocks) + `block` (new). Client sends `followup` or `stop` |
| `/ws/terminal?id=X&cwd=Y` | Shell PTY sessions | Bidirectional raw terminal data. JSON `{ type: "resize", cols, rows }` for resize |
| `/ws/supervisor` | Supervisor session | Same block protocol as agent. Client sends `{ type: "message", text }` or `{ type: "stop" }` |
| `/ws/agent-tab?tabId=X&projectId=Y` | Workbench agent tabs | Same block protocol as agent |

### Agent/Supervisor Message Flow

**Server → Client:**
- `{ type: "replay", blocks: AgentBlock[] }` — full history on connect
- `{ type: "block", block: AgentBlock }` — new block appended
- `{ type: "error", error: string }` — error message

**Client → Server:**
- `{ type: "followup", text: string, attachments?: [] }` — send follow-up message
- `{ type: "stop" }` — abort the running session

## Supervisor

A persistent Claude Code instance accessible at `/supervisor`. Unlike task agents, the supervisor:

- Runs in proq's own codebase directory
- Has a system prompt with all loaded projects and the full REST API reference
- Can create, update, move, and delete tasks across any project
- Maintains conversation history across page reloads (persisted to DB)
- Uses the same structured block rendering as task agents

The supervisor session is a singleton on `globalThis` (survives HMR). Conversation history is stored via `setSupervisorAgentBlocks()` and restored on reconnect.

## Git Integration

### Branch API (`/api/projects/[id]/git`)

| Method | Action |
|---|---|
| `GET` | Returns `{ current, detached, branches }` — current branch, detached HEAD state, all local branches |
| `POST { branch }` | Switch branch. Auto-stashes uncommitted changes. Creates preview branch for `proq/*` branches |
| `PATCH` | Refresh preview branch — fast-forward merge from source `proq/*` branch |

### Branch Handling

- `proq-preview/*` branches are filtered from the branch list — the API reports the source `proq/*` branch instead
- `proq/*` branches in the branch list are annotated with their task title
- Auto-stash pushes/pops `proq-auto-stash` entries to preserve uncommitted work during branch switches

For the full worktree and parallel mode deep dive, see [Parallel Worktrees](./Parallel-Worktrees.md).

## Settings Reference

All settings are stored via the `/api/settings` endpoint and persisted in `data/settings.json`.

### System

| Field | Type | Default | Description |
|---|---|---|---|
| `port` | number | 1337 | Server port |

### Agent

| Field | Type | Default | Description |
|---|---|---|---|
| `claudeBin` | string | `"claude"` | Path to Claude Code binary |
| `defaultModel` | string | `""` | Model to use (e.g. `claude-sonnet-4-20250514`) |
| `systemPromptAdditions` | string | `""` | Extra instructions appended to every agent's system prompt |
| `executionMode` | `"sequential"` \| `"parallel"` | `"sequential"` | Whether tasks run one-at-a-time or simultaneously |
| `agentRenderMode` | `"structured"` \| `"cli"` | `"structured"` | Default render mode for new tasks |

### Git

| Field | Type | Default | Description |
|---|---|---|---|
| `autoCommit` | boolean | `true` | Whether agents should auto-commit |
| `commitStyle` | string | `""` | Commit message style instructions |
| `autoPush` | boolean | `false` | Push after commit |
| `showGitBranches` | boolean | `true` | Show branch switcher in TopBar |

### Appearance

| Field | Type | Default | Description |
|---|---|---|---|
| `theme` | `"dark"` \| `"light"` | `"dark"` | UI theme |

### Notifications

| Field | Type | Default | Description |
|---|---|---|---|
| `notificationMethod` | `"none"` \| `"slack"` \| `"system"` \| `"sound"` | `"none"` | How to notify on task completion |
| `openclawBin` | string | `""` | Path to OpenClaw CLI binary (for Slack notifications) |
| `slackChannel` | string | `""` | Slack channel for notifications |
| `webhooks` | string | `""` | Webhook URLs for notifications |

### Process

| Field | Type | Default | Description |
|---|---|---|---|
| `cleanupDelay` | number | 3600000 | Milliseconds before cleaning up completed agent sessions (1 hour) |
| `taskPollInterval` | number | 5000 | Dashboard polling interval in milliseconds |
| `deletedTaskRetention` | number | 300000 | How long deleted tasks are kept for undo (5 minutes) |
| `terminalScrollback` | number | 50000 | Terminal scrollback buffer size in characters |

## REST API Reference

Base URL: `http://localhost:1337`

### Projects

#### `GET /api/projects`

List all projects.

**Response:** `Project[]`

#### `POST /api/projects`

Create a project.

**Body:** `{ name: string, path: string, serverUrl?: string }`

**Response:** `Project`

#### `GET /api/projects/[id]`

Get a single project.

**Response:** `Project`

#### `PATCH /api/projects/[id]`

Update a project.

**Body:** Partial `Project` fields (`name`, `path`, `serverUrl`, `status`, `order`, `activeTab`, `liveViewport`)

**Response:** `Project`

#### `DELETE /api/projects/[id]`

Delete a project and its state file.

### Tasks

#### `GET /api/projects/[id]/tasks`

List tasks grouped by column.

**Response:** `{ todo: Task[], "in-progress": Task[], verify: Task[], done: Task[] }`

#### `POST /api/projects/[id]/tasks`

Create a task.

**Body:** `{ title?: string, description: string, priority?: "low" | "medium" | "high", mode?: "build" | "plan" | "answer", status?: TaskStatus, attachments?: TaskAttachment[] }`

**Response:** `Task`

Setting `status: "in-progress"` dispatches the task immediately.

#### `PATCH /api/projects/[id]/tasks/[taskId]`

Update a task. Status changes trigger dispatch/abort side effects.

**Body:** Partial `Task` fields. Key fields: `status`, `dispatch`, `title`, `description`, `findings`, `humanSteps`, `priority`, `mode`, `renderMode`, `attachments`

**Response:** `Task`

#### `DELETE /api/projects/[id]/tasks/[taskId]`

Delete a task. Aborts agent and removes worktree if applicable.

#### `PUT /api/projects/[id]/tasks/reorder`

Bulk reorder tasks across columns. Used by drag-drop. Also triggers dispatch/abort on status changes.

**Body:** `{ columns: Record<TaskStatus, { id: string }[]> }`

### Git

#### `GET /api/projects/[id]/git`

Get branch state.

**Response:** `{ current: string, detached: boolean, branches: string[] }`

#### `POST /api/projects/[id]/git`

Switch branch.

**Body:** `{ branch: string }`

#### `PATCH /api/projects/[id]/git`

Refresh preview branch (fast-forward from source).

### Chat

#### `GET /api/projects/[id]/chat`

Get chat log.

**Response:** `ChatLogEntry[]`

#### `POST /api/projects/[id]/chat`

Add a chat message.

**Body:** `{ role: "proq" | "user", message: string }`

### Cross-Project

#### `GET /api/agent/tasks`

Get all currently in-progress tasks across all projects.
