/**
 * Codex session runtime — wraps the Codex SDK to manage agent sessions.
 *
 * Architecture:
 *  - startSession creates a new Codex thread and streams events
 *  - continueSession resumes an existing thread (by threadId) or starts fresh
 *  - Events from the SDK are translated into AgentBlocks and broadcast to WS clients
 *  - proq task management (read_task, update_task, commit_changes) is handled by
 *    the agent via curl commands injected into the system prompt
 */

import path from "path";
import { Codex } from "@openai/codex-sdk";
import type { ThreadEvent, ThreadOptions } from "@openai/codex-sdk";
import type WebSocket from "ws";
import { getProject, getSettings, getTask, updateTask } from "./db";
import { emitTaskUpdate } from "./task-events";
import { autoCommitIfDirty } from "./worktree";
import { notify } from "./agent-dispatch";
import type { AgentBlock, TaskAttachment } from "./types";

// ── Binary resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the platform-specific codex binary path from the optional-dep package.
 * Next.js bundles code via webpack which breaks the SDK's internal require.resolve,
 * so we resolve it explicitly and pass codexPathOverride to the Codex constructor.
 */
function resolveCodexBinaryPath(): string | undefined {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;

  const platformTripleMap: Record<string, string> = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-arm64": "aarch64-unknown-linux-musl",
    "linux-x64": "x86_64-unknown-linux-musl",
  };
  const pkgMap: Record<string, string> = {
    "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
    "x86_64-apple-darwin": "@openai/codex-darwin-x64",
    "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
    "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
  };

  const key = `${process.platform}-${process.arch}`;
  const triple = platformTripleMap[key];
  if (!triple) return undefined;

  const pkg = pkgMap[triple];
  const binName = process.platform === "win32" ? "codex.exe" : "codex";

  // Use process.cwd() instead of require.resolve — webpack intercepts require.resolve
  // in Next.js server bundles and can return virtual module paths that don't exist on disk.
  const cwdBin = path.join(
    process.cwd(),
    "node_modules",
    pkg,
    "vendor",
    triple,
    "codex",
    binName,
  );
  const { existsSync } = require("fs") as typeof import("fs");
  if (existsSync(cwdBin)) return cwdBin;

  // Fallback: walk up from __dirname (works in non-bundled contexts)
  try {
    const pkgDir = path.dirname(require.resolve(`${pkg}/package.json`));
    const resolved = path.join(pkgDir, "vendor", triple, "codex", binName);
    if (existsSync(resolved)) return resolved;
  } catch {
    // ignore
  }

  return undefined;
}

// ── Session type ──────────────────────────────────────────────────────────────

