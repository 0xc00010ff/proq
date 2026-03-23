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
│       │ REST + SSE                       WebSocket      │
└───────┼──────────────────────────────────────┼──────────┘
        │                                      │
┌───────┴──────────────────────────────────────┴──────────┐
│  Next.js Server (:1337)         WS Hub (configurable)   │
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
│  │          │   │  │Session │ │(bridge)│    │           │
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

**Next.js server** handles the REST API, serves the React SPA, and runs the dispatch engine. **Agent processes** are spawned per-task — either as child processes (structured mode) or as detached bridge processes (CLI mode). **WebSocket hub** on a configurable port (production: 42067, dev: 42069) streams agent output, terminal PTY data, supervisor messages, and agent tab sessions. **lowdb** stores all state as JSON files — no external database.

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
  pathValid?: boolean;      // whether the project path exists on disk
  activeTab?: 'project' | 'live' | 'code';
  viewType?: 'kanban' | 'list' | 'grid';
  liveViewport?: 'desktop' | 'tablet' | 'mobile';
  defaultBranch?: string;   // e.g. 'main' or 'master'
  systemPrompt?: string;    // project-level system prompt for agents
  createdAt: string;
}
```

### `data/projects/{id}.json`

Per-project state file containing:

```typescript
interface ProjectState {
  tasks: TaskColumns;  // Record<TaskStatus, Task[]> — todo, in-progress, verify, done
  chatLog: ChatLogEntry[];
  agentSession?: AgentSession;
  executionMode?: 'sequential' | 'parallel' | 'worktrees';
  cronJobs?: CronJob[];
  projectWorkbenchOpen?: boolean;
  projectWorkbenchHeight?: number;
  projectWorkbenchTabs?: WorkbenchTabInfo[];
  projectWorkbenchActiveTabId?: string;
  liveWorkbenchTabs?: WorkbenchTabInfo[];
  liveWorkbenchActiveTabId?: string;
  projectWorkbenchSessions?: Record<string, WorkbenchSessionData>;
  recentlyDeleted?: DeletedTaskEntry[];
}
```

Tasks are stored in ordered arrays within each column — array position is the sort order.

## Task Lifecycle

```
todo ────────→ in-progress ────────→ verify ────────→ done
               agentStatus: "queued"             │         │
               agentStatus: "starting"           │         │ merge branch
               agentStatus: "running"            │         │ into main
                                                 │         │ (worktrees)
               ◄── abort (back to todo) ─────────┘         │
                                                           │
               ◄── reject (back to todo) ──────────────────┘
