#!/usr/bin/env node
/**
 * proq MCP stdio server — exposes read_task and update_task tools to agents.
 * Spawned per-task by dispatchTask() via --mcp-config.
 *
 * Usage: node proq-mcp.js <projectId> <taskId>
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const API = "http://localhost:1337";
const [projectId, taskId] = process.argv.slice(2);

if (!projectId || !taskId) {
  process.stderr.write("Usage: node proq-mcp.js <projectId> <taskId>\n");
  process.exit(1);
}

const taskUrl = `${API}/api/projects/${projectId}/tasks/${taskId}`;

const server = new McpServer({
  name: "proq",
  version: "1.0.0",
});

server.tool(
  "update_task",
  "Update the task with a summary of work done and move it to Verify for human review. Call this on initial completion and again if follow-up work leads to material changes or new findings. Each call replaces the previous summary.",
  {
    findings: z.string().describe("Newline-separated cumulative summary of all work done so far on this task"),
    humanSteps: z.string().optional().describe("Newline-separated action items the human needs to do, if any"),
  },
  async ({ findings, humanSteps }) => {
    try {
      const res = await fetch(taskUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "verify",
          dispatch: null,
          findings,
          humanSteps: humanSteps || "",
        }),
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to update task: ${res.status}` }], isError: true };
      }
      return { content: [{ type: "text", text: "Task updated and moved to Verify." }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

server.tool(
  "read_task",
  "Read the current task state, including any existing findings from prior work. Use this before updating to see what has already been reported, so you can write a cumulative summary.",
  {},
  async () => {
    try {
      const res = await fetch(taskUrl);
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to read task: ${res.status}` }], isError: true };
      }
      const task = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
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
  process.stderr.write(`proq-mcp fatal: ${err.message}\n`);
  process.exit(1);
});
