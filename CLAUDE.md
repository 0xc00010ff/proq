# proq — Claude Code Guide

## What This Is

proq is the command center for AI-assisted development. It's a Next.js kanban board (localhost:1337) that manages tasks across multiple coding projects. When a task moves to "In Progress", proq automatically launches a Claude Code agent to work on it autonomously.

**The loop:**

1. Create tasks on the board (manually or via any chat agent that talks to the API)
2. Task dragged/moved to "In Progress" → launches a Claude Code agent against that project's codebase
3. Agent works autonomously, commits, then curls back to the API to move itself to "Verify"
4. Human reviews. Done or back to Todo.

**Who's who:**

- **Supervisor** — An AI assistant that creates/dispatches tasks via the API conversationally (e.g., via OpenClaw or any chat agent)
- **Claude Code agents** — Disposable worker instances launched per-task

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
│   │   └── [id]/
│   │       ├── route.ts        # GET/PATCH/DELETE project
│   │       ├── tasks/          # GET/POST tasks, PATCH/DELETE [taskId]
│   │       │   └── reorder/    # PUT bulk reorder (handles drag-drop status changes)
│   │       ├── git/            # GET/POST/PATCH branch state
│   │       └── chat/           # GET/POST chat messages
│   ├── globals.css             # CSS variables, dark theme, custom scrollbars
│   ├── layout.tsx              # Root layout (dark mode, Geist fonts)
│   └── page.tsx                # Main dashboard (all client state lives here)
├── components/
│   ├── Sidebar.tsx             # Project list with status indicators
│   ├── TopBar.tsx              # Project header + tab switcher + branch selector
│   ├── KanbanBoard.tsx         # 4-column drag-drop board (@dnd-kit)
│   ├── TaskCard.tsx            # Individual task display (shows spinner when running)
│   ├── TaskModal.tsx           # Unified task create/edit modal
│   ├── ChatPanel.tsx           # Terminal-style chat interface
│   ├── LiveTab.tsx             # Iframe dev server preview
│   └── CodeTab.tsx             # Code editor launcher
└── lib/
    ├── agent-dispatch.ts       # agent launch + abort + processQueue + optional notifications
    ├── agent-session.ts        # Structured agent session management (child process)
    ├── task-events.ts          # SSE event bus for server-initiated task updates
    ├── worktree.ts             # Git worktree + branch operations (create/remove/merge/checkout)
    ├── db.ts                   # JSON file storage with per-resource write locks
    ├── types.ts                # All TypeScript interfaces
    └── utils.ts                # cn() utility (clsx + tailwind-merge)
```

### Agent Dispatch System (`src/lib/agent-dispatch.ts`)

Centralized via `processQueue(projectId)` — the single source of truth for what should be running. Called after any state change. Has a re-entrancy guard per project.

- **Sequential mode:** dispatches first queued task if nothing is running
- **Parallel mode:** dispatches all queued tasks immediately

Key functions:

- `processQueue()` — reads all tasks, dispatches queued ones per mode
- `dispatchTask()` — launches an agent process with the task prompt
- `abortTask()` — kills the agent process and cleans up socket/log files
- `isSessionAlive()` — checks if an agent process is alive for a task
- `scheduleCleanup()` — deferred cleanup (1hr) to capture agent logs after completion

**Launch:** Spawns a detached bridge process (`proq-bridge.js`) that exposes the agent's PTY over a unix socket. PID files in `/tmp/proq/` track process lifecycle.

**Callback:** Agent reports back via MCP tools:

```bash
curl -s -X PATCH http://localhost:1337/api/projects/{projectId}/tasks/{taskId} \
  -H 'Content-Type: application/json' \
  -d '{"status":"verify","agentStatus":null}'
```

### Task Lifecycle & Dispatch

```
todo ──drag/API──→ in-progress ──agent callback──→ verify ──human──→ done
                   agentStatus: "queued"                │                │
                   agentStatus: "starting"              │ branch stays   │ merge branch
                   agentStatus: "running"               │ for preview    │ into main
