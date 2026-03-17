/**
 * Codex session runtime — wraps the Codex CLI (`codex exec --json`) as a
 * child process, the same way agent-session.ts wraps the Claude Code CLI.
 *
 * Architecture:
 *  - startSession spawns `codex exec --json --dangerously-bypass-approvals-and-sandbox`
 *  - JSONL events on stdout are parsed into AgentBlocks and broadcast to WS clients
 *  - proq task management (read_task, update_task, commit_changes) is handled by
 *    the agent via curl commands injected into the system prompt
 *  - continueSession uses `codex exec resume <threadId>` for follow-up turns
 */

import { spawn, type ChildProcess } from "child_process";
import type WebSocket from "ws";
import { getProject, getSettings, getTask, updateTask } from "./db";
import { emitTaskUpdate } from "./task-events";
import { autoCommitIfDirty } from "./worktree";
import { notify } from "./agent-dispatch";
import { getCodexCmd } from "./codex-bin";
import type { AgentBlock, TaskAttachment } from "./types";

// ── Session type ──────────────────────────────────────────────────────────────

export interface CodexRuntimeSession {
  taskId: string;
  projectId: string;
  cwd: string;
  threadId?: string;
  queryHandle: ChildProcess | null;
  blocks: AgentBlock[];
  clients: Set<WebSocket>;
  status: "running" | "done" | "error" | "aborted";
}

// ── Singleton session store ───────────────────────────────────────────────────

const g = globalThis as unknown as {
  __proqCodexSessions?: Map<string, CodexRuntimeSession>;
};
if (!g.__proqCodexSessions) g.__proqCodexSessions = new Map();
const sessions: Map<string, CodexRuntimeSession> = g.__proqCodexSessions;

// ── Helpers ───────────────────────────────────────────────────────────────────

function broadcast(session: CodexRuntimeSession, msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of session.clients) {
    try {
      if ((ws as unknown as { readyState: number }).readyState === 1)
        ws.send(data);
    } catch {
      // client gone
    }
  }
}

function appendBlock(session: CodexRuntimeSession, block: AgentBlock) {
  session.blocks.push(block);
  broadcast(session, { type: "block", block });
}

/**
 * Codex wraps commands in a shell invocation like `/bin/zsh -lc 'actual cmd'`.
 * Strip that wrapper to show the real command in the UI.
 */
