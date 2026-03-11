<p align="center">
  <img src="public/proq-badge.png" alt="proq" width="140" />
</p>

<h3 align="center">Build something you'll love.</h3>

<p align="center">
  <a href="#download">Download</a> &nbsp;&middot;&nbsp;
  <a href="#run-locally">Run Locally</a> &nbsp;&middot;&nbsp;
  <a href="#how-it-works">How It Works</a> &nbsp;&middot;&nbsp;
  <a href="#api">API</a>
</p>

---

Proq is an agentic coding workspace. Not another AI — a process manager for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that keeps you focused while multiple agents work your codebase.

Most agentic tools optimize for speed. Proq optimizes for quality. A kanban board, parallel git worktrees, branch previews, and a review step before anything touches main. You stay in control of what ships.

It's local, self-contained, and works with whatever agent config, MCPs, and tools you already use.

## Download

> macOS app — no terminal required.

<!-- TODO: Replace with actual download links -->

| Platform | Link |
|---|---|
| macOS (Apple Silicon) | [Download .dmg](https://github.com/0xc00010ff/proq/releases/latest) |
| macOS (Intel) | [Download .dmg](https://github.com/0xc00010ff/proq/releases/latest) |

The desktop app handles setup, dependencies, and server management automatically. Just open it and add a project.

## Run Locally

Requires **Node.js 18+** and the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) on your PATH.

```bash
git clone https://github.com/0xc00010ff/proq.git
cd proq
npm run setup
npm run dev
```

Open [localhost:1337](http://localhost:1337). Add a project path, create a task, drag it to In Progress.

## How It Works

Proq runs one Claude Code instance per task. That's it.

1. **Create tasks** on the kanban board — or from any agent, script, or chat interface via the API
2. **Drag to In Progress** — Proq launches a Claude Code session against your project
3. **Agent works** — reads code, makes changes, commits to a dedicated branch
4. **You review** — approve to merge, or send it back

In parallel mode, each task gets its own git worktree and branch. Multiple agents work the same codebase simultaneously without conflicts. Branches stay alive through review — code only merges to main when you say so.

### What you get

- **Parallel agents** — isolated worktrees per task, no conflicts
- **Branch previews** — hot-reload your dev server with an agent's latest commits
- **Deferred merge** — review before anything hits main, with conflict detection
- **Structured output** — watch agent reasoning, tool calls, and edits in real time
- **Built-in workbench** — shell tabs, code browser, and freeform agent conversations
- **Supervisor** — a conversational AI at `/supervisor` that dispatches tasks across all your projects

### Plays well with others

Proq is API-first. Every board action is a REST endpoint. It ships with MCP servers that agents use to report progress, and a general-purpose MCP for managing tasks from any tool.

Works with [OpenClaw](https://github.com/0xc00010ff/openclaw) and other agentic tools out of the box — anything that can make HTTP requests can create and manage tasks.

## Customize Proq Using Proq

Proq can develop itself. Add proq to its own project list, point the path at the repo, and set the server URL to `http://localhost:1337`. Now proq's agents modify its own codebase with hot reload showing changes instantly.

```
Name:       proq
Path:       ~/projects/proq
Server URL: http://localhost:1337
```

In parallel mode, agents work in isolated worktrees so they won't disrupt the running instance.

## API

Everything is programmable. Create projects, manage tasks, switch branches — all via REST.

```
GET/POST       /api/projects
GET/PATCH/DEL  /api/projects/[id]
GET/POST       /api/projects/[id]/tasks
PATCH/DEL      /api/projects/[id]/tasks/[taskId]
PUT            /api/projects/[id]/tasks/reorder
GET/POST/PATCH /api/projects/[id]/git
GET/POST       /api/projects/[id]/chat
```

Create a task and start it in one call:

```bash
curl -X POST http://localhost:1337/api/projects/$ID/tasks \
  -H 'Content-Type: application/json' \
  -d '{"description": "Refactor the auth module", "status": "in-progress"}'
```

### MCP Servers

**Per-task** (`proq-mcp.js`) — automatically available to every agent:
- `read_task` — get current task state and summary
- `update_task` — report findings, move to review
- `commit_changes` — stage and commit changes

**General** (`proq-mcp-general.js`) — for supervisors and external tools:
- `list_projects`, `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`

## Documentation

| Doc | What it covers |
|---|---|
| [Getting Started](docs/Getting-Started.md) | Full walkthrough — install, create tasks, watch agents, review |
| [Architecture](docs/Architecture.md) | Data layer, dispatch engine, WebSocket protocol, settings |
| [Parallel Worktrees](docs/Parallel-Worktrees.md) | Worktree lifecycle, preview branches, merge conflicts |
| [Self-Editing](docs/Self-Editing.md) | Developing proq with proq |
| [Desktop App](desktop/README.md) | Electron app setup and packaging |

## Configuration

Settings are available in the UI (gear icon) or via `/api/settings`.

| Category | Key options |
|---|---|
| **Agent** | Claude binary path, default model, system prompt additions, execution mode (sequential/parallel) |
| **Git** | Auto-commit, commit style, auto-push, branch switcher |
| **Notifications** | Slack (via OpenClaw), webhooks, system notifications |
| **Process** | Cleanup delay, poll interval, terminal scrollback |

## License

MIT
