import { spawn, type ChildProcess } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { PrettyBlock, TaskAttachment } from "./types";
import { updateTask, getTask, getProject, getSettings } from "./db";
import { notify, buildProqSystemPrompt, writeMcpConfig } from "./agent-dispatch";
import type WebSocket from "ws";

const CLAUDE = process.env.CLAUDE_BIN || "claude";

export interface PrettySession {
  taskId: string;
  projectId: string;
  sessionId?: string;
  mcpConfig?: string;
  queryHandle: ChildProcess | null;
  blocks: PrettyBlock[];
  clients: Set<WebSocket>;
  status: "running" | "done" | "error" | "aborted";
}

// ── Singleton attached to globalThis to survive HMR ──
const g = globalThis as unknown as {
  __proqPrettySessions?: Map<string, PrettySession>;
};
if (!g.__proqPrettySessions) g.__proqPrettySessions = new Map();

const sessions = g.__proqPrettySessions;

function broadcast(session: PrettySession, msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of session.clients) {
    try {
      if (ws.readyState === 1) ws.send(data);
    } catch {
      // client gone
    }
  }
}

function appendBlock(session: PrettySession, block: PrettyBlock) {
  session.blocks.push(block);
  broadcast(session, { type: "block", block });
}

// ── Shared process wiring ──
// Handles stdout parsing, stderr capture, close/error handlers.
function wireProcess(
  session: PrettySession,
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

  proc.on("close", async (code) => {
    // Process any remaining buffered data
    if (stdoutBuffer.trim()) {
      try {
        const event = JSON.parse(stdoutBuffer.trim());
        processStreamEvent(session, event);
      } catch {
        // ignore
      }
    }

    if (session.status === "aborted") {
      await updateTask(projectId, taskId, {
        prettyLog: session.blocks,
      });
      return;
    }

    if (code !== 0 && session.status === "running") {
      session.status = "error";
      const errorMsg = stderrOutput.trim() || `CLI exited with code ${code}`;
      appendBlock(session, {
        type: "status",
        subtype: "error",
        error: errorMsg,
        durationMs: Date.now() - startTime,
      });
    } else if (session.status === "running") {
      session.status = "done";
    }

    // Check if the last tool_use was AskUserQuestion — surface as humanSteps
    const lastToolUse = [...session.blocks].reverse().find((b) => b.type === "tool_use");
    const endedOnQuestion = lastToolUse?.type === "tool_use" && lastToolUse.name === "AskUserQuestion";
    let questionFields: { humanSteps?: string; findings?: string } = {};
    if (endedOnQuestion) {
      const input = lastToolUse.input as Record<string, unknown>;
      const questions = Array.isArray(input.questions) ? input.questions as { question: string }[] : [];
      const questionText = questions.map((q) => q.question).join("\n");
      if (questionText) {
        questionFields = { humanSteps: questionText, findings: "Agent has a question — see below." };
      }
    }

    // Check if task is still in-progress (agent didn't call update_task)
    const task = await getTask(projectId, taskId);
    const stillInProgress = task?.status === "in-progress";

    if (stillInProgress) {
      // Safety net: move to verify and clear dispatch
      await updateTask(projectId, taskId, {
        status: "verify",
        dispatch: null,
        findings: session.status === "error"
          ? `Error: ${stderrOutput.trim() || `CLI exited with code ${code}`}`
          : undefined,
        ...questionFields,
        prettyLog: session.blocks,
        sessionId: session.sessionId,
      });
      notify(`✅ *${((task?.title || task?.description || "task").slice(0, 40)).replace(/"/g, '\\"')}* → verify`);
    } else {
      // Agent already handled status via update_task — just persist prettyLog
      await updateTask(projectId, taskId, {
        prettyLog: session.blocks,
        sessionId: session.sessionId,
      });
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
        dispatch: null,
        findings: `Error: ${errorMsg}`,
        prettyLog: session.blocks,
      });
    } else {
      await updateTask(projectId, taskId, {
        prettyLog: session.blocks,
      });
    }
  });
}

