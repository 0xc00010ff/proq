/**
 * Codex session runtime — runs an agentic coding loop using the OpenAI Chat
 * Completions API. Mirrors the public interface of agent-session.ts so that
 * agent-provider.ts can route transparently between the two.
 *
 * Architecture:
 *  - Each task gets a CodexRuntimeSession with its own message history.
 *  - Tools: bash (all file/shell work), read_task, update_task,
 *    commit_changes, ask_user_question, exit_plan_mode.
 *  - ask_user_question and exit_plan_mode use a promise-based pause so the
 *    loop waits for the user's WebSocket response before continuing.
 *  - continueSession adds user text and resumes the loop.
 */

import { spawn, execSync } from "child_process";
import type WebSocket from "ws";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { AgentBlock, TaskAttachment, TaskMode } from "./types";
import { getTask, updateTask, getProject, getSettings } from "./db";
import { emitTaskUpdate } from "./task-events";
import { autoCommitIfDirty } from "./worktree";
import { notify, buildProqSystemPrompt } from "./agent-dispatch";

// ── Session type ─────────────────────────────────────────────────────────────

export interface CodexRuntimeSession {
  taskId: string;
  projectId: string;
  cwd: string;
  messages: ChatCompletionMessageParam[];
  abortController: AbortController | null;
  blocks: AgentBlock[];
  clients: Set<WebSocket>;
  status: "running" | "paused" | "done" | "error" | "aborted";
  // Pending pause — set when ask_user_question or exit_plan_mode fires
  pendingResume: ((answer: string) => void) | null;
  pendingType: "question" | "plan" | null;
  pendingToolCallId: string | null;
}

// ── Singleton session store ────────────────────────────────────────────────

const g = globalThis as unknown as {
  __proqCodexSessions?: Map<string, CodexRuntimeSession>;
};
if (!g.__proqCodexSessions) g.__proqCodexSessions = new Map();
const sessions: Map<string, CodexRuntimeSession> = g.__proqCodexSessions;

// ── Helpers ──────────────────────────────────────────────────────────────────

function broadcast(session: CodexRuntimeSession, msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of session.clients) {
    try {
      if ((ws as unknown as { readyState: number }).readyState === 1) ws.send(data);
    } catch {
      // client gone
    }
  }
}

function appendBlock(session: CodexRuntimeSession, block: AgentBlock) {
  session.blocks.push(block);
  broadcast(session, { type: "block", block });
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Execute a bash command in the project directory. Use this for reading files, writing files, running tests, git operations, and any other shell work.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The bash command to execute",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_task",
      description:
        "Read the current task state, including any existing summary from prior work. Use this before updating to see what has already been reported.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description:
        "Update the task with a summary of work done and move it to Verify for human review. Call this on initial completion and again after follow-up work.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Newline-separated cumulative summary of all work done",
          },
          nextSteps: {
            type: "string",
            description: "Suggested next steps such as testing, refinements, or follow-up work",
          },
        },
        required: ["summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "commit_changes",
      description:
        "Stage and commit all current changes. Use after each logical unit of work to keep progress saved.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "Descriptive commit message summarizing the changes",
          },
        },
        required: ["message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user_question",
      description:
        "Ask the user a question and wait for their response before continuing. Use when you need clarification before proceeding.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question to ask the user",
          },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "exit_plan_mode",
      description:
        "Present your plan to the user and wait for approval before making any changes.",
      parameters: {
        type: "object",
        properties: {
          plan: {
            type: "string",
            description: "Your detailed plan describing the changes you intend to make",
          },
        },
        required: ["plan"],
      },
    },
  },
];

// ── Tool executors ────────────────────────────────────────────────────────────

function executeBash(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", command], {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    let output = "";
    const maxBytes = 50_000;
    const append = (chunk: Buffer) => {
      if (output.length < maxBytes) output += chunk.toString();
    };
    proc.stdout.on("data", append);
    proc.stderr.on("data", append);
    proc.on("close", (code) => {
      const trimmed = output.trimEnd();
      resolve(code === 0 ? trimmed || "(no output)" : `Exit ${code}:\n${trimmed}`);
    });
    proc.on("error", (err) => resolve(`Error: ${err.message}`));
  });
}

