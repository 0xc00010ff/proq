import { execSync, spawn } from "child_process";
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
  getProjectDefaultBranch,
} from "./db";
import { stripAnsi, resolveProjectPath } from "./utils";
import { emitTaskUpdate } from "./task-events";
import { createWorktree, removeWorktree, getCurrentBranch } from "./worktree";
import type { TaskAttachment, TaskMode, AgentRenderMode } from "./types";
import {
  startSession,
  stopSession,
  isSessionRunning,
  clearSession,
} from "./agent-session";
import { getClaudeBin } from "./claude-bin";


/**
 * Write an MCP config JSON file that tells Claude to connect to the proq
 * stdio MCP server, scoped to a specific project/task.
 * Returns the path to the config file.
 */
export function writeMcpConfig(projectId: string, taskId: string): string {
  const promptDir = join(tmpdir(), "proq-prompts");
  mkdirSync(promptDir, { recursive: true });
  const mcpScriptPath = join(process.cwd(), "src/lib/proq-mcp.js");
  const configPath = join(promptDir, `mcp-${taskId.slice(0, 8)}.json`);
  const config = {
    mcpServers: {
      proq: {
        command: "node",
        args: [mcpScriptPath, projectId, taskId],
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config), "utf-8");
  return configPath;
}

/**
 * Build the proq system prompt that tells the agent how to report back.
 * Used via --append-system-prompt in both structured and CLI modes.
 */
export function buildProqSystemPrompt(
  projectId: string,
  taskId: string,
  mode: TaskMode | undefined,
  projectName?: string,
  options?: { isCronTask?: boolean },
): string {
  const cronPreamble = options?.isCronTask
    ? `\n\nThis is a **scheduled task** (cron job) running automatically.${projectName ? ` Project: **${projectName}**.` : ""} There is no human actively watching — be thorough, self-contained, and report clear results. If you encounter errors or ambiguity, document them in your summary rather than asking questions.`
    : "";

  const modeLabels: Record<string, string> = {
    auto: "Auto (full autonomy)",
    build: "Build (code changes expected)",
    plan: "Plan (propose a plan before acting)",
    answer: "Answer (research only, no code changes)",
  };
  const modeLabel = modeLabels[mode || "auto"] || modeLabels.auto;

  const sections: string[] = [
    `## Fulfilling the task

You are working on a task assigned to you by proq, an agentic coding task board.${projectName ? ` The project is **${projectName}**.` : ""}${cronPreamble}

**Starting mode: ${modeLabel}.**
The mode describes the initial intent, but may change during the conversation. If the human asks you to do something outside the starting mode (e.g., make code changes after an answer-mode task, or execute after a plan is approved), follow their instructions — the mode is guidance, not a hard constraint.

You have MCP tools from the **proq** server for reporting progress. Use them instead of curl.

### Task Tools
- \`read_task\` — Read current task state and any existing summary
- \`update_task\` — Update summary and move task to Verify for review
- \`commit_changes\` — Stage and commit all current changes with a message
- \`create_task\` — Create a follow-up task for work outside your current scope`,
  ];

  // Mode-specific guidance
  if (mode === "answer") {
    sections.push(`### Answer Mode Guidance
Start by researching and analyzing — do not make code changes unless the human explicitly asks you to. If they do ask for changes, proceed normally with commits and reporting.`);
  } else if (mode === "plan") {
    sections.push(`### Plan Mode Guidance
Start by creating a plan for the human to review. Do not make code changes until the human approves your plan. Once approved, your mode switches to auto and you should execute the plan, committing changes as you go.`);
  }

  // Workflow applies to all modes (agent may transition into code changes)
  sections.push(`### Workflow
- If you make code changes, use \`commit_changes\` to commit after each logical unit of work. Always commit before reporting — don't leave uncommitted work behind.
- When the task is complete, use \`read_task\` to check existing summary, then \`update_task\` to report and move to Verify for human review. Write a cumulative summary incorporating any prior work.

**When to report:**
- After committing code changes
- After completing the main request or a significant phase
- After substantial follow-up work that changes the scope of what was done

**When NOT to report:**
- Simple clarifying responses or short answers
- Asking questions back to the user
- Minor adjustments that don't change the overall summary`);

  sections.push(`### Asking Questions
When you use \`AskUserQuestion\`, the tool result will show an auto-resolved error — this is expected, ignore it. Your question is displayed to the human and their real answer will arrive as a follow-up message.`);

  sections.push(`### Plan Mode
When you use \`ExitPlanMode\`, the tool result will show an auto-resolved error — this is expected, ignore it. Your plan is displayed to the human and their approval or feedback will arrive as a follow-up message.`);

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
  __proqPendingReprocess?: Set<string>;
};
if (!ga.__proqCleanupTimers) ga.__proqCleanupTimers = new Map();
if (!ga.__proqProcessingProjects) ga.__proqProcessingProjects = new Set();
if (!ga.__proqPendingReprocess) ga.__proqPendingReprocess = new Set();

const cleanupTimers = ga.__proqCleanupTimers;

export function scheduleCleanup(projectId: string, taskId: string) {
  // Cancel any existing timer for this task
  cancelCleanup(taskId);

  const expiresAt = Date.now() + CLEANUP_DELAY_MS;
  const shortId = taskId.slice(0, 8);
  const sessionId = `proq-${shortId}`;

  const timer = setTimeout(async () => {
    try {
      const socketLogPath = `/tmp/proq/${sessionId}.sock.log`;

      // Kill bridge process — sends SIGTERM which writes .log file
      const pidPath = `/tmp/proq/${sessionId}.pid`;
      try {
        if (existsSync(pidPath)) {
          const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
          process.kill(-pid, "SIGTERM"); // Kill process group
          unlinkSync(pidPath);
          console.log(`[agent-cleanup] killed bridge process ${pid} for ${sessionId}`);
        }
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
  console.log(`[agent-cleanup] scheduled cleanup for ${sessionId} in 1 hour`);
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

export function getAllCleanupTimes(): Record<string, number> {
  const result: Record<string, number> = {};
  cleanupTimers.forEach((entry, taskId) => {
    result[taskId] = entry.expiresAt;
  });
  return result;
}

function formatAttachments(attachments: TaskAttachment[] | undefined): string {
  if (!attachments?.length) return "";
  const imageFiles = attachments.filter((a) => a.filePath && a.type.startsWith("image/")).map((a) => a.filePath!);
  const otherFiles = attachments.filter((a) => a.filePath && !a.type.startsWith("image/")).map((a) => a.filePath!);
  let text = "";
  if (imageFiles.length > 0) {
    text += `\n\n## Attached Images\nThe following image files are attached to this task. Use your Read tool to view them:\n${imageFiles.map((f) => `- ${f}`).join("\n")}\n`;
  }
  if (otherFiles.length > 0) {
    text += `\n\n## Attached Files\nThe following files are attached to this task. Use your Read tool to view them:\n${otherFiles.map((f) => `- ${f}`).join("\n")}\n`;
  }
  return text;
}

function buildTaskPrompt(
  taskTitle: string | undefined,
  taskDescription: string,
  mode: TaskMode | undefined,
  attachments: TaskAttachment[] | undefined,
): string {
  const heading = taskTitle
    ? `# ${taskTitle}\n\n${taskDescription}`
    : taskDescription;

  let prompt: string;
  if (mode === "plan") {
    prompt = heading;
  } else if (mode === "answer") {
    prompt = `${heading}\n\nThis task was created in answer mode — start by researching and providing your answer as a summary. If you're asked to make changes in a follow-up, go ahead.`;
  } else {
    prompt = `${heading}\n\nWhen you make changes, use the commit_changes tool to commit after each logical unit of work.`;
  }

  return prompt + formatAttachments(attachments);
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
  const projectPath = resolveProjectPath(project.path);

  if (!existsSync(projectPath)) {
    console.error(
      `[agent-dispatch] project path does not exist: ${projectPath}`,
    );
    return undefined;
  }

  const shortId = taskId.slice(0, 8);
  const terminalTabId = `task-${shortId}`;
  const sessionId = `proq-${shortId}`;

  // Check if running in worktrees mode — create worktree for isolated tasks
  const executionMode = await getExecutionMode(projectId);
  let effectivePath = projectPath;

  // Re-read the task to check if it already has a worktree (e.g., conflict resolution re-dispatch)
  const currentTask = await getTask(projectId, taskId);

  if (executionMode === "worktrees") {
    if (currentTask?.worktreePath) {
      // Worktree already exists (conflict resolution re-dispatch) — reuse it
      effectivePath = currentTask.worktreePath;
      console.log(`[agent-dispatch] reusing existing worktree ${effectivePath}`);
    } else {
      try {
        // Determine base branch: use current branch if it's a non-proq, non-default branch
        const defaultBranch = await getProjectDefaultBranch(projectId);
        const current = getCurrentBranch(projectPath);
        const baseBranch = (
          current.branch.startsWith("proq/") ||
          current.branch.startsWith("proq-preview/") ||
          current.branch === defaultBranch
        ) ? defaultBranch : current.branch;

        const worktreePath = createWorktree(projectPath, shortId, baseBranch);
        const branch = `proq/${shortId}`;
        await updateTask(projectId, taskId, { worktreePath, branch, baseBranch });
        effectivePath = worktreePath;
      } catch (err) {
        console.error(
          `[agent-dispatch] failed to create worktree for ${shortId}:`,
          err,
        );
        // Fall back to shared directory
      }
    }
  }

  // Capture HEAD commit before dispatch so we can track task commits later
  try {
    const headHash = execSync(
      `git -C '${effectivePath}' rev-parse HEAD`,
      { timeout: 5_000, encoding: "utf-8" },
    ).trim();
    if (headHash) {
      await updateTask(projectId, taskId, { startCommit: headHash });
    }
  } catch {
    // Not a git repo or no commits yet — skip
  }

  const prompt = buildTaskPrompt(taskTitle, taskDescription, mode, attachments);
  const isCronTask = !!currentTask?.cronJobId;
  const proqSystemPrompt = buildProqSystemPrompt(projectId, taskId, mode, project.name, { isCronTask });
  const mcpConfigPath = writeMcpConfig(projectId, taskId);

  // Build combined system prompt: global additions + project prompt + proq prompt
  const settings = await getSettings();
  const systemPromptParts: string[] = [];
  if (settings.systemPromptAdditions) systemPromptParts.push(settings.systemPromptAdditions);
  if (project.systemPrompt) systemPromptParts.push(project.systemPrompt);
  systemPromptParts.push(proqSystemPrompt);
  const combinedSystemPrompt = systemPromptParts.join("\n\n");

  // ── CLI mode: dispatch via bridge process ──
  if (renderMode === "cli") {

    // CLI mode supports shift-tab to switch between modes interactively,
    // so plan tasks can use native --permission-mode plan.
    const cliPermFlag = mode === "plan"
      ? `--permission-mode plan`
      : `--dangerously-skip-permissions`;

    // Write prompt + system prompt to temp files to avoid shell escaping issues
    const promptDir = join(tmpdir(), "proq-prompts");
    mkdirSync(promptDir, { recursive: true });
    const promptFile = join(promptDir, `${sessionId}.md`);
    const systemPromptFile = join(promptDir, `${sessionId}-system.md`);
    const launcherFile = join(promptDir, `${sessionId}.sh`);
    writeFileSync(promptFile, prompt, "utf-8");
    writeFileSync(systemPromptFile, combinedSystemPrompt, "utf-8");
    const claudeBin = await getClaudeBin();
    writeFileSync(
      launcherFile,
      `#!/bin/bash\nexec env -u CLAUDECODE -u PORT '${claudeBin}' ${cliPermFlag} --allowedTools 'mcp__proq__*' --mcp-config '${mcpConfigPath}' --append-system-prompt "$(cat '${systemPromptFile}')" "$(cat '${promptFile}')"\n`,
      "utf-8",
    );

    // Ensure bridge socket directory exists
    mkdirSync("/tmp/proq", { recursive: true });
    const cwd = process.cwd();
    const bridgePath = [cwd, "src", "lib", "proq-bridge.js"].join("/");
    const socketPath = `/tmp/proq/${sessionId}.sock`;

    // Launch bridge directly — detached process survives server restarts, exposes PTY over unix socket
    const proqApi = `http://localhost:${process.env.PORT || 1337}`;
    const pidPath = `/tmp/proq/${sessionId}.pid`;

    try {
      const child = spawn("node", [bridgePath, socketPath, launcherFile], {
        cwd: effectivePath,
        detached: true,
        stdio: "ignore",
        env: { ...process.env, PROQ_API: proqApi, CLAUDECODE: undefined, PORT: undefined },
      });
      child.unref();
      writeFileSync(pidPath, String(child.pid));
      console.log(
        `[agent-dispatch] launched bridge process ${child.pid} for task ${taskId}`,
      );

      notify(`🚀 *${(taskTitle || "task").replace(/"/g, '\\"')}* dispatched (cli)`);

      return terminalTabId;
    } catch (err) {
      console.error(
        `[agent-dispatch] failed to launch bridge for ${taskId}:`,
        err,
      );
      return undefined;
    }
  }

  // ── Default: dispatch via SDK (structured mode) ──

  // Use native plan permission mode for plan tasks
  const permissionMode = mode === "plan" ? "plan" : undefined;

  try {
    await startSession(projectId, taskId, prompt, effectivePath, {
      proqSystemPrompt: combinedSystemPrompt,
      mcpConfig: mcpConfigPath,
      permissionMode,
    });
    console.log(
      `[agent-dispatch] launched agent session for task ${taskId}`,
    );
    notify(
      `🚀 *${(taskTitle || "task").replace(/"/g, '\\"')}* dispatched`,
    );
    return terminalTabId;
  } catch (err) {
    console.error(
      `[agent-dispatch] failed to launch agent session for ${taskId}:`,
      err,
    );
    return undefined;
  }
}

export async function abortTask(projectId: string, taskId: string) {
  const task = await getTask(projectId, taskId);

  if (task?.renderMode === "cli") {
    // CLI mode: kill bridge process
    const shortId = taskId.slice(0, 8);
    const sessionId = `proq-${shortId}`;
    const pidPath = `/tmp/proq/${sessionId}.pid`;
    try {
      if (existsSync(pidPath)) {
        const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
        process.kill(-pid, "SIGTERM"); // Kill process group
        unlinkSync(pidPath);
        console.log(`[agent-dispatch] killed bridge process ${pid} (${sessionId})`);
      }
    } catch (err) {
      console.error(
        `[agent-dispatch] failed to kill bridge process ${sessionId}:`,
        err,
      );
    }

    // Clean up bridge socket and log files
    const socketPath = `/tmp/proq/${sessionId}.sock`;
    const logPath = socketPath + ".log";
    try {
      if (existsSync(socketPath)) unlinkSync(socketPath);
    } catch {}
    try {
      if (existsSync(logPath)) unlinkSync(logPath);
    } catch {}
  } else {
    // Default (structured mode): abort via SDK
    stopSession(taskId);
    clearSession(taskId);
    console.log(`[agent-dispatch] stopped agent session for task ${taskId}`);
  }

  // Clean up worktree if task had one (shared for both modes)
  if (task?.worktreePath) {
    const shortId = taskId.slice(0, 8);
    const projects = await getAllProjects();
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      const projectPath = resolveProjectPath(project.path);
      removeWorktree(projectPath, shortId);
      await updateTask(projectId, taskId, {
        worktreePath: undefined,
        branch: undefined,
      });
    }
  }
}

export function isSessionAlive(taskId: string): boolean {
  // Check agent session runtime first
  if (isSessionRunning(taskId)) return true;

  // Fall back to PID file check
  const shortId = taskId.slice(0, 8);
  const pidPath = `/tmp/proq/proq-${shortId}.pid`;
  try {
    if (existsSync(pidPath)) {
      const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
      process.kill(pid, 0); // Throws if process doesn't exist
      return true;
    }
  } catch {
    // Process doesn't exist — clean up stale PID file
    try { if (existsSync(pidPath)) unlinkSync(pidPath); } catch {}
  }
  return false;
}

/**
 * Determine the right initial agentStatus for a task moving to in-progress.
 * "starting" if it will be dispatched immediately, "queued" if it must wait.
 */
export async function getInitialAgentStatus(
  projectId: string,
  excludeTaskId?: string,
): Promise<"queued" | "starting"> {
  const mode = await getExecutionMode(projectId);
  if (mode === "parallel" || mode === "worktrees") return "starting";

  const columns = await getAllTasks(projectId);
  const hasActive = columns["in-progress"].some(
    (t) =>
      t.id !== excludeTaskId &&
      (t.agentStatus === "starting" || t.agentStatus === "running"),
  );
  return hasActive ? "queued" : "starting";
}

const processingProjects = ga.__proqProcessingProjects;
const pendingReprocess = ga.__proqPendingReprocess!;

export async function processQueue(projectId: string): Promise<void> {
  if (processingProjects.has(projectId)) {
    pendingReprocess.add(projectId);
    console.log(`[processQueue] queued reprocess for ${projectId}`);
    return;
  }
  processingProjects.add(projectId);

  try {
    const mode = await getExecutionMode(projectId);
    const columns = await getAllTasks(projectId);
    const inProgress = columns["in-progress"];

    // Array order IS priority — no sort needed
    const pending = inProgress.filter(
      (t) => t.agentStatus === "queued" || t.agentStatus === "starting",
    );

    const running = inProgress.filter((t) => t.agentStatus === "running");

    console.log(
      `[processQueue] ${projectId}: mode=${mode} running=${running.length} pending=${pending.length}`,
    );

    if (mode !== "sequential") {
      // parallel & worktrees: launch all pending
      for (const task of pending) {
        console.log(
          `[processQueue] launching ${task.id.slice(0, 8)} "${task.title || task.description.slice(0, 40)}" (${mode})`,
        );
        if (task.agentStatus !== "starting") {
          await updateTask(projectId, task.id, { agentStatus: "starting" });
          emitTaskUpdate(projectId, task.id, { agentStatus: "starting" });
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
          await updateTask(projectId, task.id, { agentStatus: "running" });
          emitTaskUpdate(projectId, task.id, { agentStatus: "running" });
        } else {
          console.log(
            `[processQueue] dispatch failed for ${task.id.slice(0, 8)}, rolling back`,
          );
          await updateTask(projectId, task.id, { agentStatus: "queued" });
          emitTaskUpdate(projectId, task.id, { agentStatus: "queued" });
        }
      }
    } else if (mode === "sequential") {
      if (running.length === 0 && pending.length > 0) {
        const next = pending[0];
        console.log(
          `[processQueue] launching ${next.id.slice(0, 8)} "${next.title || next.description.slice(0, 40)}"`,
        );
        if (next.agentStatus !== "starting") {
          await updateTask(projectId, next.id, { agentStatus: "starting" });
          emitTaskUpdate(projectId, next.id, { agentStatus: "starting" });
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
          await updateTask(projectId, next.id, { agentStatus: "running" });
          emitTaskUpdate(projectId, next.id, { agentStatus: "running" });
        } else {
          console.log(
            `[processQueue] dispatch failed for ${next.id.slice(0, 8)}, rolling back`,
          );
          await updateTask(projectId, next.id, { agentStatus: "queued" });
          emitTaskUpdate(projectId, next.id, { agentStatus: "queued" });
        }
      } else if (pending.length > 0) {
        console.log(
          `[processQueue] ${running.length} task(s) running, ${pending.length} waiting`,
        );
      }
    }

  } catch (err) {
    console.error(`[processQueue] error for project ${projectId}:`, err);
  } finally {
    processingProjects.delete(projectId);
    if (pendingReprocess.delete(projectId)) {
      return processQueue(projectId);
    }
  }
}
