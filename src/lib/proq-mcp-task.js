#!/usr/bin/env node
/**
 * Task-scoped proq MCP server — tools for the agent working on a specific task.
 * Spawned per-task by dispatchTask() via --mcp-config.
 *
 * Usage: node proq-mcp-task.js <projectId> <taskId>
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { execSync } = require("child_process");

const API = process.env.PROQ_API || "http://localhost:1337";
const [projectId, taskId] = process.argv.slice(2);

if (!projectId || !taskId) {
  process.stderr.write("Usage: node proq-mcp-task.js <projectId> <taskId>\n");
  process.exit(1);
}

const taskUrl = `${API}/api/projects/${projectId}/tasks/${taskId}`;

const server = new McpServer({
  name: "proq",
  version: "1.0.0",
});

server.tool(
  "write_report",
  "Write a report summarizing the work done on this task. Call after completing meaningful work — restates the problem, outlines the solution and results. Updated in place on follow-ups.",
  {
    title: z.string().describe("Short descriptive title for the report"),
    summary: z.string().describe("Concise summary: restate the problem, outline the solution and results"),
    nextSteps: z.string().optional().describe("Suggested next steps: testing, refinements, or follow-up work"),
  },
  async ({ title, summary, nextSteps }) => {
    try {
      // Read current task to get commit hashes
      const taskRes = await fetch(taskUrl);
      const task = taskRes.ok ? await taskRes.json() : {};

      const report = {
        taskId,
        title,
        summary,
        nextSteps: nextSteps || undefined,
        commitHashes: task.commitHashes || [],
        timestamp: task.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const res = await fetch(`${taskUrl}/report`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to write report: ${res.status}` }], isError: true };
      }

      // Also update task summary/nextSteps for backward compat (UI still reads these)
      await fetch(taskUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, nextSteps: nextSteps || "" }),
      });

      return { content: [{ type: "text", text: "Report written." }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

// Legacy alias — kept for backward compat with older system prompts
server.tool(
  "update_task",
  "Update the task with a summary of work done and move it to Verify for human review.",
  {
    summary: z.string().describe("Newline-separated cumulative summary of all work done so far on this task"),
    nextSteps: z.string().optional().describe("Suggested next steps such as testing, refinements, or follow-up work"),
    agentId: z.string().optional().describe("Agent ID or slug to assign this task to (uses project default if omitted)"),
  },
  async ({ summary, nextSteps, agentId }) => {
    try {
      const res = await fetch(taskUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "verify",
          agentStatus: null,
          summary,
          nextSteps: nextSteps || "",
          ...(agentId ? { agentId } : {}),
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
  "Read the current task state, including any existing report from prior work.",
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

server.tool(
  "list_agents",
  "List all agents in this project.",
  {},
  async () => {
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/agents`);
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to list agents: ${res.status}` }], isError: true };
      }
      const agents = await res.json();
      const lines = agents.map((a) => `- \`${a.slug}\` — ${a.name}${a.role ? `. ${a.role}` : ""}`);
      return { content: [{ type: "text", text: lines.join("\n") || "No agents found." }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

server.tool(
  "create_task",
  "Create a follow-up task in the same project. Use this when you identify work that is outside your current scope but should be done next.",
  {
    title: z.string().describe("Short task title"),
    description: z.string().describe("Task description with details about what needs to be done"),
    mode: z.enum(["auto", "build", "plan", "answer"]).optional().describe("Task mode (default: auto)"),
    agentId: z.string().optional().describe("Agent ID or slug to assign this task to (uses project default if omitted)"),
  },
  async ({ title, description, mode, agentId }) => {
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, mode, agentId }),
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to create task: ${res.status}` }], isError: true };
      }
      const task = await res.json();
      return { content: [{ type: "text", text: `Created follow-up task "${task.title}" (${task.id})` }] };
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
  process.stderr.write(`proq-mcp-task fatal: ${err.message}\n`);
  process.exit(1);
});
