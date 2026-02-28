import { execSync } from "child_process";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getAllProjects,
  getAllTasks,
  getExecutionMode,
  getTask,
  updateTask,
  getSettings,
} from "./db";
import { stripAnsi } from "./utils";
import { createWorktree, removeWorktree } from "./worktree";
import type { TaskAttachment, TaskMode, AgentRenderMode } from "./types";
import {
  startSession as startPrettySession,
  stopSession as stopPrettySession,
  isSessionRunning,
  clearSession,
} from "./pretty-runtime";

const MC_API = "http://localhost:1337";
const CLAUDE = process.env.CLAUDE_BIN || "claude";

/**
 * Build the proq system prompt that tells the agent how to report back.
 * Used via --append-system-prompt in both pretty and terminal modes.
 */
export function buildProqSystemPrompt(
  projectId: string,
  taskId: string,
  mode: TaskMode | undefined,
  projectName?: string,
): string {
  const updateCurl = `curl -s -X PATCH ${MC_API}/api/projects/${projectId}/tasks/${taskId} \\
  -H 'Content-Type: application/json' \\
  -d '{"findings":"<newline-separated cumulative summary of all work done>"}'`;

  const completeCurl = `curl -s -X PATCH ${MC_API}/api/projects/${projectId}/tasks/${taskId} \\
  -H 'Content-Type: application/json' \\
  -d '{"status":"verify","dispatch":null,"findings":"<final summary>","humanSteps":"<steps for the human, or empty string>"}'`;

  const titleCurl = `curl -s -X PATCH ${MC_API}/api/projects/${projectId}/tasks/${taskId} \\
  -H 'Content-Type: application/json' \\
  -d '{"title":"<short 3-8 word title>"}'`;

  const sections: string[] = [
    `## Fulfilling the task

You are working on a task assigned to you by proq, an agentic coding task board.${projectName ? ` The project is **${projectName}**.` : ""}

### Naming the Task
Before starting work, give this task a short descriptive title (3-8 words):
${titleCurl}`,
  ];

  if (mode === "plan" || mode === "answer") {
    const modeLabel = mode === "plan" ? "plan" : "answer";
    sections.push(`### ${mode === "plan" ? "Planning" : "Research"} Mode
This is a ${modeLabel}-only task. Do NOT make any code changes, create files, edit files, or commit anything. Only research, analyze, and report your findings.

### Reporting Results
When finished, report your findings:
${updateCurl}

Your findings should be a clear, concise summary of your research/analysis.`);
  } else {
    sections.push(`### Code Changes
Always commit your code changes unless explicitly asked not to. Stage and commit with a descriptive message after each logical unit of work.

### Reporting Progress
After making substantial changes (committing code, completing a phase of work), update the task board so the human can track progress:
${updateCurl}

**When to report:**
- After committing code changes
- After completing the main request or a significant phase
- After substantial follow-up work that changes the scope of what was done
- When you have meaningful findings or results to share

**When NOT to report:**
- Simple clarifying responses or short answers
- Asking questions back to the user
- Minor adjustments that don't change the overall findings

Findings should be cumulative — each update replaces the previous one, so always include the full picture of everything done so far. Keep it concise but complete.`);
  }

  if (mode !== "plan" && mode !== "answer") {
    sections.push(`### Completing the Task
When the entire task is done and ready for human review, signal completion:
${completeCurl}

This moves the task to the "Verify" column for human review. Only do this when the work is fully complete — not on follow-up responses.`);
  }

  return sections.join("\n\n");
}

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

// ── Singletons attached to globalThis to survive HMR ──
const ga = globalThis as unknown as {
  __proqCleanupTimers?: Map<
    string,
    { timer: NodeJS.Timeout; expiresAt: number }
  >;
  __proqProcessingProjects?: Set<string>;
};
if (!ga.__proqCleanupTimers) ga.__proqCleanupTimers = new Map();
if (!ga.__proqProcessingProjects) ga.__proqProcessingProjects = new Set();

const cleanupTimers = ga.__proqCleanupTimers;

