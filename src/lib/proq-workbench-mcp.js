#!/usr/bin/env node
/**
 * proq Workbench MCP stdio server — exposes task/project management tools to workbench agents.
 * Spawned per-workbench-agent-tab session via --mcp-config.
 *
 * Usage: node proq-workbench-mcp.js <projectId>
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const API = "http://localhost:1337";
const [projectId] = process.argv.slice(2);

if (!projectId) {
  process.stderr.write("Usage: node proq-workbench-mcp.js <projectId>\n");
  process.exit(1);
}

const tasksUrl = `${API}/api/projects/${projectId}/tasks`;
const projectUrl = `${API}/api/projects/${projectId}`;

const server = new McpServer({
  name: "proq_workbench",
  version: "1.0.0",
});

server.tool(
  "list_tasks",
  "List all tasks for the current project, optionally filtered by status column.",
  {
    status: z.enum(["todo", "in-progress", "verify", "done"]).optional().describe(
      "Filter tasks by status column. If omitted, returns all tasks in all columns.",
    ),
  },
  async ({ status }) => {
    try {
      const res = await fetch(tasksUrl);
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to list tasks: ${res.status}` }], isError: true };
      }
      const columns = await res.json();
      if (status) {
        const tasks = columns[status] || [];
        return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(columns, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

server.tool(
  "create_task",
  "Create a new task in the project's Todo column.",
  {
    title: z.string().describe("Short task title"),
    description: z.string().describe("Detailed task description / instructions for the agent"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("Task priority"),
    mode: z.enum(["auto", "answer", "plan", "build"]).optional().describe(
      "Task mode: auto (default — code changes), answer (research only, no code), plan (planning), build (code changes with explicit build step)",
    ),
  },
  async ({ title, description, priority, mode }) => {
    try {
      const body = { title, description };
      if (priority) body.priority = priority;
      if (mode) body.mode = mode;
      const res = await fetch(tasksUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        return { content: [{ type: "text", text: `Failed to create task: ${res.status} ${text}` }], isError: true };
      }
      const task = await res.json();
      return { content: [{ type: "text", text: `Task created (ID: ${task.id}):\n${JSON.stringify(task, null, 2)}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

server.tool(
  "get_task",
  "Get details of a specific task by ID.",
  {
    taskId: z.string().describe("The task ID"),
  },
  async ({ taskId }) => {
    try {
      const res = await fetch(`${tasksUrl}/${taskId}`);
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

server.tool(
  "update_task",
  "Update a task's fields such as status, title, description, or priority.",
  {
    taskId: z.string().describe("The task ID"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    status: z.enum(["todo", "in-progress", "verify", "done"]).optional().describe(
      "New status — moves the task to the specified column. Setting to 'in-progress' will queue it for agent dispatch.",
    ),
    priority: z.enum(["low", "medium", "high"]).optional().describe("New priority"),
  },
  async ({ taskId, title, description, status, priority }) => {
    try {
      const body = {};
      if (title !== undefined) body.title = title;
      if (description !== undefined) body.description = description;
      if (status !== undefined) body.status = status;
      if (priority !== undefined) body.priority = priority;
      const res = await fetch(`${tasksUrl}/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        return { content: [{ type: "text", text: `Failed to update task: ${res.status} ${text}` }], isError: true };
      }
      const task = await res.json();
      return { content: [{ type: "text", text: `Task updated:\n${JSON.stringify(task, null, 2)}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

server.tool(
  "get_project",
  "Get info about the current project (name, path, status, serverUrl, etc.).",
  {},
  async () => {
    try {
      const res = await fetch(projectUrl);
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to get project: ${res.status}` }], isError: true };
      }
      const project = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(project, null, 2) }] };
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
  process.stderr.write(`proq-workbench-mcp fatal: ${err.message}\n`);
  process.exit(1);
});
