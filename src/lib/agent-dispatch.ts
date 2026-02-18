import { execSync } from "child_process";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getAllProjects, getAllTasks, getExecutionMode, updateTask } from "./db";
import { stripAnsi } from "./utils";
import type { TaskMode } from "./types";

const MC_API = "http://localhost:7331";
const CLAUDE = process.env.CLAUDE_BIN || "claude";

export function notify(message: string) {
  const bin = process.env.OPENCLAW_BIN;
  const channel = process.env.SLACK_CHANNEL;
  if (!bin || !channel) return;
  try {
    execSync(
      `${bin} message send --channel slack --target ${channel} --message "${message}"`,
      { timeout: 10_000 },
    );
  } catch (e) {
    console.error(`[notify] failed:`, e);
  }
}
const CLEANUP_DELAY_MS = 60 * 60 * 1000; // 1 hour

// Track scheduled cleanup timers for completed agent sessions
const cleanupTimers = new Map<string, { timer: NodeJS.Timeout; expiresAt: number }>();

export function scheduleCleanup(projectId: string, taskId: string) {
  // Cancel any existing timer for this task
  cancelCleanup(taskId);

  const expiresAt = Date.now() + CLEANUP_DELAY_MS;
  const shortId = taskId.slice(0, 8);
  const tmuxSession = `mc-${shortId}`;

  const timer = setTimeout(async () => {
    try {
      // Capture terminal scrollback before killing
      let output = "";
      try {
        output = execSync(
          `tmux capture-pane -t '${tmuxSession}' -p -S -200`,
          { timeout: 5_000, encoding: "utf-8" }
        );
        output = stripAnsi(output);
      } catch {
        // Session may already be gone
      }

      // Save to agentLog
      if (output.trim()) {
        await updateTask(projectId, taskId, { agentLog: output.trim() });
      }

      // Kill the tmux session
      try {
        execSync(`tmux kill-session -t '${tmuxSession}'`, { timeout: 5_000 });
        console.log(`[agent-cleanup] killed tmux session ${tmuxSession}`);
      } catch {
        // Already gone
      }
    } catch (err) {
      console.error(`[agent-cleanup] failed for ${taskId}:`, err);
    } finally {
      cleanupTimers.delete(taskId);
    }
  }, CLEANUP_DELAY_MS);

  cleanupTimers.set(taskId, { timer, expiresAt });
  console.log(`[agent-cleanup] scheduled cleanup for ${tmuxSession} in 1 hour`);
}

export function cancelCleanup(taskId: string) {
  const entry = cleanupTimers.get(taskId);
  if (entry) {
    clearTimeout(entry.timer);
    cleanupTimers.delete(taskId);
    console.log(`[agent-cleanup] cancelled cleanup for task ${taskId.slice(0, 8)}`);
  }
}

export function getCleanupExpiresAt(taskId: string): number | null {
  return cleanupTimers.get(taskId)?.expiresAt ?? null;
}

export function getAllCleanupTimes(): Record<string, number> {
  const result: Record<string, number> = {};
  cleanupTimers.forEach((entry, taskId) => {
    result[taskId] = entry.expiresAt;
  });
  return result;
}

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

  if (!existsSync(projectPath)) {
    console.error(`[agent-dispatch] project path does not exist: ${projectPath}`);
    return undefined;
  }

  const shortId = taskId.slice(0, 8);
  const terminalTabId = `task-${shortId}`;
  const tmuxSession = `mc-${shortId}`;

  // Check if running in parallel mode
  const executionMode = await getExecutionMode(projectId);
  const parallelWarning =
    executionMode === "parallel"
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
`;
    claudeFlags = "--dangerously-skip-permissions";
  } else if (mode === "answer") {
    prompt = `# ${taskTitle}

${taskDescription}

IMPORTANT: Do NOT make any code changes. Do NOT create, edit, or delete any files. Do NOT commit anything. Only research and answer the question. Provide your answer as findings.
${parallelWarning}
When completely finished, signal complete:
${callbackCurl}
`;
    claudeFlags = "--dangerously-skip-permissions";
  } else {
    prompt = `# ${taskTitle}

${taskDescription}
${parallelWarning}
When completely finished, commit and signal complete:
1. If code was changed, stage and commit the changes with a descriptive message.
2. Signal back to the main process to update the task board, including the results/summary ("findings") and human steps (if there are any operational steps the user should take to verify, or complete the task)
${callbackCurl}
`;
    claudeFlags = "--dangerously-skip-permissions";
  }

  // Write prompt to temp file to avoid shell escaping issues with complex descriptions
  const promptDir = join(tmpdir(), "proq-prompts");
  mkdirSync(promptDir, { recursive: true });
  const promptFile = join(promptDir, `${tmuxSession}.md`);
  const launcherFile = join(promptDir, `${tmuxSession}.sh`);
  writeFileSync(promptFile, prompt, "utf-8");
  writeFileSync(launcherFile, `#!/bin/bash\nexec env -u CLAUDECODE ${CLAUDE} ${claudeFlags} "$(cat '${promptFile}')"\n`, "utf-8");

  // Launch via tmux — session survives server restarts
  const tmuxCmd = `tmux new-session -d -s '${tmuxSession}' -c '${projectPath}' bash '${launcherFile}'`;

  try {
    execSync(tmuxCmd, { timeout: 10_000 });
    console.log(
      `[agent-dispatch] launched tmux session ${tmuxSession} for task ${taskId}`,
    );

    notify(`🚀 *${taskTitle.replace(/"/g, '\\"')}* dispatched`);

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