async function executeReadTask(projectId: string, taskId: string): Promise<string> {
  try {
    const task = await getTask(projectId, taskId);
    if (!task) return "Task not found.";
    return JSON.stringify(task, null, 2);
  } catch (err) {
    return `Error reading task: ${(err as Error).message}`;
  }
}

async function executeUpdateTask(
  projectId: string,
  taskId: string,
  args: { summary: string; nextSteps?: string },
  session: CodexRuntimeSession,
): Promise<string> {
  try {
    await updateTask(projectId, taskId, {
      status: "verify",
      agentStatus: null,
      summary: args.summary,
      nextSteps: args.nextSteps || "",
    });
    emitTaskUpdate(projectId, taskId, {
      status: "verify",
      agentStatus: null,
      summary: args.summary,
      nextSteps: args.nextSteps || "",
    });
    // Broadcast done to any connected WS clients
    broadcast(session, {
      type: "block",
      block: {
        type: "task_update",
        summary: args.summary,
        nextSteps: args.nextSteps || "",
        timestamp: new Date().toISOString(),
      },
    });
    return "Task updated and moved to Verify.";
  } catch (err) {
    return `Error updating task: ${(err as Error).message}`;
  }
}

async function executeCommitChanges(
  message: string,
  session: CodexRuntimeSession,
): Promise<string> {
  try {
    const task = await getTask(session.projectId, session.taskId);
    const project = await getProject(session.projectId);
    if (!project) return "Project not found.";
    const projectPath = project.path.replace(/^~/, process.env.HOME || "~");
    const workDir = task?.worktreePath || projectPath;

    const status = execSync(`git -C '${workDir}' status --porcelain`, {
      timeout: 10_000,
      encoding: "utf-8",
    }).trim();

    if (!status) return "Nothing to commit — working tree is clean.";

    execSync(`git -C '${workDir}' add -A`, { timeout: 10_000 });
    const safeMsg = message.replace(/'/g, "'\\''");
    const result = execSync(`git -C '${workDir}' commit -m '${safeMsg}'`, {
      timeout: 15_000,
      encoding: "utf-8",
    }).trim();

    const hashMatch = result.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
    const hash = hashMatch ? hashMatch[1] : "";

    // Record commit hash on the task
    if (hash) {
      try {
        const currentTask = await getTask(session.projectId, session.taskId);
        const hashes = currentTask?.commitHashes || [];
        hashes.push(hash);
        await updateTask(session.projectId, session.taskId, { commitHashes: hashes });
      } catch {
        // best effort
      }
    }

    return `Committed${hash ? ` (${hash})` : ""}: ${message}`;
  } catch (err) {
    return `Commit failed: ${(err as Error).message}`;
  }
}

// ── Agentic loop ──────────────────────────────────────────────────────────────

// Helpers that read session status through a function call to prevent
// TypeScript's control-flow narrowing — the session object can be mutated
// from other async contexts (abort, WebSocket handlers) after status checks.
function sessionIsActive(s: CodexRuntimeSession): boolean {
  return s.status === "running";
}
function sessionIsAborted(s: CodexRuntimeSession): boolean {
  return s.status === "aborted";
}

async function runLoop(session: CodexRuntimeSession, model: string): Promise<void> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const maxTurns = 200;
  let turnCount = 0;

  while (turnCount < maxTurns && sessionIsActive(session)) {
    turnCount++;

    const abortSignal = session.abortController?.signal;

    let stream: Awaited<ReturnType<typeof openai.chat.completions.create>> & AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      stream = await openai.chat.completions.create(
        {
          model,
          messages: session.messages,
          tools: TOOLS,
          tool_choice: "auto",
          stream: true,
        },
        { signal: abortSignal },
      ) as typeof stream;
    } catch (err: unknown) {
      const msg = (err as Error).message ?? "OpenAI API error";
      appendBlock(session, { type: "status", subtype: "error", error: msg });
      session.status = "error";
      await updateTask(session.projectId, session.taskId, { agentStatus: null });
      emitTaskUpdate(session.projectId, session.taskId, { agentStatus: null });
      return;
    }

    // Accumulate response
    let textContent = "";
    const toolCallAccumulator: Record<
      number,
      { id: string; name: string; arguments: string }
    > = {};
    let finishReason = "";

    for await (const chunk of stream) {
      if (sessionIsAborted(session)) break;

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        textContent += delta.content;
        broadcast(session, { type: "stream_delta", text: delta.content });
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallAccumulator[idx]) {
            toolCallAccumulator[idx] = { id: "", name: "", arguments: "" };
          }
          if (tc.id) toolCallAccumulator[idx].id = tc.id;
          if (tc.function?.name) toolCallAccumulator[idx].name += tc.function.name;
          if (tc.function?.arguments) toolCallAccumulator[idx].arguments += tc.function.arguments;
        }
      }

      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
    }

    if (sessionIsAborted(session)) break;

    const toolCalls = Object.values(toolCallAccumulator);

    // Append assistant message to history
    const assistantMsg: ChatCompletionMessageParam = {
      role: "assistant",
      content: textContent || null,
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            })),
          }
        : {}),
    };
    session.messages.push(assistantMsg);

    // Emit text block if any content
    if (textContent) {
      appendBlock(session, { type: "text", text: textContent });
    }

    // No tool calls → model is done
    if (toolCalls.length === 0 || finishReason === "stop") {
      session.status = "done";
      appendBlock(session, {
        type: "status",
        subtype: "complete",
        turns: turnCount,
      });
      await updateTask(session.projectId, session.taskId, { agentStatus: null });
      emitTaskUpdate(session.projectId, session.taskId, { agentStatus: null });
      return;
    }

    // Process each tool call
    for (const tc of toolCalls) {
      if (sessionIsAborted(session)) break;

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.arguments || "{}");
      } catch {
        args = {};
      }

      // Emit tool_use block
      appendBlock(session, {
        type: "tool_use",
        toolId: tc.id,
        name: tc.name,
        input: args,
      });

      let output: string;

      if (tc.name === "ask_user_question") {
        // Pause loop and wait for user input via continueSession
        output = await new Promise<string>((resolve) => {
          session.pendingResume = resolve;
          session.pendingType = "question";
          session.pendingToolCallId = tc.id;
          session.status = "paused";
        });
        session.pendingResume = null;
        session.pendingType = null;
        session.pendingToolCallId = null;
        if (!sessionIsAborted(session)) session.status = "running";
      } else if (tc.name === "exit_plan_mode") {
        // Pause loop and wait for plan approval
        output = await new Promise<string>((resolve) => {
          session.pendingResume = resolve;
          session.pendingType = "plan";
          session.pendingToolCallId = tc.id;
          session.status = "paused";
        });
        session.pendingResume = null;
        session.pendingType = null;
        session.pendingToolCallId = null;
        if (!sessionIsAborted(session)) session.status = "running";
      } else if (tc.name === "bash") {
        output = await executeBash(String(args.command ?? ""), session.cwd);
      } else if (tc.name === "read_task") {
        output = await executeReadTask(session.projectId, session.taskId);
      } else if (tc.name === "update_task") {
        output = await executeUpdateTask(
          session.projectId,
          session.taskId,
          args as { summary: string; nextSteps?: string },
          session,
        );
      } else if (tc.name === "commit_changes") {
        output = await executeCommitChanges(String(args.message ?? ""), session);
      } else {
        output = `Unknown tool: ${tc.name}`;
      }

      // Emit tool_result block
      appendBlock(session, {
        type: "tool_result",
        toolId: tc.id,
        name: tc.name,
        output,
      });

      // Add tool result to message history
      session.messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: output,
      });
    }
  }

  // Reached max turns
  if (session.status === "running") {
    session.status = "done";
    appendBlock(session, {
      type: "status",
      subtype: "complete",
      turns: turnCount,
      error: turnCount >= maxTurns ? "Max turns reached" : undefined,
    });
    await updateTask(session.projectId, session.taskId, { agentStatus: null });
    emitTaskUpdate(session.projectId, session.taskId, { agentStatus: null });
  }
}