function stripShellWrapper(cmd: string): string {
  const m = cmd.match(/^\/bin\/(?:zsh|bash|sh)\s+(?:-\S+\s+)*'([\s\S]*)'\s*$/);
  if (m) return m[1].replace(/\\'/g, "'");
  return cmd;
}

/** Detect whether a raw command calls the proq API. */
function isProqApiCall(cmd: string): boolean {
  return cmd.includes("localhost:1337/api/projects");
}

/** Infer the logical proq tool name from the curl command. */
function inferProqToolName(cmd: string): string {
  if (cmd.includes("-X PATCH") || cmd.includes("--request PATCH")) {
    return "update_task";
  }
  return "read_task";
}

// ── JSONL event processing ────────────────────────────────────────────────────

function processStreamEvent(
  session: CodexRuntimeSession,
  event: Record<string, unknown>,
) {
  const type = event.type as string;

  if (type === "thread.started") {
    session.threadId = event.thread_id as string | undefined;
    return;
  }

  if (type === "turn.started") return;

  if (type === "item.started") {
    const item = event.item as Record<string, unknown> | undefined;
    if (!item) return;
    if (item.type === "command_execution") {
      const rawCmd = item.command as string;
      const displayCmd = stripShellWrapper(rawCmd);
      const toolName = isProqApiCall(rawCmd)
        ? inferProqToolName(rawCmd)
        : "bash";
      appendBlock(session, {
        type: "tool_use",
        toolId: item.id as string,
        name: toolName,
        input: { command: displayCmd },
      });
    }
    return;
  }

  if (type === "item.completed") {
    const item = event.item as Record<string, unknown> | undefined;
    if (!item) return;

    if (item.type === "agent_message") {
      const text = (item.text as string) || "";
      if (text) appendBlock(session, { type: "text", text });
      return;
    }

    if (item.type === "command_execution") {
      const rawCmd = item.command as string;
      const output = ((item.aggregated_output as string) || "").trimEnd();
      const exitCode = item.exit_code as number | null;
      const toolName = isProqApiCall(rawCmd)
        ? inferProqToolName(rawCmd)
        : "bash";
      appendBlock(session, {
        type: "tool_result",
        toolId: item.id as string,
        name: toolName,
        output: output || "(no output)",
        isError: exitCode !== 0 && exitCode !== null,
      });
      return;
    }

    if (item.type === "file_change") {
      const changes = item.changes as Array<{ path: string; kind: string }> | undefined;
      if (changes?.length) {
        const summary = changes.map((c) => `${c.kind}: ${c.path}`).join(", ");
        appendBlock(session, { type: "text", text: `File changes: ${summary}` });
      }
      return;
    }

    return;
  }

  if (type === "turn.completed") {
    // The agent finished its turn. The process close handler finalises state.
    return;
  }
}

// ── Process wiring ────────────────────────────────────────────────────────────

function wireProcess(
  session: CodexRuntimeSession,
  proc: ChildProcess,
  opts: { startTime: number; projectId: string; taskId: string },
) {
  const { startTime, projectId, taskId } = opts;

  let stdoutBuffer = "";
  proc.stdout!.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue;
      }
      processStreamEvent(session, event);
    }
  });

  let stderrOutput = "";
  proc.stderr!.on("data", (chunk: Buffer) => {
    stderrOutput += chunk.toString();
  });

  proc.on("close", async (code, signal) => {
    // Flush any remaining buffered stdout
    if (stdoutBuffer.trim()) {
      try {
        const event = JSON.parse(stdoutBuffer.trim());
        processStreamEvent(session, event);
      } catch {
        // ignore
      }
    }

    if (session.status === "aborted") {
      await updateTask(projectId, taskId, { agentBlocks: session.blocks });
      return;
    }

    const intentionalKill =
      (code === null && signal === "SIGTERM") || code === 143;

    if (code !== 0 && !intentionalKill && session.status === "running") {
      session.status = "error";
      const errorMsg = stderrOutput.trim() || `codex exited with code ${code}`;
      appendBlock(session, {
        type: "status",
        subtype: "error",
        error: errorMsg,
        durationMs: Date.now() - startTime,
      });
    } else if (session.status === "running") {
      session.status = "done";
      appendBlock(session, {
        type: "status",
        subtype: "complete",
        durationMs: Date.now() - startTime,
      });
    }

    // Safety net: auto-commit any leftover uncommitted changes
    const task = await getTask(projectId, taskId);
    if (task) {
      const effectivePath =
        task.worktreePath ||
        (await (async () => {
          const proj = await getProject(projectId);
          return proj?.path.replace(/^~/, process.env.HOME || "~");
        })());
      if (effectivePath) {
        autoCommitIfDirty(effectivePath, task.title);
      }
    }

    // Safety net: if the task is still in-progress, move it to verify
    const stillInProgress = task?.status === "in-progress";
    if (stillInProgress) {
      const closeUpdate: Record<string, unknown> = {
        status: "verify",
        agentStatus: null,
        agentBlocks: session.blocks,
      };
      if (session.status === "error") {
        closeUpdate.summary = `Error: ${stderrOutput.trim() || `codex exited with code ${code}`}`;
      }
      await updateTask(
        projectId,
        taskId,
        closeUpdate as Parameters<typeof updateTask>[2],
      );
      notify(
        `✅ *${(task?.title || "task").slice(0, 40).replace(/"/g, '\\"')}* → verify`,
      );
      emitTaskUpdate(projectId, taskId, { status: "verify", agentStatus: null });
    } else {
      await updateTask(projectId, taskId, { agentBlocks: session.blocks });
    }
  });

  proc.on("error", async (err) => {
    session.status = "error";
    const errorMsg = err.message;
    appendBlock(session, {
      type: "status",
      subtype: "error",
      error: errorMsg,
      durationMs: Date.now() - startTime,
    });
    const task = await getTask(projectId, taskId);
    if (task?.status === "in-progress") {
      await updateTask(projectId, taskId, {
        status: "verify",
        agentStatus: null,
        summary: `Error: ${errorMsg}`,
        agentBlocks: session.blocks,
      });
      emitTaskUpdate(projectId, taskId, { status: "verify", agentStatus: null });
    } else {
      await updateTask(projectId, taskId, { agentBlocks: session.blocks });
    }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function startSession(
  projectId: string,
  taskId: string,
  prompt: string,
  cwd: string,
  options?: {
    proqSystemPrompt?: string;
    mcpConfig?: string; // unused for Codex CLI, accepted for interface compat
    permissionMode?: string;
  },
): Promise<void> {
  const settings = await getSettings();
  const model = settings.codexModel || "o4-mini";

  const session: CodexRuntimeSession = {
    taskId,
    projectId,
    cwd,
    queryHandle: null,
    blocks: [],
    clients: new Set(),
    status: "running",
  };
  sessions.set(taskId, session);

  appendBlock(session, { type: "status", subtype: "init", model });
  appendBlock(session, { type: "user", text: prompt });

  const startTime = Date.now();

  // Build the full prompt: prepend proq system instructions
  const fullPrompt = options?.proqSystemPrompt
    ? `${options.proqSystemPrompt}\n\n---\n\n${prompt}`
    : prompt;

  const codexCmd = await getCodexCmd();
  const [bin, ...prefixArgs] = codexCmd;

  const args: string[] = [
    ...prefixArgs,
    "exec",
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "-C",
    cwd,
    "--model",
    model,
    fullPrompt,
  ];

  const proc = spawn(bin, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      PORT: undefined,
      PROQ_API: `http://localhost:${process.env.PORT || 1337}`,
    },
  });

  session.queryHandle = proc;
  wireProcess(session, proc, { startTime, projectId, taskId });
}

