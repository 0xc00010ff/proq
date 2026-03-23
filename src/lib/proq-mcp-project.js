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
  },
  async ({ projectId, title, description, mode }) => {
    try {
      const pid = resolveProjectId(projectId);
      const res = await fetch(`${API}/api/projects/${pid}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, mode }),
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`proq-mcp-project fatal: ${err.message}\n`);
  process.exit(1);
});