```

### Agent Status Sub-States

When a task moves to in-progress, it enters the dispatch pipeline:

1. **queued** — waiting for its turn (sequential) or for processQueue to run (parallel)
2. **starting** — selected by processQueue, agent process is launching
3. **running** — agent is actively working (child process or detached bridge process running)
4. **null** — not dispatched (task is in todo, verify, or done)

### Side Effects Per Transition

| Transition | What happens |
|---|---|
| → in-progress | Set `agentStatus: "queued"`, call `processQueue()` |
| in-progress → verify | Keep worktree alive (worktrees mode). Send notification |
| in-progress → todo | Abort agent. Remove worktree/branch (worktrees mode). Clear agentStatus/summary |
| in-progress → done | Merge branch into main (worktrees mode). Remove worktree. Send notification |
| verify → done | Merge branch into main (worktrees mode). Remove worktree. On conflict, stay in verify |
| verify → todo | Remove worktree/branch (worktrees mode). Discard work |

All API routes follow the same pattern: **update state → call `processQueue()`**.

### `processQueue()`

The orchestrator. Called after any state change. Has a re-entrancy guard per project to prevent double-dispatching.

- **Sequential mode**: launches the first queued task if nothing is running. Runs in the project directory.
- **Parallel mode**: launches all queued tasks simultaneously. All run in the project directory (same branch).
- **Worktrees mode**: launches all queued tasks simultaneously. Each gets its own git worktree + branch (`proq/{shortId}`) for full isolation.

## Agent Dispatch

`dispatchTask()` in `agent-dispatch.ts` handles the full launch sequence:

1. **Write MCP config** — creates a temp JSON file pointing to `proq-mcp-task.js` with the project/task IDs
2. **Build system prompt** — mode-aware instructions with flexible guidance that allows mode transitions
3. **Write image attachments** — base64 data URLs decoded to temp files the agent can read
4. **Create worktree** (worktrees mode, build tasks only) — isolated git worktree at `.proq-worktrees/{shortId}/`
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

Launches a detached bridge process:

```
spawn('node', [proq-bridge.js, socketPath, launcherScript], {
  cwd: projectPath, detached: true, stdio: 'ignore'
})
```

The bridge (`proq-bridge.js`) spawns the Claude CLI in a real PTY via node-pty, exposes a unix socket at `/tmp/proq/proq-{shortId}.sock`, and maintains a 50KB scrollback ring buffer. PID files in `/tmp/proq/` track process lifecycle. Clients connect to the socket to stream terminal output. Reconnection replays the scrollback.

The detached process survives server restarts. Lifecycle is managed via PID files — `process.kill(-pid, 'SIGTERM')` to kill the process group, `process.kill(pid, 0)` to check liveness.

## MCP Callback

`proq-mcp-task.js` is a task-scoped stdio MCP server spawned per-task via `--mcp-config`. It exposes four tools:

| Tool | Description |
|---|---|
| `read_task` | Fetch current task state (title, description, summary, status). Agent uses this before updating to build cumulative summary |
| `update_task` | Set summary + optional nextSteps, move task to Verify. Each call replaces the previous summary |
| `commit_changes` | Stage and commit all current changes. Used after each logical unit of work to keep progress saved |
| `create_task` | Create a follow-up task in the same project for work outside the agent's current scope |

The MCP server communicates with the proq REST API over localhost.

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
- Session survives server restarts (detached process with PID file tracking)

## WebSocket Protocol

Central hub on a configurable port (production: 42067, dev: 42069) via `ws-server.ts`. Routes by pathname:

| Path | Purpose | Protocol |
|---|---|---|
| `/ws/agent?taskId=X&projectId=Y` | Task agent sessions | Server sends `replay` (all blocks) + `block` (new). Client sends `followup` or `stop` |
| `/ws/terminal?id=X&cwd=Y` | Shell PTY sessions | Bidirectional raw terminal data. JSON `{ type: "resize", cols, rows }` for resize |
| `/ws/supervisor` | Supervisor session | Same block protocol as agent. Client sends `{ type: "message", text }` or `{ type: "stop" }` |
| `/ws/agent-tab?tabId=X&projectId=Y` | Workbench agent tabs | Same block protocol as agent |

### Agent/Supervisor Message Flow

**Server → Client:**
- `{ type: "replay", blocks: AgentBlock[], active: boolean }` — full history on connect
- `{ type: "block", block: AgentBlock, active: boolean }` — new block appended
- `{ type: "active", active: boolean }` — active state change (no new block)
- `{ type: "stream_delta", text: string }` — incremental text during streaming
- `{ type: "error", error: string }` — error message

**Client → Server:**
- `{ type: "followup", text: string, attachments?: [] }` — send follow-up message
- `{ type: "plan-approve", text: string }` — approve a plan-mode proposal
- `{ type: "stop" }` — abort the running session
- `{ type: "clear" }` — clear session history

### Agent Session State

The server sends `active: boolean` with every WS message. The client combines three signals for resilient state tracking:

1. **WS `active` flag** — real-time process liveness from the server
2. **SSE `agentStatus`** — task-level status from the REST layer (`queued`, `starting`, `running`, null)
3. **Block-level session status** — derived from the last block (`status/complete`, `status/error`, `status/abort`)

`sessionEnded` = last block is a terminal status (complete, error, or abort). `isRunning` = !sessionEnded && (active || agentStatus is running/starting).

## Supervisor

A persistent Claude Code instance accessible at `/supervisor`. Unlike task agents, the supervisor:

- Runs in proq's own codebase directory
- Has a system prompt with all loaded projects and the full REST API reference
- Can create, update, move, and delete tasks across any project
- Maintains conversation history across page reloads (persisted to DB)
- Uses the same structured block rendering as task agents

The supervisor session is a singleton on `globalThis` (survives HMR). Conversation history is stored via `setSupervisorAgentBlocks()` and restored on reconnect.

## Desktop Shell

The optional Electron desktop app (`desktop/`) is a thin process manager that wraps the web UI. It does **not** embed or modify the Next.js server — it spawns it as a child process using the system's Node.js runtime.

```
Electron App
  ├── Setup Wizard (first run) → clones repo, checks deps, npm install + build
  ├── Splash Screen → starts server, polls until ready
  └── BrowserWindow → loads localhost:{port}
