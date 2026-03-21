# Getting Started

proq is a kanban IDE for parallel coding agents. You create tasks on a board (switch between kanban, list, and grid views), agents pick them up and work autonomously, then you review and approve. This guide walks through everything you can do.

For a high-level overview, see the [README](../README.md). For internals, see [Architecture](./Architecture.md).

## Prerequisites

- **Node.js 18+**
- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** on your PATH

## Install & Run

```bash
git clone https://github.com/0xc00010ff/proq.git
cd proq
npm run setup   # installs deps + checks prereqs
npm run dev     # starts dev server on localhost:1337
```

Open [http://localhost:1337](http://localhost:1337).

### Desktop App (Alternative)

The [desktop shell](../desktop/) is an Electron wrapper that handles everything above through a setup wizard — no terminal needed. It clones proq, installs dependencies, builds the server, and runs it inside a native window. See the [desktop README](../desktop/README.md) for setup and packaging instructions.

## Add a Project

Click the **+** button in the sidebar. Enter:

- **Name** — display name for the project
- **Path** — absolute path to the project's codebase (e.g. `~/projects/my-app`)
- **Server URL** (optional) — if the project has a dev server, enter its URL (e.g. `http://localhost:3000`) to enable live preview

Projects appear in the sidebar with status indicators (active, review, idle, error).

## Create a Task

Click **New Task** on the board. Fill in:

- **Title** — short summary
- **Description** — detailed instructions for the agent
- **Mode** — determines what the agent is allowed to do:
  - **Auto** (default) — auto-selects the best mode based on the task
  - **Build** — full code changes, commits, the works
  - **Plan** — creates a plan for approval, then implements it
  - **Answer** — research only, no file changes
- **Attachments** — drag or paste images (screenshots, mockups) that the agent can view

## Run the Agent

Two ways to start a task:

1. **Drag** the task card from Todo to In Progress
2. **Click** the task card and hit Start

The task cycles through dispatch states:

- **queued** — waiting for its turn (sequential mode) or for `processQueue` to pick it up
- **starting** — selected by the queue, agent is launching
- **running** — agent is actively working

In **sequential mode**, one task runs at a time. In **parallel mode**, all queued tasks launch simultaneously in the project directory on the same branch. In **worktrees mode**, all queued tasks launch simultaneously, each in its own git worktree and branch.

## Watch It Work

Click a task card to open the agent modal. Two viewing modes:

### Structured Mode (default)

The agent's output is parsed into discrete blocks:

- **Thinking** — the agent's reasoning (collapsible)
- **Tool calls** — file reads, edits, bash commands (expandable to see input/output)
- **Text** — the agent's messages
- **Task updates** — when the agent reports summary via MCP

This is the recommended mode — it's easier to follow what the agent is doing.

### CLI Mode

Raw terminal output via xterm.js. The agent runs in a PTY bridge process, streaming output directly to the browser via a unix socket.

You can toggle between modes in Settings under Agent > Render Mode.

### Follow-Up Messages

While the agent is running, you can send follow-up messages from the agent modal. Type in the input box and hit send — the agent receives your message as a continuation of the conversation. You can also attach images to follow-ups.

## Review & Complete

When the agent finishes, it calls back via MCP to move the task to **Verify**. The task card shows:

- **Findings** — the agent's summary of what it did
- **Next Steps** — suggested testing, refinements, or follow-up work (if any)

From Verify, you can:

- **Approve to Done** — in worktrees mode, this merges the agent's branch into main
- **Kick back to Todo** — discards the work (removes worktree/branch in worktrees mode)

## Live Preview

The **Live** tab embeds your project's dev server in an iframe. Enter the server URL in the project settings, then switch to the Live tab.

- **Viewport toggle** — switch between desktop, tablet, and mobile widths
- Works with any dev server that supports hot reload — when an agent commits, the preview updates

In worktrees mode, you can preview a specific agent's branch by clicking "Preview" on the task card. The dev server hot-reloads to show that branch's changes, polling every 5 seconds to pick up new commits.

## Code Browser

The **Code** tab gives you a file tree and Monaco editor for browsing (and editing) the project's codebase directly in the browser.

- Navigate files in the left tree panel
- Edit and auto-save
- Markdown files render a preview

## Workbench

The bottom panel (toggle with the handle at the bottom of the screen) provides:

### Shell Tabs

Interactive terminal sessions running in the project directory. Full xterm.js terminal — you can run any command, install packages, run tests. Multiple tabs supported.

### Agent Tabs

Freeform Claude Code conversations scoped to the project. Unlike task agents, these aren't tied to a specific task — use them for ad-hoc questions, debugging, or exploration. They use the same structured block rendering as task agents.

## Supervisor

Navigate to `/supervisor` (link in the sidebar) for a conversational AI that manages tasks across all your projects. The supervisor:

- Knows about all loaded projects and their tasks
- Can create, update, and move tasks via the REST API
- Streams responses in structured block format
- Maintains a persistent conversation (survives page reloads)

Use it to dispatch work conversationally: "Create three tasks on project X to refactor the auth module."

## Cron Jobs

Cron jobs let you schedule recurring tasks. Create them from the project menu — they run on a schedule and create tasks automatically.

## Settings

Click the gear icon to open Settings. Key sections:

| Section | What it controls |
|---|---|
| **Agent** | Claude binary path, default model, system prompt additions, execution mode (sequential/parallel/worktrees), render mode (structured/CLI), cost display, coding agent |
| **Updates** | Auto-update |
| **Appearance** | Theme (dark/light/system) |
| **Notifications** | Sound, desktop, webhooks |

For the full settings reference, see [Architecture > Settings Reference](./Architecture.md#settings-reference).

## API

Everything in proq is programmable via REST. Any script or AI assistant can create projects, manage tasks, and drive the board.

```
GET/POST       /api/projects
GET/PATCH/DEL  /api/projects/[id]
GET/POST       /api/projects/[id]/tasks
PATCH/DEL      /api/projects/[id]/tasks/[taskId]
PUT            /api/projects/[id]/tasks/reorder
GET/POST/PATCH /api/projects/[id]/git
GET/POST       /api/projects/[id]/chat
```

For full endpoint documentation with request/response details, see [Architecture > REST API Reference](./Architecture.md#rest-api-reference).
