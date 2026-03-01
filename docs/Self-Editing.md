# Self-Editing

proq can develop itself. Since it's a Next.js app running locally, you add it to its own project list and use proq's agents to modify its own codebase. Hot reload shows changes instantly.

## Setup

```bash
git clone https://github.com/0xc00010ff/proq.git
cd proq
npm run setup
npm run dev
```

Add proq as a project in the sidebar:

- **Name**: proq (or whatever you like)
- **Path**: the directory you cloned into (e.g. `~/projects/proq`)
- **Server URL**: `http://localhost:1337`

Now proq appears on its own board.

## Working on proq with proq

Create tasks on proq's board just like any other project. When you drag a task to In Progress, an agent launches against proq's codebase. It reads, edits, and commits — and Next.js hot reload picks up the changes immediately.

In parallel mode, each agent gets an isolated git worktree, so multiple agents can work on different parts of proq simultaneously without conflicts.

The Live tab shows proq's own UI. You can watch the interface update as agents modify components.

## Caveats

**Server-side code changes cause a brief restart.** When an agent modifies server code (API routes, `lib/` files), Next.js hot-reloads the server. This briefly drops WebSocket connections. tmux sessions survive — the agents keep running. WebSocket connections reconnect automatically, and structured mode sessions resume with full block history.

**Avoid modifying core dispatch/db files while other agents are running.** Changes to `agent-dispatch.ts`, `db.ts`, `agent-session.ts`, or `ws-server.ts` can disrupt running agents if the server restarts mid-operation. If you need to change these, pause other tasks first.

**Parallel mode is safer for self-editing.** Each agent works in an isolated worktree, so an agent editing proq's dispatch code won't affect the running instance until the branch is merged.

## Dev Tips

- **Lint**: `npm run lint`
- **TypeScript**: strict mode enabled
- **Path alias**: `@/*` maps to `./src/*`
- **lowdb v7**: uses ESM — all database operations are async
- **Port**: 1337 by default
- **Watch agents**: `tmux attach -t mc-{first8ofTaskId}` to observe a CLI-mode agent
- **design-mock/**: separate Vite prototype in the repo root — not part of the main app, ignore it
- **Styling**: dark mode only, Tailwind utility classes, zinc color palette
- **Components**: shadcn/ui based, `'use client'` directive on all interactive components
