import { spawn, type ChildProcess } from "child_process";
import type { PrettyBlock } from "./types";
import { updateTask, getTask, getSettings } from "./db";
import { notify } from "./agent-dispatch";
import type WebSocket from "ws";

const CLAUDE = process.env.CLAUDE_BIN || "claude";

export interface PrettySession {
  taskId: string;
  projectId: string;
  sessionId?: string;
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

export async function startSession(
  projectId: string,
  taskId: string,
  prompt: string,
  cwd: string,
  _options?: { model?: string },
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
  if (settings.systemPromptAdditions) {
    args.push("--append-system-prompt", settings.systemPromptAdditions);
  }

  // Spawn the CLI child process
  const proc = spawn(CLAUDE, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined },
  });

  session.queryHandle = proc;

  // Parse stdout line-by-line for stream-json events
  let stdoutBuffer = "";

  proc.stdout!.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    // Keep the last (possibly incomplete) line in the buffer
    stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue; // skip non-JSON lines
      }

      processStreamEvent(session, event);
    }
  });

  let stderrOutput = "";
  proc.stderr!.on("data", (chunk: Buffer) => {
    stderrOutput += chunk.toString();
  });

  // Handle process exit
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
      // Already handled by stopSession — just persist
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
      await updateTask(projectId, taskId, {
        status: "verify",
        dispatch: null,
        findings: `Error: ${errorMsg}`,
        prettyLog: session.blocks,
      });
      return;
    }

    // Normal completion — if no result event was emitted, finalize here
    if (session.status === "running") {
      session.status = "done";

      // Build findings from text blocks
      const textBlocks = session.blocks
        .filter((b): b is Extract<PrettyBlock, { type: "text" }> => b.type === "text");
      const lastText = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : "";
      const findings = lastText.slice(0, 2000);

      await updateTask(projectId, taskId, {
        status: "verify",
        dispatch: null,
        findings,
        prettyLog: session.blocks,
        sessionId: session.sessionId,
      });

      const task = await getTask(projectId, taskId);
      notify(`✅ *${((task?.title || task?.description || "task").slice(0, 40)).replace(/"/g, '\\"')}* → verify`);
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
    await updateTask(projectId, taskId, {
      status: "verify",
      dispatch: null,
      findings: `Error: ${errorMsg}`,
      prettyLog: session.blocks,
    });
  });
}

function processStreamEvent(session: PrettySession, event: Record<string, unknown>) {
  const type = event.type as string;

  if (type === "system") {
    const subtype = event.subtype as string | undefined;
    if (subtype === "init") {
      session.sessionId = event.session_id as string | undefined;
      const model = event.model as string | undefined;
      if (model) {
        const initBlock = session.blocks.find(
          (b) => b.type === "status" && b.subtype === "init"
        );
        if (initBlock && initBlock.type === "status") {
          initBlock.model = model;
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

    // Mark session done/error based on result
    if (isError) {
      session.status = "error";
    } else {
      session.status = "done";
    }

    // Build findings from text blocks
    const textBlocks = session.blocks
      .filter((b): b is Extract<PrettyBlock, { type: "text" }> => b.type === "text");
    const lastText = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : "";
    const findings = lastText.slice(0, 2000);

    // Persist and update task
    updateTask(session.projectId, session.taskId, {
      status: "verify",
      dispatch: null,
      findings: isError ? `Error: ${resultText || "Agent error"}` : findings,
      prettyLog: session.blocks,
      sessionId: session.sessionId,
    }).then(async () => {
      if (!isError) {
        const task = await getTask(session.projectId, session.taskId);
        notify(`✅ *${((task?.title || task?.description || "task").slice(0, 40)).replace(/"/g, '\\"')}* → verify`);
      }
    });
  }
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

export function isSessionRunning(taskId: string): boolean {
  const session = sessions.get(taskId);
  return session?.status === "running";
}
