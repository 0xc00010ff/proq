<p align="center">
  <img src="public/proq-badge.png" alt="proq" width="180" />
</p>

<p align="center">
  <strong>A task board that runs your coding agents.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &nbsp;·&nbsp;
  <a href="#how-it-works">How It Works</a> &nbsp;·&nbsp;
  <a href="#what-you-get">What You Get</a> &nbsp;·&nbsp;
  <a href="#api">API</a>
</p>

---

You write tasks. Agents do the work. You review and merge. proq is a kanban board that launches CLI coding agents in tmux, one per task, against your actual codebase.

<!-- screenshot: board with a running agent -->

Internally it's a process manager — local, self-contained, no external services. It works with whatever agent config, MCPs, and subagents you already have.

## Quick Start

You'll need **Node.js 18+** and the **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** on your PATH. The setup script handles everything else:

```bash
git clone https://github.com/0xc00010ff/proq.git
cd proq
npm run setup
npm run dev
```

Open [localhost:1337](http://localhost:1337).

## How It Works

1. **Create tasks** on the board — manually, or from any agent that talks to the API
2. **Move to In Progress** — proq launches a Claude Code session in tmux against that project
3. **Agent works** — writes code, commits, calls back to move itself to Verify
4. **You review** — approve to Done (merges the branch) or send it back

## What You Get

**Parallel agents.** Each task runs in its own git worktree and branch. Multiple agents work the same codebase without conflicts.

**Live preview.** Click into a running task to watch the agent work. A preview branch hot-reloads your dev server with the agent's latest commits.

**Deferred merge.** Branches stay alive through review. Code only hits main when you say so. Merge conflicts keep the task in Verify for manual resolution.

**API-first.** Every action on the board is an API call. Supervisor agents, scripts, or chat interfaces can create and manage tasks programmatically.

**Local and self-contained.** JSON file storage, no database, no cloud. Your projects, your machine, your agent config.

## API

All endpoints live under `/api/projects`.

| Endpoint | Methods | Description |
| --- | --- | --- |
| `/api/projects` | GET, POST | List or create projects |
| `/api/projects/[id]` | GET, PATCH, DELETE | Single project CRUD |
| `/api/projects/[id]/tasks` | GET, POST | List or create tasks |
| `/api/projects/[id]/tasks/[taskId]` | PATCH, DELETE | Update or delete task |
| `/api/projects/[id]/tasks/reorder` | PUT | Bulk reorder |
| `/api/projects/[id]/git` | GET, POST, PATCH | Branch state and switching |
| `/api/projects/[id]/chat` | GET, POST | Chat log |

## Documentation

| Doc | What it covers |
|---|---|
| [Getting Started](docs/Getting-Started.md) | Install, create tasks, watch agents, review, live preview |
| [Architecture](docs/Architecture.md) | Data layer, dispatch engine, WebSocket protocol, REST API |
| [Parallel Worktrees](docs/Parallel-Worktrees.md) | Worktree lifecycle, preview branches, auto-stash, merge conflicts |
| [Self-Editing](docs/Self-Editing.md) | How to develop proq using proq |

## License

MIT

---

<p align="center">
  proq is developed using proq.
</p>