// ── Public API (mirrors agent-session.ts) ─────────────────────────────────────

export async function startSession(
  projectId: string,
  taskId: string,
  prompt: string,
  cwd: string,
  options?: {
    proqSystemPrompt?: string;
    mcpConfig?: string; // unused for Codex, accepted for interface compat
    permissionMode?: string;
  },
): Promise<void> {
  const settings = await getSettings();
  const model = settings.codexModel || "o4-mini";

  // Build system message
  const parts: string[] = [
    `You are a coding agent working in the project directory: ${cwd}`,
    "You have access to a bash tool for all file operations, shell commands, and git work.",
  ];
  if (settings.systemPromptAdditions) parts.push(settings.systemPromptAdditions);
  if (options?.proqSystemPrompt) parts.push(options.proqSystemPrompt);
  const systemContent = parts.join("\n\n");

  const session: CodexRuntimeSession = {
    taskId,
    projectId,
    cwd,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: prompt },
    ],
    abortController: new AbortController(),
    blocks: [],
    clients: new Set(),
    status: "running",
    pendingResume: null,
    pendingType: null,
    pendingToolCallId: null,
  };

  sessions.set(taskId, session);

  appendBlock(session, { type: "status", subtype: "init", model });

  // Run loop in background; errors are caught and emitted as blocks
  runLoop(session, model).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    appendBlock(session, { type: "status", subtype: "error", error: msg });
    session.status = "error";
    updateTask(projectId, taskId, { agentStatus: null }).catch(() => {});
    emitTaskUpdate(projectId, taskId, { agentStatus: null });
  });
}

