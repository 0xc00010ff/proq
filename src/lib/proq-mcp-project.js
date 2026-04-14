#!/usr/bin/env node
/**
 * Project-scoped proq MCP server — tools for workbench agents working within a project.
 *
 * Usage: node proq-mcp-project.js [--project <projectId>]
 *
 * When --project is set, projectId becomes optional on task tools (defaults to that project).
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const API = process.env.PROQ_API || "http://localhost:1337";

// Parse --project flag
let defaultProjectId = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--project" && args[i + 1]) {
    defaultProjectId = args[i + 1];
    break;
  }
}

function resolveProjectId(provided) {
  const id = provided || defaultProjectId;
  if (!id) {
    throw new Error("projectId is required (no --project default set)");
  }
  return id;
}

const server = new McpServer({
  name: "proq",
  version: "1.0.0",
});

// ── list_projects ──

server.tool(
  "list_projects",
  "List all projects in proq with their id, name, path, and status.",
  {},
  async () => {
    try {
      const res = await fetch(`${API}/api/projects`);
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to list projects: ${res.status}` }], isError: true };
      }
      const projects = await res.json();
      const summary = projects.map((p) => ({
        id: p.id,
        name: p.name,
        path: p.path,
        status: p.status,
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── list_tasks ──

server.tool(
  "list_tasks",
  "List all tasks for a project, grouped by status column (todo, in-progress, verify, done).",
  {
    projectId: z.string().optional().describe("Project ID (optional if --project was set)"),
  },
  async ({ projectId }) => {
    try {
      const pid = resolveProjectId(projectId);
      const res = await fetch(`${API}/api/projects/${pid}/tasks`);
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to list tasks: ${res.status}` }], isError: true };
      }
      const columns = await res.json();
      // Summarize each task concisely
      const summarize = (tasks) =>
        tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          agentStatus: t.agentStatus || null,
        }));
      const summary = {};
      for (const [col, tasks] of Object.entries(columns)) {
        summary[col] = summarize(tasks);
      }
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── get_task ──

server.tool(
  "get_task",
  "Get the full details of a specific task.",
  {
    projectId: z.string().optional().describe("Project ID (optional if --project was set)"),
    taskId: z.string().describe("Task ID"),
  },
  async ({ projectId, taskId }) => {
    try {
      const pid = resolveProjectId(projectId);
      const res = await fetch(`${API}/api/projects/${pid}/tasks/${taskId}`);
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to get task: ${res.status}` }], isError: true };
      }
      const task = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── create_task ──

server.tool(
  "create_task",
  "Create a new task in a project.",
  {
    projectId: z.string().optional().describe("Project ID (optional if --project was set)"),
    title: z.string().describe("Task title"),
    description: z.string().describe("Task description with details about what needs to be done"),
    mode: z.enum(["auto", "build", "plan", "answer"]).optional().describe("Claude Code execution mode (default: auto)"),
    agentId: z.string().optional().describe("Agent UUID to assign this task to (uses project default if omitted)"),
  },
  async ({ projectId, title, description, mode, agentId }) => {
    try {
      const pid = resolveProjectId(projectId);
      const res = await fetch(`${API}/api/projects/${pid}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, mode, agentId }),
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to create task: ${res.status}` }], isError: true };
      }
      const task = await res.json();
      return { content: [{ type: "text", text: `Created task "${task.title}" (${task.id})` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── list_agents ──

server.tool(
  "list_agents",
  "List all agents in a project.",
  {
    projectId: z.string().optional().describe("Project ID (optional if --project was set)"),
  },
  async ({ projectId }) => {
    try {
      const pid = resolveProjectId(projectId);
      const res = await fetch(`${API}/api/projects/${pid}/agents`);
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to list agents: ${res.status}` }], isError: true };
      }
      const agents = await res.json();
      const lines = agents.map((a) => `- \`${a.id}\` — ${a.name}${a.role ? `. ${a.role}` : ""}`);
      return { content: [{ type: "text", text: lines.join("\n") || "No agents found." }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── update_task ──

server.tool(
  "update_task",
  "Update a task's fields such as title, description, status, or priority.",
  {
    projectId: z.string().optional().describe("Project ID (optional if --project was set)"),
    taskId: z.string().describe("Task ID"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    status: z.enum(["todo", "in-progress", "verify", "done"]).optional().describe("New status"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("New priority"),
    agentId: z.string().optional().describe("Agent UUID to assign this task to (uses project default if omitted)"),
  },
  async ({ projectId, taskId, ...fields }) => {
    try {
      const pid = resolveProjectId(projectId);
      // Only send fields that were provided
      const body = {};
      if (fields.title !== undefined) body.title = fields.title;
      if (fields.description !== undefined) body.description = fields.description;
      if (fields.status !== undefined) body.status = fields.status;
      if (fields.priority !== undefined) body.priority = fields.priority;
      if (fields.agentId !== undefined) body.agentId = fields.agentId;

      const res = await fetch(`${API}/api/projects/${pid}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to update task: ${res.status}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Task ${taskId} updated.` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── set_live_url ──

server.tool(
  "set_live_url",
  "Set the live preview URL for the project. Use this after starting a dev server so the human can see the running app in the Live tab. The Live tab will automatically refresh to show the new URL.",
  {
    projectId: z.string().optional().describe("Project ID (optional if --project was set)"),
    url: z.string().describe("The local URL of the running dev server, e.g. http://localhost:3000"),
  },
  async ({ projectId, url }) => {
    try {
      const pid = resolveProjectId(projectId);
      const res = await fetch(`${API}/api/projects/${pid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverUrl: url }),
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to set live URL: ${res.status}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Live URL set to ${url} — the human can now see it in the Live tab.` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── commit_changes ──

server.tool(
  "commit_changes",
  "Stage and commit all current changes. Use after each logical unit of work to keep your progress saved.",
  {
    projectId: z.string().optional().describe("Project ID (optional if --project was set)"),
    message: z.string().describe("Descriptive commit message summarizing the changes"),
  },
  async ({ projectId, message }) => {
    try {
      const pid = resolveProjectId(projectId);
      const projRes = await fetch(`${API}/api/projects/${pid}`);
      if (!projRes.ok) {
        return { content: [{ type: "text", text: `Failed to resolve project: ${projRes.status}` }], isError: true };
      }
      const proj = await projRes.json();
      const workDir = proj.path?.replace(/^~/, process.env.HOME || "~");
      if (!workDir) {
        return { content: [{ type: "text", text: "Could not resolve working directory." }], isError: true };
      }

      const { execSync } = require("child_process");

      // Check if there's anything to commit
      const status = execSync(`git -C '${workDir}' status --porcelain`, {
        timeout: 10_000,
        encoding: "utf-8",
      }).trim();

      if (!status) {
        return { content: [{ type: "text", text: "Nothing to commit — working tree is clean." }] };
      }

      // Stage all and commit
      execSync(`git -C '${workDir}' add -A`, { timeout: 10_000 });
      const safeMsg = message.replace(/'/g, "'\\''");
      const result = execSync(`git -C '${workDir}' commit -m '${safeMsg}'`, {
        timeout: 15_000,
        encoding: "utf-8",
      }).trim();

      const hashMatch = result.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
      const hash = hashMatch ? hashMatch[1] : "";

      return { content: [{ type: "text", text: `Committed${hash ? ` (${hash})` : ""}: ${message}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Commit failed: ${err.message}` }], isError: true };
    }
  },
);

// ── delete_task ──

server.tool(
  "delete_task",
  "Delete a task from a project.",
  {
    projectId: z.string().optional().describe("Project ID (optional if --project was set)"),
    taskId: z.string().describe("Task ID"),
  },
  async ({ projectId, taskId }) => {
    try {
      const pid = resolveProjectId(projectId);
      const res = await fetch(`${API}/api/projects/${pid}/tasks/${taskId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to delete task: ${res.status}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Task ${taskId} deleted.` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── list_crons ──

server.tool(
  "list_crons",
  "List all cron jobs for a project.",
  {
    projectId: z.string().optional().describe("Project ID (optional if --project was set)"),
  },
  async ({ projectId }) => {
    try {
      const pid = resolveProjectId(projectId);
      const res = await fetch(`${API}/api/projects/${pid}/crons`);
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to list crons: ${res.status}` }], isError: true };
      }
      const jobs = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(jobs, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── create_cron ──

server.tool(
  "create_cron",
  "Create a cron job that automatically creates and dispatches tasks on a schedule.",
  {
    projectId: z.string().optional().describe("Project ID (optional if --project was set)"),
    name: z.string().describe("Name for the cron job"),
    prompt: z.string().describe("The task description/prompt that will be used when the cron creates a task"),
    schedule: z.string().describe("Cron schedule expression, e.g. '0 9 * * *' for daily at 9am"),
    mode: z.enum(["auto", "build", "plan", "answer"]).optional().describe("Task execution mode (default: auto)"),
    enabled: z.boolean().optional().describe("Whether the cron is enabled (default: true)"),
  },
  async ({ projectId, name, prompt, schedule, mode, enabled }) => {
    try {
      const pid = resolveProjectId(projectId);
      const body = { name, prompt, schedule };
      if (mode !== undefined) body.mode = mode;
      if (enabled !== undefined) body.enabled = enabled;
      const res = await fetch(`${API}/api/projects/${pid}/crons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { content: [{ type: "text", text: `Failed to create cron: ${res.status} ${err.error || ""}` }], isError: true };
      }
      const job = await res.json();
      return { content: [{ type: "text", text: `Created cron "${job.name}" (${job.id}) — schedule: ${job.schedule}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── update_cron ──

server.tool(
  "update_cron",
  "Update a cron job's fields such as name, prompt, schedule, mode, or enabled state.",
  {
    projectId: z.string().optional().describe("Project ID (optional if --project was set)"),
    cronId: z.string().describe("Cron job ID"),
    name: z.string().optional().describe("New name"),
    prompt: z.string().optional().describe("New prompt"),
    schedule: z.string().optional().describe("New cron schedule expression"),
    mode: z.enum(["auto", "build", "plan", "answer"]).optional().describe("New execution mode"),
    enabled: z.boolean().optional().describe("Enable or disable the cron"),
  },
  async ({ projectId, cronId, ...fields }) => {
    try {
      const pid = resolveProjectId(projectId);
      const body = {};
      if (fields.name !== undefined) body.name = fields.name;
      if (fields.prompt !== undefined) body.prompt = fields.prompt;
      if (fields.schedule !== undefined) body.schedule = fields.schedule;
      if (fields.mode !== undefined) body.mode = fields.mode;
      if (fields.enabled !== undefined) body.enabled = fields.enabled;
      const res = await fetch(`${API}/api/projects/${pid}/crons/${cronId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to update cron: ${res.status}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Cron ${cronId} updated.` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── delete_cron ──

server.tool(
  "delete_cron",
  "Delete a cron job from a project.",
  {
    projectId: z.string().optional().describe("Project ID (optional if --project was set)"),
    cronId: z.string().describe("Cron job ID"),
  },
  async ({ projectId, cronId }) => {
    try {
      const pid = resolveProjectId(projectId);
      const res = await fetch(`${API}/api/projects/${pid}/crons/${cronId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to delete cron: ${res.status}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Cron ${cronId} deleted.` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// ── trigger_cron ──

server.tool(
  "trigger_cron",
  "Manually trigger a cron job to create and dispatch a task immediately.",
  {
    projectId: z.string().optional().describe("Project ID (optional if --project was set)"),
    cronId: z.string().describe("Cron job ID"),
  },
  async ({ projectId, cronId }) => {
    try {
      const pid = resolveProjectId(projectId);
      const res = await fetch(`${API}/api/projects/${pid}/crons/${cronId}/trigger`, {
        method: "POST",
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to trigger cron: ${res.status}` }], isError: true };
      }
      const result = await res.json();
      return { content: [{ type: "text", text: `Triggered cron — created task "${result.task.title}" (${result.task.id})` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`proq-mcp-project fatal: ${err.message}\n`);
  process.exit(1);
});
