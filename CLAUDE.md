# proq — Claude Code Guide

## What This Is

proq is the command center for AI-assisted development. It's a Next.js kanban board (localhost:1337) that manages tasks across multiple coding projects. When a task moves to "In Progress", proq automatically launches a Claude Code agent to work on it autonomously.

**The loop:**

1. Create tasks on the board (manually or via any chat agent that talks to the API)
2. Task dragged/moved to "In Progress" → launches a Claude Code agent against that project's codebase
3. Agent works autonomously, commits, then reports back via MCP tools to move itself to "Verify"
4. Human reviews. Done or back to Todo.

**Who's who:**

- **Supervisor** — An AI assistant that creates/dispatches tasks conversationally via a dedicated WebSocket session
- **Claude Code agents** — Worker instances launched per-task, communicating via structured block streams over WebSocket

**Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, @dnd-kit, uuid

## Quick Start

```bash
npm run dev    # Start dev server (localhost:1337)
npm run build  # Production build
npm run lint   # ESLint
```

## Architecture

### Directory Structure

```
src/
├── app/
│   ├── api/projects/           # REST API routes
│   │   ├── route.ts            # GET/POST projects
│   │   ├── reorder/            # PUT reorder projects
│   │   └── [id]/
│   │       ├── route.ts        # GET/PATCH/DELETE project
│   │       ├── rename/         # POST rename project
│   │       ├── reveal/         # POST reveal in Finder
│   │       ├── execution-mode/ # PATCH execution mode
│   │       ├── events/         # GET SSE task events
│   │       ├── tasks/          # GET/POST tasks
│   │       │   ├── [taskId]/   # PATCH/DELETE task
│   │       │   │   ├── dispatch/     # POST dispatch task
│   │       │   │   ├── resolve/      # POST resolve merge conflict
│   │       │   │   ├── auto-title/   # POST generate title
│   │       │   │   └── agent-blocks/ # GET agent session blocks
│   │       │   ├── reorder/    # PUT bulk reorder
│   │       │   └── undo/       # POST undo delete
│   │       ├── crons/          # GET/POST cron jobs
│   │       │   └── [cronId]/   # PATCH/DELETE cron job
│   │       │       └── trigger/ # POST trigger cron manually
│   │       ├── git/            # GET/POST/PATCH branch state
│   │       ├── chat/           # GET/POST chat messages
│   │       ├── workbench-state/ # GET/PATCH workbench panel state
│   │       └── workbench-tabs/  # GET/POST/DELETE workbench tabs
│   ├── api/settings/           # GET/PATCH settings
│   │   └── detect-claude-bin/  # POST auto-detect claude binary
│   ├── api/agent/tasks/        # GET cross-project in-progress tasks
│   ├── api/agent-tab/[tabId]/  # GET/POST/DELETE agent tab sessions
│   ├── api/supervisor/         # GET/POST supervisor session
│   ├── api/files/              # read, write, tree, open
│   ├── api/shell/              # spawn, [tabId], upload
│   ├── api/upload/             # POST file uploads
│   ├── api/attachments/[...path]/ # GET serve uploaded files
│   ├── api/folder-picker/      # POST folder selection dialog
│   ├── globals.css             # CSS variables, theming
│   ├── layout.tsx              # Root layout (force-dynamic for runtime env)
│   └── page.tsx                # Main dashboard
├── components/
│   ├── blocks/                 # Agent block renderers (TextBlock, ThinkingBlock, ToolBlock, etc.)
│   ├── ui/                     # shadcn/ui primitives
│   ├── Sidebar.tsx             # Project list with status indicators
│   ├── TopBar.tsx              # Project header + main view selector (Agents / Project / Live / Code) + branch selector
│   ├── KanbanBoard.tsx         # Drag-drop board (@dnd-kit) — the "Project" view
│   ├── TaskCard.tsx            # Task display (shows status indicators)
│   ├── TaskModal.tsx           # Task create/edit modal
│   ├── TaskAgentModal.tsx      # Full agent session viewer
│   ├── StructuredPane.tsx      # Agent block stream rendering
│   ├── ChatPanel.tsx           # Terminal-style chat interface
│   ├── LiveTab.tsx             # Iframe dev server preview — the "Live" view
│   ├── CodeTab.tsx             # Monaco code editor — the "Code" view
│   ├── AgentsView.tsx          # Agent editor — the "Agents" view (manage named per-project agents)
│   └── AgentsCanvas.tsx        # Canvas surface used by AgentsView for arranging/editing agent cards
├── hooks/
│   ├── useAgentSession.ts      # WebSocket hook for task agent sessions
│   ├── useAgentTabSession.ts   # WebSocket hook for workbench agent tabs
│   ├── useSupervisorSession.ts # WebSocket hook for supervisor
│   ├── useStreamingBuffer.ts   # RAF-based text streaming buffer
│   ├── useTaskEvents.ts        # SSE hook for task status updates
│   └── ...                     # useClickOutside, useEscapeKey, useShortcut, etc.
└── lib/
    ├── agent-dispatch.ts       # Agent launch + abort + processQueue + system prompts + MCP config
    ├── agent-session.ts        # Structured agent session (child process, block parsing, WS broadcast)
    ├── agent-session-server.ts # WS handler for /ws/agent (connect, replay, followup, stop)
    ├── agent-tab-runtime.ts    # Workbench agent tab session management
    ├── agent-tab-server.ts     # WS handler for /ws/agent-tab
    ├── supervisor-runtime.ts   # Supervisor session management
    ├── supervisor-server.ts    # WS handler for /ws/supervisor
    ├── task-lifecycle.ts       # Task deletion + done merge logic
    ├── task-events.ts          # SSE event bus for server-initiated task updates
    ├── claude-bin.ts           # Claude CLI binary detection + caching
    ├── cron-scheduler.ts       # Cron job scheduling engine
    ├── worktree.ts             # Git worktree + branch operations
    ├── db.ts                   # JSON file storage with per-resource write locks
    ├── proq-mcp-task.js        # Task-scoped MCP server (read_task, update_task, commit_changes, create_task)
    ├── proq-mcp-project.js     # Project-scoped MCP server for workbench agents
    ├── proq-bridge.js          # PTY bridge for CLI mode (unix socket + scrollback)
    ├── pty-server.ts           # Terminal PTY management for workbench shells
    ├── ws-server.ts            # WebSocket hub (agent, terminal, supervisor, agent-tab)
    ├── types.ts                # All TypeScript interfaces
    └── utils.ts                # cn() utility + path helpers
```