export async function continueSession(
  projectId: string,
  taskId: string,
  text: string,
  cwd: string,
  preAttachClient?: WebSocket,
  attachments?: TaskAttachment[],
  _options?: { planApproved?: boolean },
): Promise<void> {
  let session = sessions.get(taskId);

  if (!session) {
    // Reconstruct from DB for sessions that survived a server restart
    const task = await getTask(projectId, taskId);
    session = {
      taskId,
      projectId,
      cwd,
      threadId: undefined,
      queryHandle: null,
      blocks: task?.agentBlocks || [],
      clients: new Set(),
      status: "done",
    };
    sessions.set(taskId, session);
  }

  if (preAttachClient) session.clients.add(preAttachClient);

  if (session.status === "running") {
    throw new Error("Session is already running");
  }

  // Append user block so it renders immediately
  let promptText = text;
  if (attachments?.length) {
    const imageFiles = attachments
      .filter((a) => a.filePath && a.type.startsWith("image/"))
      .map((a) => a.filePath!);
    const otherFiles = attachments
      .filter((a) => a.filePath && !a.type.startsWith("image/"))
      .map((a) => a.filePath!);
    if (imageFiles.length > 0) {
      promptText += `\n\n## Attached Images\n${imageFiles.map((f) => `- ${f}`).join("\n")}`;
    }
    if (otherFiles.length > 0) {
      promptText += `\n\n## Attached Files\n${otherFiles.map((f) => `- ${f}`).join("\n")}`;
    }
  }

  appendBlock(session, {
    type: "user",
    text,
    attachments: attachments?.length ? attachments : undefined,
  });

  session.status = "running";
  session.cwd = cwd;

  const settings = await getSettings();
  const model = settings.codexModel || "o4-mini";
  const startTime = Date.now();

  const codexCmd = await getCodexCmd();
  const [bin, ...prefixArgs] = codexCmd;

  let args: string[];

  if (session.threadId) {
    // Resume the existing codex session
    args = [
      ...prefixArgs,
      "exec",
      "resume",
      session.threadId,
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      promptText,
    ];
  } else {
    // No thread to resume — start fresh with context
    const task = await getTask(projectId, taskId);
    const contextParts: string[] = [];
    if (task?.title) contextParts.push(`Task: ${task.title}`);
    if (task?.description) contextParts.push(`Description: ${task.description}`);
    if (task?.summary) contextParts.push(`Previous summary:\n${task.summary}`);
    if (task?.nextSteps) contextParts.push(`Previous next steps:\n${task.nextSteps}`);

    const { buildProqSystemPrompt } = await import("./agent-dispatch");
    const project = await getProject(projectId);
    const proqSystemPrompt = buildProqSystemPrompt(
      projectId,
      taskId,
      task?.mode,
      project?.name,
      "codex",
    );

    const systemParts = [proqSystemPrompt];
    if (contextParts.length > 0) {
      systemParts.push(
        `## Previous work on this task\n${contextParts.join("\n\n")}`,
      );
    }

    const fullPrompt = `${systemParts.join("\n\n")}\n\n---\n\n${promptText}`;

    args = [
      ...prefixArgs,
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      cwd,
      "--model",
      model,
      fullPrompt,
    ];
  }

  appendBlock(session, { type: "status", subtype: "init", model });

  const proc = spawn(bin, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      PORT: undefined,
      PROQ_API: `http://localhost:${process.env.PORT || 1337}`,
    },
  });

  session.queryHandle = proc;
  wireProcess(session, proc, { startTime, projectId, taskId });
}

export function stopSession(taskId: string): void {
  const session = sessions.get(taskId);
  if (session && session.status === "running" && session.queryHandle) {
    session.status = "aborted";
    appendBlock(session, {
      type: "status",
      subtype: "abort",
      error: "Session aborted",
    });
    session.queryHandle.kill("SIGTERM");
  }
}

export function isSessionRunning(taskId: string): boolean {
  const session = sessions.get(taskId);
  return session?.status === "running";
}

export function getSession(taskId: string): CodexRuntimeSession | null {
  return sessions.get(taskId) ?? null;
}

export function attachClient(taskId: string, ws: WebSocket): void {
  sessions.get(taskId)?.clients.add(ws);
}

export function detachClient(taskId: string, ws: WebSocket): void {
  sessions.get(taskId)?.clients.delete(ws);
}

export function clearSession(taskId: string): void {
  const session = sessions.get(taskId);
  if (session) {
    session.clients.clear();
    sessions.delete(taskId);
  }
}