export async function startSession(
  projectId: string,
  taskId: string,
  prompt: string,
  cwd: string,
  options?: { model?: string; proqSystemPrompt?: string; mcpConfig?: string },
): Promise<void> {
  const session: PrettySession = {
    taskId,
    projectId,
    queryHandle: null,
    blocks: [],
    clients: new Set(),
    status: "running",
  };
  sessions.set(taskId, session);

  const settings = await getSettings();

  // Emit init status
  appendBlock(session, {
    type: "status",
    subtype: "init",
    model: settings.defaultModel || undefined,
  });

  // Show the original prompt in the chatlog
  appendBlock(session, { type: "user", text: prompt });

  const startTime = Date.now();

  // Build CLI args
  const args: string[] = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns", "200",
  ];

  if (settings.defaultModel) {
    args.push("--model", settings.defaultModel);
  }

  // Combine user's system prompt additions with proq system prompt
  const systemParts: string[] = [];
  if (settings.systemPromptAdditions) systemParts.push(settings.systemPromptAdditions);
  if (options?.proqSystemPrompt) systemParts.push(options.proqSystemPrompt);
  if (systemParts.length > 0) {
    args.push("--append-system-prompt", systemParts.join("\n\n"));
  }

  if (options?.mcpConfig) {
    args.push("--mcp-config", options.mcpConfig);
    session.mcpConfig = options.mcpConfig;
  }

  // Spawn the CLI child process
  const proc = spawn(CLAUDE, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined },
  });

  session.queryHandle = proc;

  wireProcess(session, proc, { startTime, projectId, taskId });
}

function processStreamEvent(session: PrettySession, event: Record<string, unknown>) {
  const type = event.type as string;

  if (type === "system") {
    const subtype = event.subtype as string | undefined;
    if (subtype === "init") {
      session.sessionId = event.session_id as string | undefined;
      const model = event.model as string | undefined;
      if (model) {
        // Update the most recent init block's model
        const initBlocks = session.blocks.filter(
          (b) => b.type === "status" && b.subtype === "init"
        );
        const lastInit = initBlocks[initBlocks.length - 1];
        if (lastInit && lastInit.type === "status") {
          lastInit.model = model;
        }
      }
    }
  } else if (type === "assistant") {
    session.sessionId = event.session_id as string | undefined;
    const message = event.message as { content?: unknown[] } | undefined;
    const content = message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "text") {
          appendBlock(session, { type: "text", text: b.text as string });
        } else if (b.type === "thinking") {
          appendBlock(session, { type: "thinking", thinking: b.thinking as string });
        } else if (b.type === "tool_use") {
          appendBlock(session, {
            type: "tool_use",
            toolId: b.id as string,
            name: b.name as string,
            input: b.input as Record<string, unknown>,
          });
        }
      }
    }
  } else if (type === "user") {
    session.sessionId = event.session_id as string | undefined;
    const message = event.message as { content?: unknown[] } | undefined;
    const userContent = message?.content;
    if (Array.isArray(userContent)) {
      for (const block of userContent) {
        const b = block as Record<string, unknown>;
        if (b.type === "tool_result") {
          const output = typeof b.content === "string"
            ? b.content
            : Array.isArray(b.content)
              ? (b.content as { type: string; text: string }[])
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n")
              : JSON.stringify(b.content);
          // Find the matching tool_use to get its name
          const matchingToolUse = session.blocks.find(
            (bl) => bl.type === "tool_use" && bl.toolId === b.tool_use_id
          );
          appendBlock(session, {
            type: "tool_result",
            toolId: b.tool_use_id as string,
            name: matchingToolUse && matchingToolUse.type === "tool_use" ? matchingToolUse.name : "",
            output,
            isError: b.is_error as boolean | undefined,
          });
        }
      }
    }
  } else if (type === "result") {
    session.sessionId = event.session_id as string | undefined;
    const isError = event.is_error as boolean | undefined;
    const costUsd = event.total_cost_usd as number | undefined;
    const resultText = event.result as string | undefined;

    appendBlock(session, {
      type: "status",
      subtype: isError ? "error" : "complete",
      sessionId: event.session_id as string | undefined,
      costUsd,
      durationMs: event.duration_ms as number | undefined,
      turns: event.num_turns as number | undefined,
      error: isError ? (resultText || "Agent error") : undefined,
    });

    // Mark session done/error based on result — actual DB persistence happens in wireProcess close handler
    if (isError) {
      session.status = "error";
    } else {
      session.status = "done";
    }
  }
}