### Agent Dispatch System (`src/lib/agent-dispatch.ts`)

Centralized via `processQueue(projectId)` — the single source of truth for what should be running. Called after any state change. Has a re-entrancy guard per project.

- **Sequential mode:** dispatches first queued task if nothing is running
- **Parallel/worktrees mode:** dispatches all queued tasks immediately

Key functions:

- `processQueue()` — reads all tasks, dispatches queued ones per mode
- `dispatchTask()` — launches an agent process with the task prompt
- `abortTask()` — kills the agent process and cleans up
- `isSessionAlive()` — checks if an agent process is alive for a task

**Launch:** Spawns a Claude CLI child process with MCP tools (`proq-mcp-task.js`) for the agent to report status, commit changes, and create follow-up tasks.

**Callback:** Agent reports back via MCP tools (e.g., `update_task` to move to verify, `commit_changes` to commit work).

### Agent Session & WebSocket Protocol

Agent sessions (`agent-session.ts`) parse Claude CLI output into structured blocks (text, thinking, tool use/result) and broadcast them over WebSocket.

**WS protocol (agent sessions):**
- Server → Client: `replay` (blocks + active), `block` (block + active), `active` (active boolean), `stream_delta` (text), `error`
- Client → Server: `followup` (text + attachments), `plan-approve` (text), `stop`, `clear`

**Client rendering signals:**
- `sessionEnded`: last block is status/complete, error, or abort → agent is definitely done
- `isRunning`: `!sessionEnded && (active || agentStatus === 'running')`
- `isThinking`: `isRunning && !streamingText && blocks.length > 0`

### Task Lifecycle & Dispatch

