# proq

A kanban command center for AI-assisted development. Tasks on the board automatically dispatch Claude Code agents to do the work.

## How It Works

1. **Create tasks** on the board (manually, or via any chat agent that talks to the API)
2. **Drag to "In Progress"** — proq launches a Claude Code instance in a tmux session against that project's codebase
3. **Agent works autonomously** — commits code, then curls back to the API to move itself to "Verify"
4. **Human reviews** — approve to "Done" or send back to "Todo"

The agent runs with `--dangerously-skip-permissions` in a detached tmux session. While it's working, the task is locked on the board (blue pulsing border, spinner).

## Prerequisites

- **Node.js** 18+
- **tmux** — agents run in detached tmux sessions
- **Claude Code CLI** — must be installed and on your PATH (or set `CLAUDE_BIN` in `.env.local`)
- **macOS** — the folder picker uses `osascript` (you can still type paths manually on other platforms)
- **Native build tools** — `node-pty` requires compilation (`xcode-select --install` on macOS)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:7331](http://localhost:7331) to view the dashboard. The `data/` directory is created automatically on first run.

Copy `.env.example` to `.env.local` and adjust if needed — see [Configuration](#configuration) below.

## Configuration

See `.env.example` for all options. Copy it to `.env.local` to customize:

```bash
cp .env.example .env.local
```

| Variable        | Default  | Description                                                  |
| --------------- | -------- | ------------------------------------------------------------ |
| `CLAUDE_BIN`    | `claude` | Path to the Claude Code CLI binary                           |
| `OPENCLAW_BIN`  | —        | Path to OpenClaw CLI (optional, enables Slack notifications) |
| `SLACK_CHANNEL` | —        | Slack channel ID for notifications (requires `OPENCLAW_BIN`) |

## Features

- **Kanban Board** — 4-column drag-and-drop (Todo → In Progress → Verify → Done) via @dnd-kit
- **Agent Dispatch** — Automatic Claude Code launch in tmux on task status change
- **Task Locking** — Prevents edits while an agent is working
- **Project Sidebar** — Multi-project support with status indicators
- **Chat Panel** — Terminal-style activity log
- **Live Preview** — Embedded iframe for dev servers
- **5s Auto-Refresh** — Board polls for agent status updates

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS + shadcn/ui
- **Database:** lowdb (JSON file storage, no external DB)
- **Drag & Drop:** @dnd-kit
- **Agent Runtime:** Claude Code in tmux

## Data Storage

File-based JSON storage — no external database required. The `data/` directory is gitignored and auto-created on first run.

- `data/workspace.json` — Project registry (name, path, status, serverUrl)
- `data/projects/{project-id}.json` — Per-project tasks and chat history

## API

All endpoints under `/api/projects`. The API can be consumed by any autonomous chat agent (e.g., [OpenClaw](https://github.com/openclaw)) to create and manage tasks programmatically.

| Endpoint                            | Methods            | Description                                                         |
| ----------------------------------- | ------------------ | ------------------------------------------------------------------- |
| `/api/projects`                     | GET, POST          | List or create projects                                             |
| `/api/projects/[id]`                | GET, PATCH, DELETE | Single project operations                                           |
| `/api/projects/[id]/tasks`          | GET, POST          | List or create tasks                                                |
| `/api/projects/[id]/tasks/[taskId]` | PATCH, DELETE      | Update or delete task (status changes trigger agent dispatch/abort) |
| `/api/projects/[id]/tasks/reorder`  | PUT                | Bulk reorder from drag-drop (also triggers dispatch/abort)          |
| `/api/projects/[id]/chat`           | GET, POST          | Chat/activity log                                                   |

### Agent Callback

Agents report completion by curling back:

```bash
curl -s -X PATCH http://localhost:7331/api/projects/{projectId}/tasks/{taskId} \
  -H 'Content-Type: application/json' \
  -d '{"status":"verify","locked":false,"findings":"summary of work","humanSteps":"verification steps"}'
```

## Watching Agents

```bash
tmux attach -t mc-{first-8-chars-of-task-id}
```

## Scripts

```bash
npm run dev    # Development server (port 7331)
npm run build  # Production build
npm run start  # Production server
npm run lint   # ESLint
```