export async function continueSession(
  projectId: string,
  taskId: string,
  text: string,
  cwd: string,
  ws?: WebSocket,
  attachments?: TaskAttachment[],
  options?: { planApproved?: boolean },
): Promise<void> {
  const session = sessions.get(taskId);
  if (!session) return;

  // Attach the websocket if provided
  if (ws) session.clients.add(ws);

  // If the session is paused waiting for user input, resume it
  if (session.status === "paused" && session.pendingResume) {
    session.pendingResume(text);
    return;
  }

  // Otherwise start a new turn: append user message and run loop
  session.status = "running";
  session.cwd = cwd;

  const userContent: string[] = [text];
  if (attachments?.length) {
    userContent.push(
      `\n\nAttached files:\n${attachments.map((a) => a.filePath || a.name).join("\n")}`,
    );
  }
  session.messages.push({ role: "user", content: userContent.join("") });

  if (!session.abortController || session.abortController.signal.aborted) {
    session.abortController = new AbortController();
  }

  const settings = await getSettings();
  const model = settings.codexModel || "o4-mini";

  runLoop(session, model).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    appendBlock(session, { type: "status", subtype: "error", error: msg });
    session.status = "error";
    updateTask(projectId, taskId, { agentStatus: null }).catch(() => {});
    emitTaskUpdate(projectId, taskId, { agentStatus: null });
  });
}

export function stopSession(taskId: string): void {
  const session = sessions.get(taskId);
  if (!session) return;
  session.status = "aborted";
  session.abortController?.abort();
  // If paused, unblock the pending promise
  if (session.pendingResume) {
    session.pendingResume("[aborted]");
  }
}

export function isSessionRunning(taskId: string): boolean {
  const session = sessions.get(taskId);
  return session?.status === "running" || session?.status === "paused";
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
  sessions.delete(taskId);
}
