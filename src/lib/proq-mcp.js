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
const { execSync } = require("child_process");

const API = process.env.PROQ_API || "http://localhost:1337";
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
  "set_live_url",
  "Set the live preview URL for the project. Use this after starting a dev server so the human can see the running app in the Live tab. The Live tab will automatically refresh to show the new URL.",
  {
    url: z.string().describe("The local URL of the running dev server, e.g. http://localhost:3000"),
  },
  async ({ url }) => {
    try {
      const res = await fetch(`${API}/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverUrl: url, _source: "agent" }),
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

server.tool(
  "update_task",
  "Update the task with a summary of work done and move it to Verify for human review. Call this on initial completion and again if follow-up work leads to material changes or new summary. Each call replaces the previous summary.",
  {
    summary: z.string().describe("Newline-separated cumulative summary of all work done so far on this task"),
    nextSteps: z.string().optional().describe("Suggested next steps such as testing, refinements, or follow-up work"),
  },
  async ({ summary, nextSteps }) => {
    try {
      const res = await fetch(taskUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "verify",
          agentStatus: null,
          summary,
          nextSteps: nextSteps || "",
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
  "Read the current task state, including any existing summary from prior work. Use this before updating to see what has already been reported, so you can write a cumulative summary.",
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

/**
 * Resolve the working directory for git operations.
 * In parallel mode, agents work in a worktree; otherwise in the project directory.
 */
async function resolveWorkDir() {
  const taskRes = await fetch(taskUrl);
  if (!taskRes.ok) return null;
  const task = await taskRes.json();
  if (task.worktreePath) return task.worktreePath;

  const projRes = await fetch(`${API}/api/projects/${projectId}`);
  if (!projRes.ok) return null;
  const proj = await projRes.json();
  return proj.path?.replace(/^~/, process.env.HOME || "~") || null;
}

server.tool(
  "commit_changes",
  "Stage and commit all current changes. Use after each logical unit of work to keep your progress saved.",
  {
    message: z.string().describe("Descriptive commit message summarizing the changes"),
  },
  async ({ message }) => {
    try {
      const workDir = await resolveWorkDir();
      if (!workDir) {
        return { content: [{ type: "text", text: "Could not resolve working directory." }], isError: true };
      }

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

      // Extract short hash from commit output
      const hashMatch = result.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
      const hash = hashMatch ? hashMatch[1] : "";

      // Record commit hash on the task for accurate commit tracking
      if (hash) {
        try {
          const taskRes = await fetch(taskUrl);
          if (taskRes.ok) {
            const task = await taskRes.json();
            const hashes = task.commitHashes || [];
            hashes.push(hash);
            await fetch(taskUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ commitHashes: hashes }),
            });
          }
        } catch {
          // Best effort — don't fail the commit over tracking
        }
      }

      return { content: [{ type: "text", text: `Committed${hash ? ` (${hash})` : ""}: ${message}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Commit failed: ${err.message}` }], isError: true };
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