export interface CodexRuntimeSession {
  taskId: string;
  projectId: string;
  cwd: string;
  threadId?: string;
  abortController: AbortController | null;
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

// ── SDK event processing ──────────────────────────────────────────────────────

function processSDKEvent(session: CodexRuntimeSession, event: ThreadEvent) {
  if (event.type === "item.started") {
    const item = event.item;
    if (item.type === "command_execution") {
      const displayCmd = stripShellWrapper(item.command);
      const toolName = isProqApiCall(item.command)
        ? inferProqToolName(item.command)
        : "bash";
      appendBlock(session, {
        type: "tool_use",
        toolId: item.id,
        name: toolName,
        input: { command: displayCmd },
      });
    }
    return;
  }

  if (event.type === "item.completed") {
    const item = event.item;

    if (item.type === "agent_message") {
      if (item.text) appendBlock(session, { type: "text", text: item.text });
      return;
    }

    if (item.type === "command_execution") {
      const output = item.aggregated_output.trimEnd();
      const toolName = isProqApiCall(item.command)
        ? inferProqToolName(item.command)
        : "bash";
      appendBlock(session, {
        type: "tool_result",
        toolId: item.id,
        name: toolName,
        output: output || "(no output)",
        isError: item.exit_code !== undefined && item.exit_code !== 0,
      });
      return;
    }

    if (item.type === "file_change" && item.changes.length) {
      const summary = item.changes.map((c) => `${c.kind}: ${c.path}`).join(", ");
      appendBlock(session, { type: "text", text: `File changes: ${summary}` });
      return;
    }
  }
}

// ── Core turn runner ──────────────────────────────────────────────────────────

async function runTurn(
  session: CodexRuntimeSession,
  thread: ReturnType<Codex["startThread"]>,
  input: string,
  startTime: number,
  opts: { projectId: string; taskId: string },
): Promise<void> {
  const { projectId, taskId } = opts;
  const abortController = session.abortController!;
  let errorMessage: string | null = null;

  try {
    const { events } = await thread.runStreamed(input, {
      signal: abortController.signal,
    });

    // Capture thread ID as soon as it's available
    if (!session.threadId && thread.id) {
      session.threadId = thread.id;
    }

    for await (const event of events) {
      if (session.status === "aborted") break;

      // Capture threadId after thread.started
      if (event.type === "thread.started") {
        session.threadId = event.thread_id;
      } else if (event.type === "turn.failed") {
        errorMessage = event.error.message;
      } else {
        processSDKEvent(session, event);
      }

      // Update threadId from SDK after first event
      if (!session.threadId && thread.id) {
        session.threadId = thread.id;
      }
    }
  } catch (err: unknown) {
    if (session.status !== "aborted") {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  if (session.status === "aborted") {
    // Move task to verify and clear agentStatus so the UI stops spinning
    const abortedTask = await getTask(projectId, taskId);
    if (abortedTask?.status === "in-progress") {
      await updateTask(projectId, taskId, {
        status: "verify",
        agentStatus: null,
        agentBlocks: session.blocks,
      });
      emitTaskUpdate(projectId, taskId, { status: "verify", agentStatus: null });
    } else {
      await updateTask(projectId, taskId, { agentBlocks: session.blocks });
    }
    return;
  }

  if (errorMessage) {
    session.status = "error";
    appendBlock(session, {
      type: "status",
      subtype: "error",
      error: errorMessage,
      durationMs: Date.now() - startTime,
    });
  } else {
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
  if (task?.status === "in-progress") {
    const closeUpdate: Record<string, unknown> = {
      status: "verify",
      agentStatus: null,
      agentBlocks: session.blocks,
    };
    if (session.status === "error") {
      closeUpdate.summary = `Error: ${errorMessage}`;
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
}

// ── Shared thread options builder ─────────────────────────────────────────────

function buildThreadOptions(cwd: string, model: string | null): ThreadOptions {
  return {
    workingDirectory: cwd,
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    ...(model ? { model } : {}),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function startSession(
  projectId: string,
  taskId: string,
  prompt: string,
  cwd: string,
  options?: {
    proqSystemPrompt?: string;
    mcpConfig?: string; // unused for Codex SDK, accepted for interface compat
    permissionMode?: string;
  },
): Promise<void> {
  const settings = await getSettings();
  const model = settings.codexModel || null;

  const session: CodexRuntimeSession = {
    taskId,
    projectId,
    cwd,
    abortController: new AbortController(),
    blocks: [],
    clients: new Set(),
    status: "running",
  };
  sessions.set(taskId, session);

  appendBlock(session, { type: "status", subtype: "init", model: model ?? "default" });

  const fullPrompt = options?.proqSystemPrompt
    ? `${options.proqSystemPrompt}\n\n---\n\n${prompt}`
    : prompt;

  appendBlock(session, { type: "user", text: prompt });

  const codexBin = resolveCodexBinaryPath();
  const codex = new Codex({
    ...(codexBin ? { codexPathOverride: codexBin } : {}),
  });
  const thread = codex.startThread(buildThreadOptions(cwd, model));
  const startTime = Date.now();

  runTurn(session, thread, fullPrompt, startTime, { projectId, taskId });
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
      abortController: null,
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

  // Build prompt text including any attachments
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
  session.abortController = new AbortController();

  const settings = await getSettings();
  const model = settings.codexModel || null;
  const startTime = Date.now();

  appendBlock(session, { type: "status", subtype: "init", model: model ?? "default" });

  const codexBin = resolveCodexBinaryPath();
  const codex = new Codex({
    ...(codexBin ? { codexPathOverride: codexBin } : {}),
  });

  let thread: ReturnType<Codex["startThread"]>;
  let input: string;

  // Always start a fresh thread — resuming stale threads from completed sessions
  // can hang indefinitely waiting for the Codex API to respond.
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

  thread = codex.startThread(buildThreadOptions(cwd, model));
  input = `${systemParts.join("\n\n")}\n\n---\n\n${promptText}`;

  runTurn(session, thread, input, startTime, { projectId, taskId });
}

export function stopSession(taskId: string): void {
  const session = sessions.get(taskId);
  if (session && session.status === "running" && session.abortController) {
    session.status = "aborted";
    appendBlock(session, {
      type: "status",
      subtype: "abort",
      error: "Session aborted",
    });
    session.abortController.abort();
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
