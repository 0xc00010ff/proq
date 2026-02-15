import { execSync } from "child_process";
import { getAllProjects } from "./db";
import { spawnPty, killPty } from "./pty-server";

const OPENCLAW = "/opt/homebrew/bin/openclaw";
const MC_API = "http://localhost:3000";
const CLAUDE = process.env.CLAUDE_BIN || "/Users/brian/.local/bin/claude";

export async function dispatchTask(
  projectId: string,
  taskId: string,
  taskTitle: string,
  taskDescription: string
): Promise<string | undefined> {
  // Look up project path
  const projects = await getAllProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    console.error(`[agent-dispatch] project not found: ${projectId}`);
    return undefined;
  }

  // Resolve ~ in path
  const projectPath = project.path.replace(/^~/, process.env.HOME || "~");
  const shortId = taskId.slice(0, 8);
  const terminalTabId = `task-${shortId}`;

  // Build the callback curl that the agent runs when done
  const callbackCurl = `curl -s -X PATCH ${MC_API}/api/projects/${projectId}/tasks/${taskId} -H 'Content-Type: application/json' -d '{"status":"verify","locked":false}'`;

  // Build the agent prompt
  const prompt = `${taskDescription}

When completely finished:
1. git add -A && git commit -m "<descriptive message>"
2. Run this to update the task board: ${callbackCurl}`;

  // Escape for shell
  const escapedPrompt = prompt.replace(/'/g, "'\\''");

  // Build command for PTY
  const cmd = `${CLAUDE} --dangerously-skip-permissions '${escapedPrompt}'`;

  try {
    spawnPty(terminalTabId, cmd, projectPath);
    console.log(
      `[agent-dispatch] launched terminal ${terminalTabId} for task ${taskId}`
    );

    // Notify Slack
    try {
      execSync(
        `${OPENCLAW} message send --channel slack --target C0AEY4GBCGM --message "🚀 *${taskTitle.replace(/"/g, '\\"')}* dispatched"`,
        { timeout: 10_000 }
      );
    } catch (e) {
      console.error(`[agent-dispatch] slack notify failed:`, e);
    }

    return terminalTabId;
  } catch (err) {
    console.error(
      `[agent-dispatch] failed to launch terminal for ${taskId}:`,
      err
    );
    return undefined;
  }
}

export function abortTask(projectId: string, taskId: string) {
  const shortId = taskId.slice(0, 8);
  const terminalTabId = `task-${shortId}`;
  try {
    killPty(terminalTabId);
    console.log(`[agent-dispatch] killed terminal ${terminalTabId}`);
  } catch (err) {
    console.error(
      `[agent-dispatch] failed to kill terminal ${terminalTabId}:`,
      err
    );
  }
}
