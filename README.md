<p align="center">
  <img src="public/proq-badge.png" alt="proq" width="140" />
</p>

<h3 align="center">Serious vibe coding</h3>

<p align="center">
  <a href="#download">Download</a> &nbsp;&middot;&nbsp;
  <a href="#run-locally">Run Locally</a> &nbsp;&middot;&nbsp;
  <a href="#docs">Docs</a>
</p>

---

<!-- TODO: Add screenshot/gif of the board in action -->

#### Proq is an agentic development environment.
A kanban-style task manager for local Claude Code instances.

Create a task → proq spins up an agent, gives it an isolated worktree, tracks the agent's work, and lets you preview changes.

The point is maintaining quality and clarity when vibe coding. Automatic history, fresh focused contexts, and parallel ops without managing a grid of terminals.

Free, no signup, local-only, and works with whatever agent config, MCPs, and tools you already use with Claude.

# Download

### macOS app — get moving in 1 minute

| Platform | Link |
|---|---|
| macOS (Apple Silicon) | [Download .dmg](https://github.com/0xc00010ff/proq/releases/latest) |
| macOS (Intel) | [Download .dmg](https://github.com/0xc00010ff/proq/releases/latest) |

Just open it and start cooking.

# Run Locally

Requires **Node.js 18+** and the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) on your PATH.

```bash
git clone https://github.com/0xc00010ff/proq.git
cd proq
npm run setup
npm run dev
```

Open [localhost:1337](http://localhost:1337). Add proq as a project. Create a task and watch the app update itself.

# Explore

- **Parallel agents** — each task gets its own git worktree and branch, multiple agents work the same codebase without conflicts
- **Live preview** — start and view your project live, let agents view/use your app
- **Project workbench** — freeform agent, terminal, and code editor for quick little edits
- **HTTP API** — every board action is a REST endpoint, anything that can make HTTP requests can manage tasks
- **MCP server** — manage projects and tasks from any MCP-compatible agent or tool
- **Supervisor** — an agent that lives above all your projects, can be hooked up to OpenClaw / external agents
- **Customization** - toggle kanban vs list, pretty chat vs raw CLI, light/dark mode
- **Self-editing** — add proq to its own project list, add whatever features you want

# Docs

| Doc | What it covers |
|---|---|
| [Getting Started](docs/Getting-Started.md) | Install, create tasks, watch agents, review |
| [Architecture](docs/Architecture.md) | Data layer, dispatch engine, API routes, settings |
| [Parallel Worktrees](docs/Parallel-Worktrees.md) | Worktree lifecycle, preview branches, merge conflicts |
| [Self-Editing](docs/Self-Editing.md) | Developing proq with proq |
| [Desktop App](desktop/README.md) | Electron app setup and packaging |

## License

MIT

---

proq was built using proq