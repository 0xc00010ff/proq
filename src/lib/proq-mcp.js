#!/usr/bin/env node
/**
 * proq MCP stdio server — exposes report_findings and read_task tools to agents.
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
  "report_findings",
  "Report progress on the current task. Findings should be a cumulative summary of ALL work done so far on this task — each report replaces the previous one. Call this after committing code, completing a phase, or finishing substantial work. Do NOT call for minor tweaks or clarifications.",
  {
    findings: z.string().describe("Newline-separated cumulative summary of all work done so far on this task"),
    humanSteps: z.string().optional().describe("Newline-separated action items the human needs to do, if any"),
  },
  async ({ findings, humanSteps }) => {
    try {
      const res = await fetch(taskUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findings, ...(humanSteps ? { humanSteps } : {}) }),
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to update task: ${res.status}` }], isError: true };
      }
      return { content: [{ type: "text", text: "Task findings updated." }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

server.tool(
  "complete_task",
  "Signal that the task is fully complete and ready for human review. This moves the task to the Verify column. Only call when ALL work is done — not for intermediate progress.",
  {
    findings: z.string().optional().describe("Final cumulative summary of all work done. Only needed if you haven't already called report_findings with a complete summary."),
    humanSteps: z.string().optional().describe("Newline-separated action items for human review, if any"),
  },
  async ({ findings, humanSteps }) => {
    try {
      const res = await fetch(taskUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "verify",
          dispatch: null,
          ...(findings ? { findings } : {}),
          ...(humanSteps ? { humanSteps } : {}),
        }),
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to complete task: ${res.status}` }], isError: true };
      }
      return { content: [{ type: "text", text: "Task moved to Verify." }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

server.tool(
  "read_task",
  "Read the current task state, including any existing findings from prior work. Use this before reporting findings to see what has already been reported, so you can write a cumulative summary.",
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