```

- `agentStatus: "queued"` — waiting for another task or for processQueue to pick it up
- `agentStatus: "starting"` — processQueue selected it, agent process is launching
- `agentStatus: "running"` — agent is actively working
- Running tasks show blue pulsing border; starting tasks show gray spinner; queued tasks show clock icon
- Dragging back to "Todo" aborts the agent (kills the process), then `processQueue()` starts the next queued task
- All API routes follow the pattern: update state → call `processQueue()`

### Branch Preview & Deferred Merge (Parallel Mode)

In parallel mode, each task gets its own git worktree + branch (`proq/{shortId}`). The merge into main is **deferred** until the task is marked "done", allowing the user to preview changes first.

- **in-progress → verify**: Worktree stays alive. Branch is available for preview via the TopBar branch switcher.
- **verify → done**: Checkout main → merge branch → remove worktree. On conflict, task stays in verify.
- **TopBar branch selector**: Shows all local git branches. `proq/*` branches are annotated with their task title. Works in both sequential and parallel modes.
- **Preview flow**: User clicks "Preview" in TaskAgentModal → creates a `proq-preview/{shortId}` branch at the same commit as `proq/{shortId}` → checks it out normally → dev server hot-reloads. Polling fast-forwards the preview branch every 5s to pick up new agent commits.
- **Preview branches**: `proq-preview/*` branches are disposable — automatically created on preview, deleted when switching away. The git API filters them from the branch list and reports the source `proq/*` as the current branch instead.
- **Auto-stash**: If user has uncommitted changes on main, they're auto-stashed before branch switch and popped when returning.

### Data Layer

- **`data/workspace.json`** — Project registry (id, name, path, status, serverUrl)
- **`data/projects/{id}.json`** — Per-project state (tasks array + chatLog array)
- **`data/` is gitignored** — Each user has their own local state, auto-created on first run
- Database: Custom JSON file storage (readFileSync/writeFileSync with per-resource write locks)
- Auto-migration: old `config.json` / `state/` are renamed on startup

### Key Types (src/lib/types.ts)

- **Project**: `{ id, name, path, status, serverUrl, createdAt }`
- **Task**: `{ id, title, description, status, priority, order, summary, nextSteps, agentLog, agentStatus, attachments, createdAt, updatedAt }`
- **ChatLogEntry**: `{ role: 'proq'|'user', message, timestamp, toolCalls? }`
- Task statuses: `todo` → `in-progress` → `verify` → `done`
- Project statuses: `active`, `review`, `idle`, `error`

### API Routes

```
GET/POST       /api/projects                          # List or create projects
GET/PATCH/DEL  /api/projects/[id]                     # Single project CRUD
GET/POST       /api/projects/[id]/tasks               # List or create tasks
PATCH/DEL      /api/projects/[id]/tasks/[taskId]      # Update or delete task (triggers dispatch/abort on status change)
PUT            /api/projects/[id]/tasks/reorder        # Bulk reorder (drag-drop, also triggers dispatch/abort)
GET/POST/PATCH /api/projects/[id]/git                 # Branch state: list, switch, refresh preview branch
GET/POST       /api/projects/[id]/chat                # Chat history
```

**Git API (`/api/projects/[id]/git`):**

- `GET` — Returns `{ current, detached, branches }` — current branch + all local branches (`proq-preview/*` filtered out, reported as `proq/*`)
- `POST { branch }` — Switch branch (auto-stash, creates `proq-preview/*` for proq/\* branches, normal checkout for others)
- `PATCH` — Refresh preview branch if on one (ff-merge from source `proq/*` branch to pick up new agent commits)

**Status change side effects in PATCH/reorder:**
All routes follow the same pattern: update state, then call `processQueue()`.

- → `in-progress`: sets `agentStatus: "queued"`, `await processQueue()` handles dispatch
- `in-progress` → `todo`: checkout main if on task branch, clears `agentStatus`/summary/etc, removes worktree, `await abortTask()`, then `await processQueue()`
- `in-progress` → `verify`: keeps worktree alive for branch preview (deferred merge), sends notification
- `in-progress` → `done`: checkout main → merge → remove worktree, sends notification
- `verify` → `done`: checkout main → merge → remove worktree. On conflict, stays in verify.
- Deleting a task with a branch: checkout main if on task branch, remove worktree, abort if in-progress

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

- Dark mode only (class-based via `className="dark"`)
- Zinc color palette (zinc-800/900/950 backgrounds)
- Accent: blue-400 (active), green-400 (success), red-400 (error)
- CSS variables for theming in globals.css
- Utility-first Tailwind, minimal custom CSS

### Agent Integration

Tasks have fields specifically for AI agent use:

- `summary` — Agent's cumulative work summary (newline-separated)
- `nextSteps` — Suggested next steps: testing, refinements, or follow-up work (newline-separated)
- `agentLog` — Execution log from agent session
- `agentStatus` — Enum: `"queued"` | `"starting"` | `"running"` | null (agent lifecycle)
- `worktreePath` — Path to git worktree (parallel mode only)
- `branch` — Git branch name, e.g. `proq/abc12345` (parallel mode only)
- `mergeConflict` — `{ error, files, branch }` if merge failed

## Development & Release

- **Branching**: daily work on `develop`, merge to `main` via PR for releases
- **Dev mode**: `npm run dev` sets `PROQ_DEV=1` — disables all update checks (web + shell)
- **`isDevMode()`** in `desktop/src/main/config.ts` — checks `PROQ_DEV` env or `config.devMode`; gates all update logic
- **Release (web)**: `npm run release` — patch bump, tag, push. Users get it via git pull on next launch
- **Release (shell)**: `npm run release:desktop` — minor bump, tag, build Electron, publish GitHub Release
- **Updates on launch**: `showSplashAndStartServer()` checks for web updates behind the splash screen before starting the server
- **Shell updates**: `electron-updater` checks GitHub Releases for newer `.app` versions (`desktop/src/main/shell-updater.ts`)

## Important Notes

- Path alias: `@/*` maps to `./src/*`
- `design-mock/` is a separate Vite prototype — not part of the main app
- The app runs on port 1337 by default
- Optional Slack notifications via OpenClaw CLI — set `OPENCLAW_BIN` and `SLACK_CHANNEL` in `.env.local`