```

Key design: the server runs via `npm run start` (or `dev`), not inside Electron's Node. This avoids native module (node-pty) rebuild issues entirely. Config is stored separately in the OS app data directory (`~/Library/Application Support/proq-desktop/config.json` on macOS).

### Updates

Two independent update paths:

- **Web content** — `git pull --rebase origin main` + `npm install` + `npm run build`. Runs automatically on launch (behind splash screen) and checked hourly in the background. Controlled by `updater.ts` (git ops) and `update-scheduler.ts` (hourly timer).
- **Shell** — `electron-updater` checks GitHub Releases for a newer `.app` version. Managed by `shell-updater.ts`. Downloads in the background, prompts user to restart via Settings.

All update logic is gated by `isDevMode()` (from `config.ts`), which checks `process.env.PROQ_DEV` or `config.devMode`. When either is true, no updates run.

### Versioning

- Patch bumps (0.5.0 → 0.5.1) — web content releases. Tag on main, no build artifact. Users receive via git pull on next launch.
- Minor bumps (0.5.x → 0.6.0) — shell releases. Tag + Electron build + GitHub Release. Users receive via `electron-updater`.

For full details, see the [desktop README](../desktop/README.md).

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

### Agent

| Field | Type | Default | Description |
|---|---|---|---|
| `claudeBin` | string | `"claude"` | Path to Claude Code binary |
| `defaultModel` | string | `""` | Model to use (e.g. `claude-sonnet-4-20250514`) |
| `systemPromptAdditions` | string | `""` | Extra instructions appended to every agent's system prompt |
| `executionMode` | `"sequential"` \| `"parallel"` \| `"worktrees"` | `"sequential"` | `sequential`: one task at a time. `parallel`: all queued tasks simultaneously (same branch). `worktrees`: all queued tasks simultaneously (isolated git worktrees) |
| `agentRenderMode` | `"structured"` \| `"cli"` | `"structured"` | Default render mode for new tasks |
| `showCosts` | boolean | `false` | Show cost estimates in agent UI |
| `codingAgent` | string | `""` | Custom coding agent binary (replaces Claude CLI entirely for build-mode tasks) |

### Updates

| Field | Type | Default | Description |
|---|---|---|---|
| `autoUpdate` | boolean | `false` | Automatically check for and apply updates |

### Appearance

| Field | Type | Default | Description |
|---|---|---|---|
| `theme` | `"dark"` \| `"light"` \| `"system"` | `"dark"` | UI theme |

### Notifications

| Field | Type | Default | Description |
|---|---|---|---|
| `soundNotifications` | boolean | `false` | Play sound on task completion |
| `localNotifications` | boolean | `false` | Show desktop notifications on task completion |
| `webhooks` | string[] | `[]` | Webhook URLs to POST on task completion |

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

**Body:** `{ title?: string, description: string, priority?: "low" | "medium" | "high", mode?: "auto" | "build" | "plan" | "answer", status?: TaskStatus, attachments?: TaskAttachment[] }`

**Response:** `Task`

Setting `status: "in-progress"` dispatches the task immediately.

#### `PATCH /api/projects/[id]/tasks/[taskId]`

Update a task. Status changes trigger dispatch/abort side effects.

**Body:** Partial `Task` fields. Key fields: `status`, `agentStatus`, `title`, `description`, `summary`, `nextSteps`, `priority`, `mode`, `renderMode`, `attachments`

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

### Additional Project Endpoints

| Endpoint | Description |
|---|---|
| `POST /api/projects/reorder` | Reorder projects in the sidebar |
| `POST /api/projects/[id]/rename` | Rename a project |
| `POST /api/projects/[id]/reveal` | Reveal project folder in Finder/file manager |
| `PATCH /api/projects/[id]/execution-mode` | Set execution mode for a project |
| `GET /api/projects/[id]/events` | SSE stream for task status updates |

### Additional Task Endpoints

| Endpoint | Description |
|---|---|
| `POST /api/projects/[id]/tasks/[taskId]/dispatch` | Manually dispatch a task |
| `POST /api/projects/[id]/tasks/[taskId]/resolve` | Resolve a merge conflict |
| `POST /api/projects/[id]/tasks/[taskId]/auto-title` | Generate title from task description |
| `GET /api/projects/[id]/tasks/[taskId]/agent-blocks` | Get agent session blocks |
| `POST /api/projects/[id]/tasks/undo` | Undo task deletion |

### Cron Jobs

| Endpoint | Description |
|---|---|
| `GET /api/projects/[id]/crons` | List cron jobs for a project |
| `POST /api/projects/[id]/crons` | Create a cron job |
| `PATCH /api/projects/[id]/crons/[cronId]` | Update a cron job |
| `DELETE /api/projects/[id]/crons/[cronId]` | Delete a cron job |
| `POST /api/projects/[id]/crons/[cronId]/trigger` | Manually trigger a cron job |

### Workbench

| Endpoint | Description |
|---|---|
| `GET /api/projects/[id]/workbench-state` | Get workbench panel state |
| `PATCH /api/projects/[id]/workbench-state` | Update workbench panel state |
| `GET /api/projects/[id]/workbench-tabs` | List workbench tabs |
| `POST /api/projects/[id]/workbench-tabs` | Create a workbench tab |
| `DELETE /api/projects/[id]/workbench-tabs` | Delete a workbench tab |

### Settings

| Endpoint | Description |
|---|---|
| `GET /api/settings` | Read all settings |
| `PATCH /api/settings` | Update settings |
| `POST /api/settings/detect-claude-bin` | Auto-detect Claude binary path |

### Cross-Project & Global

| Endpoint | Description |
|---|---|
| `GET /api/agent/tasks` | Get all in-progress tasks across all projects |
| `GET /api/agent-tab/[tabId]` | Get workbench agent tab session |
| `POST /api/agent-tab/[tabId]` | Create/interact with agent tab session |
| `DELETE /api/agent-tab/[tabId]` | Delete agent tab session |
| `GET /api/supervisor` | Get supervisor session |
| `POST /api/supervisor` | Interact with supervisor session |

### File & Shell Operations

| Endpoint | Description |
|---|---|
| `GET /api/files/read` | Read file contents |
| `POST /api/files/write` | Write file contents |
| `GET /api/files/tree` | Get directory tree |
| `POST /api/files/open` | Open file in system editor |
| `POST /api/shell/spawn` | Create a shell session |
| `GET /api/shell/[tabId]` | Get shell session info |
| `DELETE /api/shell/[tabId]` | Terminate shell session |
| `POST /api/upload` | Upload files |
| `GET /api/attachments/[...path]` | Serve uploaded files |
| `POST /api/folder-picker` | Open folder selection dialog |
