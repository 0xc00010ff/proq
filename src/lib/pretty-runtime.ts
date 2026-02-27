import type { PrettyBlock } from "./types";
import { updateTask, getTask, getSettings } from "./db";
import { notify } from "./agent-dispatch";
import type WebSocket from "ws";

export interface PrettySession {
  taskId: string;
  projectId: string;
  sessionId?: string;
  queryHandle: { close(): void } | null;
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
  // Dynamic import to avoid errors if SDK not installed
  let sdkQuery: typeof import("@anthropic-ai/claude-agent-sdk").query;
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    sdkQuery = sdk.query;
  } catch (err) {
    console.error("[pretty-runtime] Failed to load @anthropic-ai/claude-agent-sdk:", err);
    await updateTask(projectId, taskId, {
      dispatch: null,
      status: "verify",
      findings: "Pretty mode SDK not available. Install @anthropic-ai/claude-agent-sdk.",
      prettyLog: [{ type: "status", subtype: "error", error: "SDK not installed" }],
    });
    return;
  }

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

  // Run in background — don't block processQueue
  (async () => {
    try {
      const abortController = new AbortController();
      const queryGen = sdkQuery({
        prompt,
        options: {
          abortController,
          cwd,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          systemPrompt: settings.systemPromptAdditions || undefined,
          model: settings.defaultModel || undefined,
        },
      });

      session.queryHandle = queryGen;

      // Iterate the async generator
      for await (const msg of queryGen) {
        if (msg.type === "assistant") {
          // SDKAssistantMessage — extract content blocks from BetaMessage
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text") {
                appendBlock(session, { type: "text", text: block.text });
              } else if (block.type === "thinking") {
                appendBlock(session, { type: "thinking", thinking: block.thinking });
              } else if (block.type === "tool_use") {
                appendBlock(session, {
                  type: "tool_use",
                  toolId: block.id,
                  name: block.name,
                  input: block.input as Record<string, unknown>,
                });
              } else if (block.type === "tool_result") {
                const output = typeof block.content === "string"
                  ? block.content
                  : JSON.stringify(block.content);
                appendBlock(session, {
                  type: "tool_result",
                  toolId: block.tool_use_id || "",
                  name: "",
                  output,
                  isError: block.is_error,
                });
              }
            }
          }
          session.sessionId = msg.session_id;
        } else if (msg.type === "result") {
          session.sessionId = msg.session_id;
          const isError = msg.is_error;
          const costUsd = msg.total_cost_usd;
          const resultText = "result" in msg ? (msg as { result?: string }).result : undefined;
          appendBlock(session, {
            type: "status",
            subtype: isError ? "error" : "complete",
            sessionId: msg.session_id,
            costUsd,
            durationMs: msg.duration_ms,
            turns: msg.num_turns,
            error: isError ? (
              "errors" in msg ? (msg as { errors?: string[] }).errors?.join(", ") :
              typeof resultText === "string" ? resultText : "Agent error"
            ) : undefined,
          });
        } else if (msg.type === "user") {
          // SDKUserMessage — contains tool results
          session.sessionId = msg.session_id;
          const userContent = msg.message?.content;
          if (Array.isArray(userContent)) {
            for (const block of userContent) {
              if (typeof block === "object" && block !== null && "type" in block && block.type === "tool_result") {
                const trBlock = block as { tool_use_id: string; content?: unknown; is_error?: boolean };
                const output = typeof trBlock.content === "string"
                  ? trBlock.content
                  : Array.isArray(trBlock.content)
                    ? trBlock.content
                      .filter((c: { type: string }) => c.type === "text")
                      .map((c: { text: string }) => c.text)
                      .join("\n")
                    : JSON.stringify(trBlock.content);
                // Find the matching tool_use to get its name
                const matchingToolUse = session.blocks.find(
                  (b) => b.type === "tool_use" && b.toolId === trBlock.tool_use_id
                );
                appendBlock(session, {
                  type: "tool_result",
                  toolId: trBlock.tool_use_id,
                  name: matchingToolUse && matchingToolUse.type === "tool_use" ? matchingToolUse.name : "",
                  output,
                  isError: trBlock.is_error,
                });
              }
            }
          }
        } else if (msg.type === "system" && "subtype" in msg && msg.subtype === "init") {
          // SDKSystemMessage — update model info
          session.sessionId = msg.session_id;
          const sysMsg = msg as { model?: string; session_id: string };
          if (sysMsg.model) {
            const initBlock = session.blocks.find(
              (b) => b.type === "status" && b.subtype === "init"
            );
            if (initBlock && initBlock.type === "status") {
              initBlock.model = sysMsg.model;
            }
          }
        }
        // Ignore other message types (stream_event, system/status, etc.)
      }

      session.status = "done";

      // Build findings from text blocks
      const textBlocks = session.blocks
        .filter((b): b is Extract<PrettyBlock, { type: "text" }> => b.type === "text");
      const lastText = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : "";
      const findings = lastText.slice(0, 2000);

      // Persist and update task
      await updateTask(projectId, taskId, {
        status: "verify",
        dispatch: null,
        findings,
        prettyLog: session.blocks,
        sessionId: session.sessionId,
      });

      const task = await getTask(projectId, taskId);
      notify(`✅ *${((task?.title || task?.description || "task").slice(0, 40)).replace(/"/g, '\\"')}* → verify`);

    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isAbort = errorMsg.includes("abort") || errorMsg.includes("Abort");
      session.status = isAbort ? "aborted" : "error";

      appendBlock(session, {
        type: "status",
        subtype: isAbort ? "abort" : "error",
        error: isAbort ? "Session aborted" : errorMsg,
        durationMs: Date.now() - startTime,
      });

      await updateTask(projectId, taskId, {
        prettyLog: session.blocks,
        ...(isAbort ? {} : {
          status: "verify",
          dispatch: null,
          findings: `Error: ${errorMsg}`,
        }),
      });
    }
  })();
}

export function stopSession(taskId: string): void {
  const session = sessions.get(taskId);
  if (session && session.status === "running" && session.queryHandle) {
    session.queryHandle.close();
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
