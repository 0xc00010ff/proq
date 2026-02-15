# Mission Control

A project management dashboard that serves as the command center for AI-assisted development. Tasks on the kanban board automatically dispatch Claude Code agents to do the work.

## How It Works

1. **Create tasks** on the board (manually or via Twin, an AI assistant that talks to the API)
2. **Drag to "In Progress"** — Mission Control launches a Claude Code instance in a tmux session against that project's codebase
3. **Agent works autonomously** — commits code, then curls back to the MC API to move itself to "Verify"
4. **Human reviews** — approve to "Done" or send back to "Todo"

The agent runs with `--dangerously-skip-permissions` in a detached tmux session. While it's working, the task is locked on the board (blue pulsing border, spinner). Slack notifications fire on dispatch and completion.

## Features

- **Kanban Board** — 4-column drag-and-drop (Todo → In Progress → Verify → Done) via @dnd-kit
- **Agent Dispatch** — Automatic Claude Code launch in tmux on task status change
- **Task Locking** — Prevents edits while an agent is working
- **Slack Notifications** — Dispatch and completion alerts via OpenClaw CLI
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
- **Notifications:** OpenClaw CLI → Slack

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

## Data Storage

File-based JSON storage — no external database required.

- `data/config.json` — Project registry (name, path, status, serverUrl)
- `data/state/{project-id}.json` — Per-project tasks and chat history
- State files are gitignored so each environment maintains its own data

## API

All endpoints under `/api/projects`:

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/projects` | GET, POST | List or create projects |
| `/api/projects/[id]` | GET, PATCH, DELETE | Single project operations |
| `/api/projects/[id]/tasks` | GET, POST | List or create tasks |
| `/api/projects/[id]/tasks/[taskId]` | PATCH, DELETE | Update or delete task (status changes trigger agent dispatch/abort) |
| `/api/projects/[id]/tasks/reorder` | PUT | Bulk reorder from drag-drop (also triggers dispatch/abort) |
| `/api/projects/[id]/chat` | GET, POST | Chat/activity log |

### Agent Callback

Agents report completion by curling back:
```bash
curl -s -X PATCH http://localhost:3000/api/projects/{projectId}/tasks/{taskId} \
  -H 'Content-Type: application/json' \
  -d '{"status":"verify","locked":false}'
```

## Watching Agents

```bash
tmux attach -t mc-{first-8-chars-of-task-id}
```

## Scripts

```bash
npm run dev    # Development server
npm run build  # Production build
npm run start  # Production server
npm run lint   # ESLint
```
