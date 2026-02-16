import { execSync } from "child_process";
import { getAllProjects } from "./db";

const OPENCLAW = "/opt/homebrew/bin/openclaw";
const MC_API = "http://localhost:7331";
const CLAUDE = process.env.CLAUDE_BIN || "/Users/brian/.local/bin/claude";

export async function dispatchTask(
  projectId: string,
  taskId: string,
  taskTitle: string,
  taskDescription: string,
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
  const tmuxSession = `mc-${shortId}`;

  // Build the agent prompt
  const prompt = `# ${taskTitle}

${taskDescription}

When completely finished, commit and signal complete:
1. If code was changed, stage and commit the changes with a descriptive message.
2. Signal back to the main process to update the task board, including the results/summary ("findings") and human steps (if there are any operational steps the user should take to verify, or complete the task)
curl -s -X PATCH ${MC_API}/api/projects/${projectId}/tasks/${taskId} \\
  -H 'Content-Type: application/json' \\
  -d '{"status":"verify","locked":false,"findings":"<newline-separated summary of what you did and found>","humanSteps":"<any steps the human should take to verify, or empty string>"}'`;

  // Escape for shell
  const escapedPrompt = prompt.replace(/'/g, "'\\''");

  // Launch via tmux — session survives server restarts
  const tmuxCmd = `tmux new-session -d -s '${tmuxSession}' -c '${projectPath}' env -u CLAUDECODE ${CLAUDE} --dangerously-skip-permissions '${escapedPrompt}'`;

  try {
    execSync(tmuxCmd, { timeout: 10_000 });
    console.log(
      `[agent-dispatch] launched tmux session ${tmuxSession} for task ${taskId}`,
    );

    // Notify Slack
    try {
      execSync(
        `${OPENCLAW} message send --channel slack --target C0AEY4GBCGM --message "🚀 *${taskTitle.replace(/"/g, '\\"')}* dispatched"`,
        { timeout: 10_000 },
      );
    } catch (e) {
      console.error(`[agent-dispatch] slack notify failed:`, e);
    }

    return terminalTabId;
  } catch (err) {
    console.error(
      `[agent-dispatch] failed to launch tmux session for ${taskId}:`,
      err,
    );
    return undefined;
  }
}

export function abortTask(projectId: string, taskId: string) {
  const shortId = taskId.slice(0, 8);
  const tmuxSession = `mc-${shortId}`;
  try {
    execSync(`tmux kill-session -t '${tmuxSession}'`, { timeout: 5_000 });
    console.log(`[agent-dispatch] killed tmux session ${tmuxSession}`);
  } catch (err) {
    console.error(
      `[agent-dispatch] failed to kill tmux session ${tmuxSession}:`,
      err,
    );
  }
}
