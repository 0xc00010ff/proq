<p align="center">
  <img src="public/proq-badge.png" alt="proq" width="180" />
</p>

<p align="center">
  <strong>A kanban IDE for parallel coding agents.</strong><br/>
  Our job is to define what AI will build. This is a workspace built for that. 
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &nbsp;·&nbsp;
  <a href="#how-it-works">How It Works</a> &nbsp;·&nbsp;
  <a href="#api">API</a> &nbsp;·&nbsp;
  <a href="#under-the-hood">Under the Hood</a>
</p>

---

proq is a massively parallel vibe code IDE built for shipping quality software. A screen full of streaming terminals is not how you manage quality work. We combine the novelty of parallel tmux'd coding agents with a stupidly simple kanban interface. No more grids of streaming text, just create a task and watch the live output. If you want to observe an agent, just click into its task. This organization lets us sensibly manage multiple agents across multiple projects without spreading our attention thin. 

Under the hood it's a tmux process manager that bolts up to your favorite command line agent. It's local-first and works out of the box with subagents, MCPs, worktrees, and whatever config you bring along. **You can also edit proq using proq.**

## Quick Start

You'll need **Node.js 18+** and the **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** on your PATH. The setup script handles everything else (tmux, build tools, npm install):

```bash
git clone https://github.com/0xc00010ff/proq.git
cd proq
npm run setup
npm run dev
```

Open [http://localhost:1337](http://localhost:1337) and you're in.


## How It Works

1. **Create tasks** on the board — manually, or via any chat agent that talks to the API
2. **Drag to "In Progress"** — proq launches a Claude Code instance in a tmux session against that project's codebase
3. **Agent works autonomously** — writes code, commits, then calls back to the API to move itself to "Verify"
4. **Human reviews** — approve to "Done" or kick back to "Todo"

```
Todo ──→ In Progress ──→ Verify ──→ Done
          (agent launches)  (agent calls back)  (human approves)
```


## API

All endpoints live under `/api/projects`. Any assistant agent or script can create and manage tasks programmatically.

| Endpoint | Methods | Description |
| --- | --- | --- |
| `/api/projects` | GET, POST | List or create projects |
| `/api/projects/[id]` | GET, PATCH, DELETE | Single project CRUD |
| `/api/projects/[id]/tasks` | GET, POST | List or create tasks |
| `/api/projects/[id]/tasks/[taskId]` | PATCH, DELETE | Update or delete task |
| `/api/projects/[id]/tasks/reorder` | PUT | Bulk reorder from drag-drop |
| `/api/projects/[id]/git` | GET, POST, PATCH | Branch state and switching |
| `/api/projects/[id]/chat` | GET, POST | Chat/activity log |


## Under the Hood

### Architecture

proq is a Next.js 16 app (App Router) with file-based JSON storage via local lowdb — no external database needed.

```
src/
├── app/api/projects/       # REST API (projects, tasks, git, chat)
├── components/             # React UI (Sidebar, KanbanBoard, TaskCard, etc.)
└── lib/
    ├── agent-dispatch.ts   # tmux launch, abort, queue processing
    ├── worktree.ts         # Git worktree + branch operations
    ├── db.ts               # lowdb database layer
    └── types.ts            # TypeScript interfaces
```

**Data storage:**
- `data/workspace.json` — Project registry
- `data/projects/{id}.json` — Per-project tasks and chat history
- `data/` is gitignored — each user gets their own local state

### Parallel Mode & Worktrees

In parallel mode, each task gets its own git worktree and branch (`proq/{shortId}`). This means multiple agents can work on the same codebase simultaneously without stepping on each other.

The merge into main is **deferred** — the branch stays alive through "Verify" so you can preview changes before they land:

- **In Progress → Verify**: Worktree stays. Branch is available in the TopBar branch switcher.
- **Verify → Done**: Checks out main → merges branch → removes worktree. On conflict, the task stays in Verify for manual resolution.

**Preview flow:** Click "Preview" on a running task to create a disposable `proq-preview/{shortId}` branch at the same commit. The dev server hot-reloads to show the agent's work. Polling fast-forwards every 5 seconds to pick up new agent commits.

Auto-stash keeps your uncommitted work safe — changes are stashed before branch switches and popped when you return to main.

### Dispatch Lifecycle

The dispatch system is centralized through `processQueue(projectId)` — a single function that reads all tasks and decides what to launch next, with a re-entrancy guard per project.

```
dispatch: "queued"    → Waiting in line (or for processQueue to pick it up)
dispatch: "starting"  → processQueue selected it, tmux is launching
dispatch: "running"   → Agent is actively working
dispatch: null        → Not dispatched
```

Dragging a task back to "Todo" aborts the agent (kills the tmux session), then `processQueue()` picks up the next queued task automatically.

## Tech Stack

Next.js 16 · TypeScript · Tailwind CSS · shadcn/ui · lowdb · node-pty · tmux · Claude Code CLI

## Scripts

```bash
npm run setup  # Install dependencies + system prereqs
npm run dev    # Development server (port 1337)
npm run build  # Production build
npm run start  # Production server
npm run lint   # ESLint
```

## License

MIT

---

<p align="center">
  Vibed with ♥ by <a href="https://brian.online">brian.online</a>
</p>
