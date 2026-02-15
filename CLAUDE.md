# Mission Control — Claude Code Guide

## What This Is

Mission Control is the command center for AI-assisted development. It's a Next.js kanban board (localhost:3000) where Brian manages tasks across multiple coding projects. When a task moves to "In Progress", Mission Control automatically launches a Claude Code instance in a tmux session to work on it autonomously.

**The loop:**
1. Brian (or Twin, his AI assistant) creates tasks on the board
2. Task dragged/moved to "In Progress" → MC launches a Claude Code agent in tmux against that project's codebase
3. Agent works autonomously, commits, then curls back to MC's API to move itself to "Verify"
4. Brian reviews. Done or back to Todo.

**Who's who:**
- **Brian** — Human, project owner, reviews work
- **Twin** — Brian's AI assistant (runs in OpenClaw), creates/dispatches tasks via the API conversationally
- **Claude Code agents** — Disposable worker instances launched per-task in tmux

**Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, lowdb, @dnd-kit, uuid

## Quick Start
```bash
npm run dev    # Start dev server (localhost:3000)
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
│   │       └── chat/           # GET/POST chat messages
│   ├── globals.css             # CSS variables, dark theme, custom scrollbars
│   ├── layout.tsx              # Root layout (dark mode, Geist fonts)
│   └── page.tsx                # Main dashboard (all client state lives here)
├── components/
│   ├── Sidebar.tsx             # Project list with status indicators
│   ├── TopBar.tsx              # Project header + tab switcher
│   ├── KanbanBoard.tsx         # 4-column drag-drop board (@dnd-kit)
│   ├── TaskCard.tsx            # Individual task display (shows spinner when locked)
│   ├── TaskModal.tsx           # Unified task create/edit modal
│   ├── ChatPanel.tsx           # Terminal-style chat interface
│   ├── LiveTab.tsx             # Iframe dev server preview
│   └── CodeTab.tsx             # Code editor launcher
└── lib/
    ├── agent-dispatch.ts       # tmux launch + abort + Slack notifications
    ├── db.ts                   # lowdb database operations
    ├── types.ts                # All TypeScript interfaces
    └── utils.ts                # cn() utility (clsx + tailwind-merge)
```

### Agent Dispatch System (`src/lib/agent-dispatch.ts`)

This is the core automation. When a task transitions to `in-progress`:

1. **Launch:** `tmux new-session -d -s mc-{shortId} -c '{projectPath}' claude --dangerously-skip-permissions '{prompt}'`
   - Session name: `mc-` + first 8 chars of taskId
   - Runs in the project's directory
2. **Prompt:** Includes task description + instructions to commit and run a callback curl
3. **Callback:** Agent curls back when done:
   ```bash
   curl -s -X PATCH http://localhost:3000/api/projects/{projectId}/tasks/{taskId} \
     -H 'Content-Type: application/json' \
     -d '{"status":"verify","locked":false}'
   ```
4. **Slack:** Sends notifications via `openclaw` CLI on dispatch and completion
5. **Abort:** `abortTask()` kills the tmux session and unlocks the task

### Task Lifecycle & Locking

```
todo ──drag/API──→ in-progress ──agent callback──→ verify ──human──→ done
                   (locked=true)                   (locked=false)
                   agent launched                   human reviews
```

- `locked: true` — Set when agent is dispatched, prevents UI edits
- `locked: false` — Set when agent completes (callback) or task is aborted
- Locked tasks show a spinner and blue pulsing border in the UI
- Dragging back to "Todo" aborts the agent (kills tmux session)

### Data Layer
- **`data/config.json`** — Project registry (id, name, path, status, serverUrl)
- **`data/state/{id}.json`** — Per-project state (tasks array + chatLog array)
- **`data/state/` is gitignored** — Each user has their own local state
- Database: lowdb (JSON file storage, no external DB needed)

### Key Types (src/lib/types.ts)
- **Project**: `{ id, name, path, status, serverUrl, createdAt }`
- **Task**: `{ id, title, description, status, priority, order, findings, humanSteps, agentLog, locked, attachments, createdAt, updatedAt }`
- **ChatLogEntry**: `{ role: 'twin'|'brian', message, timestamp, toolCalls? }`
- Task statuses: `todo` → `in-progress` → `verify` → `done`
- Project statuses: `active`, `review`, `idle`, `error`

### API Routes
```
GET/POST       /api/projects                          # List or create projects
GET/PATCH/DEL  /api/projects/[id]                     # Single project CRUD
GET/POST       /api/projects/[id]/tasks               # List or create tasks
PATCH/DEL      /api/projects/[id]/tasks/[taskId]      # Update or delete task (triggers dispatch/abort on status change)
PUT            /api/projects/[id]/tasks/reorder        # Bulk reorder (drag-drop, also triggers dispatch/abort)
GET/POST       /api/projects/[id]/chat                # Chat history
```

**Status change side effects in PATCH/reorder:**
- → `in-progress`: sets `locked: true`, calls `dispatchTask()`, sends Slack notification
- `in-progress` → `todo`: sets `locked: false`, calls `abortTask()`
- `in-progress` → `verify`: sends Slack completion notification

### Frontend Data Flow
- Fetch all projects on mount, then tasks for each project
- 5-second auto-refresh polling on tasks (picks up agent status changes)
- Optimistic UI updates for drag-drop, then silent background refresh after 500ms
- Chat loaded on project switch
- API calls use standard fetch with JSON bodies

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
- `findings` — Agent's analysis/findings (newline-separated)
- `humanSteps` — Action items for human review (newline-separated)
- `agentLog` — Execution log from agent session
- `locked` — Boolean, true while agent is actively working

## Important Notes
- Path alias: `@/*` maps to `./src/*`
- `design-mock/` is a separate Vite prototype — not part of the main app
- lowdb v7 uses ESM — all db operations are async
- The app runs on port 3000 by default
- Tmux sessions: `tmux attach -t mc-{first8ofTaskId}` to watch an agent work
- Slack notifications go to channel `C0AEY4GBCGM` via `/opt/homebrew/bin/openclaw`
