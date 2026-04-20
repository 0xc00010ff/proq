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
  getAgent,
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
  const mcpScriptPath = join(process.cwd(), "src/lib/proq-mcp-task.js");
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
- \`read_task\` — Read current task state and any existing report
- \`write_report\` — Write a summary report of work done (problem, solution, results)
- \`commit_changes\` — Stage and commit all current changes with a message
- \`create_task\` — Create a follow-up task for work outside your current scope
- \`list_agents\` — List all agents in this project`,
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
- When the task is complete, use \`write_report\` to document what was done (restate the problem, outline the solution and results), then finish naturally — the task automatically moves to Verify when your process ends. On follow-ups, call \`write_report\` again to update the report with new work.

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

  if (mode === "plan") {
    sections.push(`### Plan Mode
When you use \`ExitPlanMode\`, the tool result will show an auto-resolved error — this is expected, ignore it. Your plan is displayed to the human and their approval or feedback will arrive as a follow-up message.`);
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
    prompt = heading;
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

  // Look up the assigned agent (if any) for prompt overrides — fall back to project default
  const effectiveAgentId = currentTask?.agentId || project.defaultAgentId;
  if (effectiveAgentId && currentTask && !currentTask.agentId) {
    await updateTask(projectId, taskId, { agentId: effectiveAgentId });
    emitTaskUpdate(projectId, taskId, { agentId: effectiveAgentId });
    currentTask.agentId = effectiveAgentId;
  }
  const agentDef = effectiveAgentId
    ? await getAgent(projectId, effectiveAgentId)
    : null;

  // Build combined system prompt: global additions + agent prompt + proq prompt
  const settings = await getSettings();
  const systemPromptParts: string[] = [];
  if (settings.systemPromptAdditions) systemPromptParts.push(settings.systemPromptAdditions);
  if (agentDef) {
    const identity = `You are **${agentDef.name}** (\`${agentDef.id}\`).${agentDef.role ? `\nRole: ${agentDef.role}` : ''}`;
    const agentParts = [identity];
    if (agentDef.systemPrompt) agentParts.push(agentDef.systemPrompt);
    systemPromptParts.push(agentParts.join('\n\n'));
  }
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
    const modelFlag = settings.defaultModel ? ` --model '${settings.defaultModel}'` : "";
    const chromeFlag = settings.useChrome ? " --chrome" : "";
    const claudeDotAllowed = "'Write(.claude/skills/**)' 'Edit(.claude/skills/**)' 'Write(.claude/commands/**)' 'Edit(.claude/commands/**)' 'Write(.claude/agents/**)' 'Edit(.claude/agents/**)'";
    const allowedTools = settings.useChrome
      ? `--allowedTools 'mcp__proq__*' 'mcp__claude-in-chrome__*' ${claudeDotAllowed}`
      : `--allowedTools 'mcp__proq__*' ${claudeDotAllowed}`;
    writeFileSync(
      launcherFile,
      `#!/bin/bash\nexec env -u CLAUDECODE -u PORT '${claudeBin}' ${cliPermFlag}${modelFlag}${chromeFlag} ${allowedTools} --mcp-config '${mcpConfigPath}' --append-system-prompt "$(cat '${systemPromptFile}')" "$(cat '${promptFile}')"\n`,
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
      writeFileSync(pidPath, String(child.pid));

      // Bridge exit = Claude CLI process finished. Clear the pid file so
      // isSessionAlive flips to false, drop the task's "running" flag so
      // the UI stops showing "Agent working", and advance the queue so
      // sequential mode picks up the next task. Mirrors structured mode.
      child.on("exit", () => {
        void (async () => {
          try { if (existsSync(pidPath)) unlinkSync(pidPath); } catch {}
          try {
            const t = await getTask(projectId, taskId);
            if (t?.agentStatus === "running") {
              await updateTask(projectId, taskId, { agentStatus: null });
              emitTaskUpdate(projectId, taskId, { agentStatus: null });
            }
          } catch (err) {
            console.error(`[agent-dispatch] cli exit cleanup failed for ${taskId}:`, err);
          }
          processQueue(projectId);
        })();
      });

      child.unref();
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
      model: settings.defaultModel || undefined,
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

const processingProjects = ga.__proqProcessingProjects;
const pendingReprocess = ga.__proqPendingReprocess!;

/**
 * Dispatch queued tasks for a project. At any moment, sequential mode wants
 * at most one live process per project; parallel/worktrees wants every
 * queued task running.
 *
 * "Is a task running?" is answered by isSessionAlive() — the actual process
 * or in-memory session — not by the agentStatus field, which is a cached
 * view that lags DB writes and can drift across restarts or unclean exits.
 *
 * Invariants:
 *   - agentStatus === "queued" + no live session  → waiting, eligible to dispatch
 *   - live session (isSessionAlive true)          → running, never dispatched again
 *   - agentStatus === "running" + no live session → stale; reconcile to "queued"
 *   - agentStatus === null + no live session      → agent done, waiting on human
 *                                                   (e.g. CLI bridge exited); skip
 */
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

    const running: typeof inProgress = [];
    const pending: typeof inProgress = [];

    for (const t of inProgress) {
      if (isSessionAlive(t.id)) {
        running.push(t);
        continue;
      }
      if (t.agentStatus === "queued") {
        pending.push(t);
        continue;
      }
      if (t.agentStatus === "running") {
        // Stale: DB says running but the process is gone (server restart,
        // crash, missed exit handler). Reconcile and treat as queued so it
        // can be re-dispatched.
        await updateTask(projectId, t.id, { agentStatus: "queued" });
        emitTaskUpdate(projectId, t.id, { agentStatus: "queued" });
        pending.push({ ...t, agentStatus: "queued" });
      }
      // agentStatus === null: task is in-progress but the agent already
      // finished (e.g. CLI bridge exited). The human has to move it.
    }

    console.log(
      `[processQueue] ${projectId}: mode=${mode} running=${running.length} pending=${pending.length}`,
    );

    const targets =
      mode === "sequential"
        ? running.length === 0 && pending.length > 0
          ? [pending[0]]
          : []
        : pending;

    if (mode === "sequential" && targets.length === 0 && pending.length > 0) {
      console.log(
        `[processQueue] ${running.length} task(s) running, ${pending.length} waiting`,
      );
    }

    for (const task of targets) {
      console.log(
        `[processQueue] launching ${task.id.slice(0, 8)} "${task.title || task.description.slice(0, 40)}"${mode !== "sequential" ? ` (${mode})` : ""}`,
      );
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
          `[processQueue] dispatch failed for ${task.id.slice(0, 8)} (left as queued)`,
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