```
todo ──drag/API──→ in-progress ──agent callback──→ verify ──human──→ done
                   agentStatus: "queued"                │                │
                   agentStatus: "running"               │ branch stays   │ merge branch
                                                        │ for preview    │ into default
```

- `agentStatus: "queued"` — task is waiting to be (or be re-)dispatched. processQueue picks the first one when a slot opens.
- `agentStatus: "running"` — an agent process is live for this task. `processQueue` uses `isSessionAlive(taskId)` as the source of truth for "running", not this field, so it's immune to DB-write ordering.
- `agentStatus: null` — agent isn't active: task is in verify/done, or the CLI bridge exited and the human hasn't moved the task yet.
- Running tasks show a bronze pulsing border; queued tasks show a clock icon
- Dragging back to "Todo" aborts the agent (kills the process), then `processQueue()` starts the next queued task
- All API routes follow the pattern: update state → call `processQueue()`
- Task modes: `auto` (default), `build`, `plan`, `answer` — control agent behavior

### Branch Preview & Deferred Merge (Worktrees Mode)

In worktrees mode, each task gets its own git worktree + branch (`proq/{shortId}`). The merge into the default branch is **deferred** until the task is marked "done", allowing the user to preview changes first.

- **in-progress → verify**: Worktree stays alive. Branch is available for preview via the TopBar branch switcher.
- **verify → done**: Checkout default branch → merge branch → remove worktree. On conflict, task stays in verify.
- **TopBar branch selector**: Shows all local git branches. `proq/*` branches are annotated with their task title.
- **Preview flow**: User clicks "Preview" in TaskAgentModal → creates a `proq-preview/{shortId}` branch at the same commit as `proq/{shortId}` → checks it out normally → dev server hot-reloads. Polling fast-forwards the preview branch every 5s to pick up new agent commits.
- **Preview branches**: `proq-preview/*` branches are disposable — automatically created on preview, deleted when switching away. The git API filters them from the branch list and reports the source `proq/*` as the current branch instead.
- **Auto-stash**: If user has uncommitted changes, they're auto-stashed before branch switch and popped when returning.

### Cron Jobs

Tasks can be created on a schedule via cron jobs. Cron definitions live in shared `project.json`; activation state is per-user in `workspace.json`. Crons are **off by default** — each user opts in to run them on their machine.

- **CronJobDefinition** (project.json): `{ id, name, prompt, defaultSchedule, mode, agentId, createdAt }`
- **ActiveCronState** (workspace.json `activeCrons` map): `{ schedule?, lastRunAt?, lastTaskId?, nextRunAt?, runCount? }`
- **CronJob** (composed): merges definition + activation. `enabled` = presence in `activeCrons`. `schedule` = user override or `defaultSchedule`.
- Tasks created by crons have a `cronJobId` linking back to the source cron
- The cron scheduler runs in-process (`cron-scheduler.ts`)

### Data Layer

- **`data/workspace.json`** — Project registry (stubs with id, name, path)
- **`data/settings.json`** — Global settings (claude binary path, model, theme, etc.)
- **`data/projects/{id}/project.json`** — Shared project config (systemPrompt, defaultBranch, cron definitions). Git-trackable in `.proq/` mode.
- **`data/projects/{id}/workspace.json`** — Per-user state (tasks, chat, UI, executionMode, serverUrl, defaultAgentId, cron activations)
- **`data/projects/{id}/agents/`** — Agent definitions (individual JSON files)
- **`data/` is gitignored** — Each user has their own local state, auto-created on first run
- Database: Custom JSON file storage (readFileSync/writeFileSync with per-resource write locks)

### Key Types (src/lib/types.ts)

