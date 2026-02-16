import { execSync } from "child_process";
import { getAllProjects, getAllTasks, getExecutionMode } from "./db";
import type { TaskMode } from "./types";

const OPENCLAW = "/opt/homebrew/bin/openclaw";
const MC_API = "http://localhost:7331";
const CLAUDE = process.env.CLAUDE_BIN || "/Users/brian/.local/bin/claude";

export async function dispatchTask(
  projectId: string,
  taskId: string,
  taskTitle: string,
  taskDescription: string,
  mode?: TaskMode,
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

  // Check if running in parallel mode
  const executionMode = await getExecutionMode(projectId);
  const parallelWarning = executionMode === "parallel"
    ? `\nNOTE: Multiple agents may be running on this project in parallel. When committing, only stage the specific files you changed — do not use "git add -A" or "git add .".\n`
    : "";

  // Build the agent prompt
  const callbackCurl = `curl -s -X PATCH ${MC_API}/api/projects/${projectId}/tasks/${taskId} \\
  -H 'Content-Type: application/json' \\
  -d '{"status":"verify","locked":false,"findings":"<newline-separated summary of what you did and found>","humanSteps":"<any steps the human should take to verify, or empty string>"}'`;

  let prompt: string;
  let claudeFlags: string;

  if (mode === "plan") {
    prompt = `\
IMPORTANT: Do NOT make any code changes. Do NOT create, edit, or delete any files. Do NOT commit anything. Only research and write the plan. Provide your answer as findings.
${parallelWarning}
# ${taskTitle}

${taskDescription}

When completely finished, commit and signal complete:
1. If code was changed, stage and commit the changes with a descriptive message.
2. Signal back to the main process to update the task board, including the results/summary ("findings") and human steps (if there are any operational steps the user should take to verify, or complete the task)
${callbackCurl}
3. After signaling, change to the main project directory for any follow-up work:
cd ${projectPath}`;
    claudeFlags = "--dangerously-skip-permissions";
  } else if (mode === "answer") {
    prompt = `# ${taskTitle}

${taskDescription}

IMPORTANT: Do NOT make any code changes. Do NOT create, edit, or delete any files. Do NOT commit anything. Only research and answer the question. Provide your answer as findings.
${parallelWarning}
When completely finished, signal complete:
${callbackCurl}

After signaling, change to the main project directory for any follow-up work:
cd ${projectPath}`;
    claudeFlags = "--dangerously-skip-permissions";
  } else {
    prompt = `# ${taskTitle}

${taskDescription}
${parallelWarning}
When completely finished, commit and signal complete:
1. If code was changed, stage and commit the changes with a descriptive message.
2. Signal back to the main process to update the task board, including the results/summary ("findings") and human steps (if there are any operational steps the user should take to verify, or complete the task)
${callbackCurl}
3. After signaling, change to the main project directory for any follow-up work:
cd ${projectPath}`;
    claudeFlags = "--dangerously-skip-permissions";
  }

  // Escape for shell
  const escapedPrompt = prompt.replace(/'/g, "'\\''");

  // Launch via tmux — session survives server restarts
  const tmuxCmd = `tmux new-session -d -s '${tmuxSession}' -c '${projectPath}' env -u CLAUDECODE ${CLAUDE} ${claudeFlags} '${escapedPrompt}'`;

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

export async function abortTask(projectId: string, taskId: string) {
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

export function isTaskDispatched(taskId: string): boolean {
  const shortId = taskId.slice(0, 8);
  const tmuxSession = `mc-${shortId}`;
  try {
    execSync(`tmux has-session -t '${tmuxSession}'`, { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

export async function shouldDispatch(projectId: string): Promise<boolean> {
  const mode = await getExecutionMode(projectId);
  if (mode === "parallel") return true;

  // Sequential: check if any task is already actively dispatched
  const tasks = await getAllTasks(projectId);
  const inProgressTasks = tasks.filter(
    (t) => t.status === "in-progress" && t.locked,
  );
  return !inProgressTasks.some((t) => isTaskDispatched(t.id));
}

export async function dispatchNextQueued(projectId: string): Promise<void> {
  const mode = await getExecutionMode(projectId);
  if (mode !== "sequential") return;

  const tasks = await getAllTasks(projectId);
  const queued = tasks
    .filter(
      (t) => t.status === "in-progress" && t.locked && !isTaskDispatched(t.id),
    )
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (queued.length === 0) return;

  const next = queued[0];
  console.log(`[agent-dispatch] auto-dispatching next queued task: ${next.id}`);
  await dispatchTask(
    projectId,
    next.id,
    next.title,
    next.description,
    next.mode,
  );
}