export async function continueSession(
  projectId: string,
  taskId: string,
  text: string,
  cwd: string,
  preAttachClient?: WebSocket,
  attachments?: TaskAttachment[],
): Promise<void> {
  let session = sessions.get(taskId);
  let taskMode: string | undefined;

  // If no in-memory session, reconstruct from DB
  if (!session) {
    const task = await getTask(projectId, taskId);
    if (!task?.sessionId) {
      throw new Error("No session to continue — no sessionId on task");
    }
    taskMode = task.mode;
    session = {
      taskId,
      projectId,
      sessionId: task.sessionId,
      queryHandle: null,
      blocks: task.prettyLog || [],
      clients: new Set(),
      status: "done",
    };
    sessions.set(taskId, session);
  } else {
    // Fetch task mode for system prompt
    const task = await getTask(projectId, taskId);
    taskMode = task?.mode;
  }

  // Attach client before appending any blocks so it receives the user message
  if (preAttachClient && !session.clients.has(preAttachClient)) {
    session.clients.add(preAttachClient);
  }

  if (session.status === "running") {
    throw new Error("Session is already running");
  }

  // Append user block so it renders immediately
  appendBlock(session, { type: "user", text, attachments: attachments?.length ? attachments : undefined });

  const settings = await getSettings();
  session.status = "running";

  const startTime = Date.now();

  // Write image attachments to temp files so the agent can read them
  let promptText = text;
  if (attachments?.length) {
    const imageFiles: string[] = [];
    const attachDir = join(tmpdir(), "proq-prompts", `followup-${taskId.slice(0, 8)}-${Date.now()}`);
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
      promptText += `\n\n## Attached Images\nThe following image files are attached to this message. Use your Read tool to view them:\n${imageFiles.map((f) => `- ${f}`).join("\n")}\n`;
    }
  }

  // Build CLI args for resume
  const args: string[] = [
    "--resume", session.sessionId!,
    "-p", promptText,
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns", "200",
  ];

  if (settings.defaultModel) {
    args.push("--model", settings.defaultModel);
  }

  // Combine user's system prompt additions with proq system prompt
  const systemParts: string[] = [];
  if (settings.systemPromptAdditions) systemParts.push(settings.systemPromptAdditions);
  const project = await getProject(projectId);
  const proqSysPrompt = buildProqSystemPrompt(projectId, taskId, taskMode as "code" | "plan" | "answer" | undefined, project?.name);
  systemParts.push(proqSysPrompt);
  if (systemParts.length > 0) {
    args.push("--append-system-prompt", systemParts.join("\n\n"));
  }

  // Ensure MCP config is available (may need to recreate after server restart)
  if (!session.mcpConfig) {
    session.mcpConfig = writeMcpConfig(projectId, taskId);
  }
  args.push("--mcp-config", session.mcpConfig);

  const proc = spawn(CLAUDE, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined },
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

export function getSession(taskId: string): PrettySession | null {
  return sessions.get(taskId) ?? null;
}

export function attachClient(taskId: string, ws: WebSocket): void {
  const session = sessions.get(taskId);
  if (session) {
    session.clients.add(ws);
  }
}

export function detachClient(taskId: string, ws: WebSocket): void {
  const session = sessions.get(taskId);
  if (session) {
    session.clients.delete(ws);
  }
}

export function clearSession(taskId: string): void {
  const session = sessions.get(taskId);
  if (session) {
    session.clients.clear();
    sessions.delete(taskId);
  }
}

export function injectBlock(taskId: string, block: PrettyBlock): void {
  const session = sessions.get(taskId);
  if (session) {
    appendBlock(session, block);
  }
}

export function isSessionRunning(taskId: string): boolean {
  const session = sessions.get(taskId);
  return session?.status === "running";
}