- **Project**: `{ id, name, path, status, serverUrl, order, pathValid, activeTab, viewType, liveViewport, defaultBranch, systemPrompt, createdAt }`
- **Task**: `{ id, title, description, status, priority, mode, summary, nextSteps, needsAttention, agentLog, agentStatus, worktreePath, branch, baseBranch, mergeConflict, startCommit, commitHashes, renderMode, agentBlocks, sessionId, attachments, cronJobId, createdAt, updatedAt }`
- **ProjectConfig**: `{ systemPrompt, defaultBranch, cronJobs[] }` — shared project config in `project.json`
- **CronJobDefinition**: `{ id, name, prompt, defaultSchedule, mode, agentId, createdAt }` — shared cron definition
- **CronJob**: `{ ...CronJobDefinition, schedule, enabled, lastRunAt, lastTaskId, nextRunAt, runCount }` — composed from definition + user activation
- **ProqSettings**: `{ claudeBin, defaultModel, systemPromptAdditions, executionMode, agentRenderMode, showCosts, codingAgent, autoUpdate, theme, soundNotifications, localNotifications, webhooks }`
- Task statuses: `todo` → `in-progress` → `verify` → `done`
- Task modes: `auto` | `build` | `plan` | `answer`
- Execution modes: `sequential` | `parallel` | `worktrees`
- View types: `kanban` | `list` | `grid`

### Frontend Data Flow

- Fetch all projects on mount, then tasks for each project
- **Optimistic UI**: User actions (drag, delete, create, start) update local state instantly via `setTasksByProject`. API calls fire in the background — the UI doesn't wait for responses
- **Targeted SSE**: Server pushes `{taskId, changes}` over SSE only for server-initiated changes (agentStatus transitions, agent completion). Client merges the fields directly into local state — no fetch, no race
- **30s fallback poll**: Catches anything SSE misses (supervisor creates tasks, branch state, execution mode)
- Chat loaded on project switch
- `taskBranchMap` built from tasks with `branch` field, passed to TopBar for branch annotation

## Conventions

### Code Style

- Components: PascalCase filenames matching component name
- Props: `{ComponentName}Props` interfaces
- State: All dashboard state managed in `page.tsx` via useState
- Event handlers: `handle{Action}` naming
- All interactive components use `'use client'` directive

### Styling

- Theme: dark/light/system (class-based)
- Zinc color palette (zinc-800/900/950 backgrounds in dark mode)
- Accent: blue-400 (active), green-400 (success), red-400 (error)
- CSS variables for theming in globals.css
- Utility-first Tailwind, minimal custom CSS

### Agent Integration

Tasks have fields specifically for AI agent use:

- `summary` — Agent's cumulative work summary (newline-separated)
- `nextSteps` — Suggested next steps: testing, refinements, or follow-up work (newline-separated)
- `needsAttention` — Flag for tasks requiring human attention
- `agentLog` — Execution log from agent session
- `agentStatus` — Enum: `"queued"` | `"running"` | null (agent lifecycle)
- `agentBlocks` — Structured block data from agent session
- `sessionId` — Links to the agent session for WebSocket replay
- `worktreePath` — Path to git worktree (worktrees mode)
- `branch` — Git branch name, e.g. `proq/abc12345` (worktrees mode)
- `baseBranch` — Branch the task was started from
- `mergeConflict` — `{ error, files, branch }` if merge failed
- `commitHashes` — Array of commit SHAs made by the agent

## Development & Release

- **Branching**: daily work on `develop`, merge to `main` via PR for releases
- **Dev mode**: `npm run dev` sets `PROQ_DEV=1` — disables all update checks (web + shell)
- **`isDevMode()`** in `desktop/src/main/config.ts` — checks `PROQ_DEV` env or `config.devMode`; gates all update logic
- **Deploy (web)**: `npm run deploy` — patch bump, build, merge develop → main, tag, push, create GitHub Release
- **Deploy (desktop)**: `npm run deploy -- --desktop` — minor bump, build web + desktop, merge develop → main, tag, push, publish GitHub Release with .dmg
- **Updates on launch**: `showSplashAndStartServer()` checks for web updates behind the splash screen before starting the server
- **Shell updates**: `electron-updater` checks GitHub Releases for newer `.app` versions (`desktop/src/main/shell-updater.ts`)
- **`force-dynamic`** on root layout ensures runtime env vars (WS port) work in production

## Important Notes

- Path alias: `@/*` maps to `./src/*`
- `design-mock/` is a separate Vite prototype — not part of the main app
- The app runs on port 1337 by default
- Optional Slack notifications via OpenClaw CLI — set `OPENCLAW_BIN` and `SLACK_CHANNEL` in `.env.local`