export function scheduleCleanup(projectId: string, taskId: string) {
  // Cancel any existing timer for this task
  cancelCleanup(taskId);

  const expiresAt = Date.now() + CLEANUP_DELAY_MS;
  const shortId = taskId.slice(0, 8);
  const tmuxSession = `mc-${shortId}`;

  const timer = setTimeout(async () => {
    try {
      const socketLogPath = `/tmp/proq/${tmuxSession}.sock.log`;

      // Kill tmux session first — this sends SIGTERM to bridge, which writes .log file
      try {
        execSync(`tmux kill-session -t '${tmuxSession}'`, { timeout: 5_000 });
        console.log(`[agent-cleanup] killed tmux session ${tmuxSession}`);
      } catch {
        // Already gone
      }

      // Wait for bridge to write the log file
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Read scrollback from bridge's log file
      let output = "";
      try {
        if (existsSync(socketLogPath)) {
          output = readFileSync(socketLogPath, "utf-8");
          output = stripAnsi(output);
          unlinkSync(socketLogPath);
        }
      } catch {
        // Log file may not exist
      }

      // Save to agentLog
      if (output.trim()) {
        await updateTask(projectId, taskId, { agentLog: output.trim() });
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
    console.log(
      `[agent-cleanup] cancelled cleanup for task ${taskId.slice(0, 8)}`,
    );
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
  taskTitle: string | undefined,
  taskDescription: string,
  mode?: TaskMode,
  attachments?: TaskAttachment[],
  renderMode?: AgentRenderMode,
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
    console.error(
      `[agent-dispatch] project path does not exist: ${projectPath}`,
    );
    return undefined;
  }

  const shortId = taskId.slice(0, 8);
  const terminalTabId = `task-${shortId}`;
  const tmuxSession = `mc-${shortId}`;

  // Check if running in parallel mode — create worktree for parallel code tasks
  const executionMode = await getExecutionMode(projectId);
  let effectivePath = projectPath;

  if (executionMode === "parallel" && mode !== "plan" && mode !== "answer") {
    try {
      const worktreePath = createWorktree(projectPath, shortId);
      const branch = `proq/${shortId}`;
      await updateTask(projectId, taskId, { worktreePath, branch });
      effectivePath = worktreePath;
    } catch (err) {
      console.error(
        `[agent-dispatch] failed to create worktree for ${shortId}:`,
        err,
      );
      // Fall back to shared directory
    }
  }

  const heading = taskTitle
    ? `# ${taskTitle}\n\n${taskDescription}`
    : taskDescription;

  // ── Pretty mode: dispatch via SDK ──
  if (renderMode === "pretty") {
    let prompt: string;
    if (mode === "plan") {
      prompt = `IMPORTANT: Do NOT make any code changes. Do NOT create, edit, or delete any files. Do NOT commit anything. Only research and write the plan.\n${heading}`;
    } else if (mode === "answer") {
      prompt = `${heading}\n\nIMPORTANT: Do NOT make any code changes. Do NOT create, edit, or delete any files. Do NOT commit anything. Only research and answer the question.`;
    } else {
      prompt = `${heading}\n\nWhen completely finished, stage and commit the changes with a descriptive message.`;
    }

    // Append image attachments
    if (attachments?.length) {
      const imageFiles: string[] = [];
      const attachDir = join(
        tmpdir(),
        "proq-prompts",
        `pretty-${shortId}-attachments`,
      );
      mkdirSync(attachDir, { recursive: true });
      for (const att of attachments) {
        if (att.dataUrl && att.type.startsWith("image/")) {
          const match = att.dataUrl.match(/^data:[^;]+;base64,(.+)$/);
          if (match) {
            const filePath = join(attachDir, att.name);
            writeFileSync(filePath, Buffer.from(match[1], "base64"));
            imageFiles.push(filePath);
          }
        }
      }
      if (imageFiles.length > 0) {
        prompt += `\n\n## Attached Images\nThe following image files are attached to this task. Use your Read tool to view them:\n${imageFiles.map((f) => `- ${f}`).join("\n")}\n`;
      }
    }

    const proqSystemPrompt = buildProqSystemPrompt(projectId, taskId, mode, project.name);

    try {
      await startPrettySession(projectId, taskId, prompt, effectivePath, {
        proqSystemPrompt,
      });
      console.log(
        `[agent-dispatch] launched pretty session for task ${taskId}`,
      );
      notify(
        `🚀 *${(taskTitle || "task").replace(/"/g, '\\"')}* dispatched (pretty)`,
      );
      return terminalTabId;
    } catch (err) {
      console.error(
        `[agent-dispatch] failed to launch pretty session for ${taskId}:`,
        err,
      );
      return undefined;
    }
  }

  // ── Terminal mode: dispatch via tmux (existing behavior) ──

  let prompt: string;

  if (mode === "plan") {
    prompt = `IMPORTANT: Do NOT make any code changes. Do NOT create, edit, or delete any files. Do NOT commit anything. Only research and write the plan. Provide your answer as findings.\n${heading}`;
  } else if (mode === "answer") {
    prompt = `${heading}\n\nIMPORTANT: Do NOT make any code changes. Do NOT create, edit, or delete any files. Do NOT commit anything. Only research and answer the question. Provide your answer as findings.`;
  } else {
    prompt = `${heading}\n\nWhen completely finished, stage and commit the changes with a descriptive message.`;
  }

  const proqSystemPrompt = buildProqSystemPrompt(projectId, taskId, mode, project.name);

  // Write image attachments to temp files so the agent can read them
  const imageFiles: string[] = [];
  if (attachments?.length) {
    const attachDir = join(
      tmpdir(),
      "proq-prompts",
      `${tmuxSession}-attachments`,
    );
    mkdirSync(attachDir, { recursive: true });
    for (const att of attachments) {
      if (att.dataUrl && att.type.startsWith("image/")) {
        const match = att.dataUrl.match(/^data:[^;]+;base64,(.+)$/);
        if (match) {
          const filePath = join(attachDir, att.name);
          writeFileSync(filePath, Buffer.from(match[1], "base64"));
          imageFiles.push(filePath);
        }
      }
    }
    if (imageFiles.length > 0) {
      prompt += `\n## Attached Images\nThe following image files are attached to this task. Use your Read tool to view them:\n${imageFiles.map((f) => `- ${f}`).join("\n")}\n`;
    }
  }

  // Write prompt + system prompt to temp files to avoid shell escaping issues
  const promptDir = join(tmpdir(), "proq-prompts");
  mkdirSync(promptDir, { recursive: true });
  const promptFile = join(promptDir, `${tmuxSession}.md`);
  const systemPromptFile = join(promptDir, `${tmuxSession}-system.md`);
  const launcherFile = join(promptDir, `${tmuxSession}.sh`);
  writeFileSync(promptFile, prompt, "utf-8");
  writeFileSync(systemPromptFile, proqSystemPrompt, "utf-8");
  writeFileSync(
    launcherFile,
    `#!/bin/bash\nexec env -u CLAUDECODE -u PORT ${CLAUDE} --dangerously-skip-permissions --append-system-prompt "$(cat '${systemPromptFile}')" "$(cat '${promptFile}')"\n`,
    "utf-8",
  );

  // Ensure bridge socket directory exists
  mkdirSync("/tmp/proq", { recursive: true });
  const bridgePath = join(process.cwd(), "src/lib/proq-bridge.js");
  const socketPath = `/tmp/proq/${tmuxSession}.sock`;

  // Launch via tmux with bridge — session survives server restarts, bridge exposes PTY over unix socket
  const tmuxCmd = `tmux new-session -d -s '${tmuxSession}' -c '${effectivePath}' node '${bridgePath}' '${socketPath}' '${launcherFile}'`;

  try {
    execSync(tmuxCmd, { timeout: 10_000 });
    console.log(
      `[agent-dispatch] launched tmux session ${tmuxSession} for task ${taskId}`,
    );

    notify(`🚀 *${(taskTitle || "task").replace(/"/g, '\\"')}* dispatched`);

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
  const task = await getTask(projectId, taskId);

  if (task?.renderMode === "pretty") {
    // Pretty mode: abort via SDK
    stopPrettySession(taskId);
    clearSession(taskId);
    console.log(`[agent-dispatch] stopped pretty session for task ${taskId}`);
  } else {
    // Terminal mode: kill tmux
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

    // Clean up bridge socket and log files
    const socketPath = `/tmp/proq/${tmuxSession}.sock`;
    const logPath = socketPath + ".log";
    try {
      if (existsSync(socketPath)) unlinkSync(socketPath);
    } catch {}
    try {
      if (existsSync(logPath)) unlinkSync(logPath);
    } catch {}
  }

  // Clean up worktree if task had one (shared for both modes)
  if (task?.worktreePath) {
    const shortId = taskId.slice(0, 8);
    const projects = await getAllProjects();
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      const projectPath = project.path.replace(/^~/, process.env.HOME || "~");
      removeWorktree(projectPath, shortId);
      await updateTask(projectId, taskId, {
        worktreePath: undefined,
        branch: undefined,
      });
    }
  }
}

export function isSessionAlive(taskId: string): boolean {
  // Check pretty runtime first
  if (isSessionRunning(taskId)) return true;

  // Fall back to tmux check
  const shortId = taskId.slice(0, 8);
  const tmuxSession = `mc-${shortId}`;
  try {
    execSync(`tmux has-session -t '${tmuxSession}'`, { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Determine the right initial dispatch state for a task moving to in-progress.
 * "starting" if it will be dispatched immediately, "queued" if it must wait.
 */
export async function getInitialDispatch(
  projectId: string,
  excludeTaskId?: string,
): Promise<"queued" | "starting"> {
  const mode = await getExecutionMode(projectId);
  if (mode === "parallel") return "starting";

  const columns = await getAllTasks(projectId);
  const hasActive = columns["in-progress"].some(
    (t) =>
      t.id !== excludeTaskId &&
      (t.dispatch === "starting" || t.dispatch === "running"),
  );
  return hasActive ? "queued" : "starting";
}

const processingProjects = ga.__proqProcessingProjects;

export async function processQueue(projectId: string): Promise<void> {
  if (processingProjects.has(projectId)) {
    console.log(`[processQueue] skipped (already processing ${projectId})`);
    return;
  }
  processingProjects.add(projectId);

  try {
    const mode = await getExecutionMode(projectId);
    const columns = await getAllTasks(projectId);
    const inProgress = columns["in-progress"];

    // Array order IS priority — no sort needed
    const pending = inProgress.filter(
      (t) => t.dispatch === "queued" || t.dispatch === "starting",
    );

    const running = inProgress.filter((t) => t.dispatch === "running");

    console.log(
      `[processQueue] ${projectId}: mode=${mode} running=${running.length} pending=${pending.length}`,
    );

    if (mode === "sequential") {
      if (running.length === 0 && pending.length > 0) {
        const next = pending[0];
        console.log(
          `[processQueue] launching ${next.id.slice(0, 8)} "${next.title || next.description.slice(0, 40)}"`,
        );
        if (next.dispatch !== "starting") {
          await updateTask(projectId, next.id, { dispatch: "starting" });
        }
        const result = await dispatchTask(
          projectId,
          next.id,
          next.title,
          next.description,
          next.mode,
          next.attachments,
          next.renderMode,
        );
        if (result) {
          await updateTask(projectId, next.id, { dispatch: "running" });
        } else {
          console.log(
            `[processQueue] dispatch failed for ${next.id.slice(0, 8)}, rolling back`,
          );
          await updateTask(projectId, next.id, { dispatch: "queued" });
        }
      } else if (pending.length > 0) {
        console.log(
          `[processQueue] ${running.length} task(s) running, ${pending.length} waiting`,
        );
      }
    } else {
      // parallel: launch all pending
      for (const task of pending) {
        console.log(
          `[processQueue] launching ${task.id.slice(0, 8)} "${task.title || task.description.slice(0, 40)}" (parallel)`,
        );
        if (task.dispatch !== "starting") {
          await updateTask(projectId, task.id, { dispatch: "starting" });
        }
        const result = await dispatchTask(
          projectId,
          task.id,
          task.title,
          task.description,
          task.mode,
          task.attachments,
          task.renderMode,
        );
        if (result) {
          await updateTask(projectId, task.id, { dispatch: "running" });
        } else {
          console.log(
            `[processQueue] dispatch failed for ${task.id.slice(0, 8)}, rolling back`,
          );
          await updateTask(projectId, task.id, { dispatch: "queued" });
        }
      }
    }
  } catch (err) {
    console.error(`[processQueue] error for project ${projectId}:`, err);
  } finally {
    processingProjects.delete(projectId);
  }
}
