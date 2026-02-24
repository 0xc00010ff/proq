import { spawn, type ChildProcess } from "child_process";
import type { ChatLogEntry, ToolCall } from "./types";

const CLAUDE = process.env.CLAUDE_BIN || "claude";
const MODEL = process.env.SUPERVISOR_MODEL || "sonnet";

// ── Types ────────────────────────────────────────────────

export type SupervisorChunk =
  | { type: "tool_call"; action: string; detail: string }
  | { type: "text_delta"; text: string }
  | { type: "result"; text: string }
  | { type: "error"; error: string };

// ── System prompt ────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are the Supervisor for proq — a task orchestration board for AI-assisted development running at http://localhost:7331.

You can manage projects and tasks by calling the REST API. Here are the available endpoints:

Projects:
  GET    /api/projects                         — List all projects
  POST   /api/projects                         — Create project { name, path, serverUrl? }
  GET    /api/projects/{id}                    — Get project details
  PATCH  /api/projects/{id}                    — Update project
  DELETE /api/projects/{id}                    — Delete project

Tasks:
  GET    /api/projects/{id}/tasks              — List tasks (returns columns: todo, in-progress, verify, done)
  POST   /api/projects/{id}/tasks              — Create task { title?, description, priority? }
  PATCH  /api/projects/{id}/tasks/{taskId}     — Update task (status, title, description, findings, etc.)
  DELETE /api/projects/{id}/tasks/{taskId}     — Delete task
  PUT    /api/projects/{id}/tasks/reorder      — Bulk reorder tasks

Task lifecycle: todo → in-progress → verify → done
When a task moves to "in-progress", it gets dispatched to a Claude Code agent automatically.
When setting status to "in-progress", also set dispatch to "queued".

Chat:
  GET    /api/projects/{id}/chat               — Get project chat log
  POST   /api/projects/{id}/chat               — Add chat message

Cross-project:
  GET    /api/agent/tasks                      — All currently in-progress tasks across all projects

Stay focused on proq management unless explicitly asked to do something else.
Be concise and action-oriented. When creating or updating tasks, confirm what you did.
Your working directory is the proq codebase itself.`;
}

// ── Conversation prompt ──────────────────────────────────

function buildConversationPrompt(
  history: ChatLogEntry[],
  userMessage: string,
  maxMessages = 20,
): string {
  const recent = history.slice(-maxMessages);
  const lines = recent.map((msg) => {
    const role = msg.role === "user" ? "User" : "Supervisor";
    return `${role}: ${msg.message}`;
  });
  lines.push(`User: ${userMessage}`);
  return lines.join("\n\n");
}

// ── Tool detail formatting ───────────────────────────────

function formatToolDetail(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "Bash" && input.command) return String(input.command).slice(0, 200);
  if (toolName === "Read" && input.file_path) return String(input.file_path);
  if (toolName === "Write" && input.file_path) return String(input.file_path);
  if (toolName === "Edit" && input.file_path) return String(input.file_path);
  if (toolName === "Glob" && input.pattern) return String(input.pattern);
  if (toolName === "Grep" && input.pattern) return String(input.pattern);
  if ((toolName === "WebFetch" || toolName === "WebSearch") && (input.url || input.query))
    return String(input.url || input.query);

  // Generic: show first key=value
  const entries = Object.entries(input);
  if (entries.length === 0) return "";
  const [k, v] = entries[0];
  return `${k}=${String(v).slice(0, 120)}`;
}

// ── Main runner ──────────────────────────────────────────

export async function* runSupervisor(
  history: ChatLogEntry[],
  userMessage: string,
  signal?: AbortSignal,
): AsyncGenerator<SupervisorChunk> {
  const systemPrompt = buildSystemPrompt();
  const conversationPrompt = buildConversationPrompt(history, userMessage);

  const args = [
    "--print",
    "--verbose",
    "--dangerously-skip-permissions",
    "--output-format", "stream-json",
    "--model", MODEL,
    "--append-system-prompt", systemPrompt,
    "-p", conversationPrompt,
  ];

  // Strip env vars that would confuse a nested Claude instance
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.PORT;

  let child: ChildProcess;
  try {
    child = spawn(CLAUDE, args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    yield { type: "error", error: `Failed to spawn claude: ${err}` };
    return;
  }

  // Handle abort
  if (signal) {
    const onAbort = () => {
      child.kill("SIGTERM");
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("close", () => signal.removeEventListener("abort", onAbort));
  }

  // Track tool calls we've already emitted to avoid duplicates
  const emittedTools = new Set<string>();

  let buffer = "";
  const lines: string[] = [];

  const processLine = function* (line: string): Generator<SupervisorChunk> {
    if (!line.trim()) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    const msgType = parsed.type as string;

    // assistant message — extract tool_use blocks
    if (msgType === "assistant" && parsed.message) {
      const msg = parsed.message as { content?: Array<Record<string, unknown>> };
      if (msg.content) {
        for (const block of msg.content) {
          if (block.type === "tool_use" && block.name) {
            const toolKey = `${block.id}`;
            if (!emittedTools.has(toolKey)) {
              emittedTools.add(toolKey);
              yield {
                type: "tool_call",
                action: String(block.name),
                detail: formatToolDetail(
                  String(block.name),
                  (block.input as Record<string, unknown>) || {},
                ),
              };
            }
          }
        }
      }
    }

    // content_block_delta — text streaming
    if (msgType === "content_block_delta") {
      const delta = parsed.delta as { type?: string; text?: string } | undefined;
      if (delta?.type === "text_delta" && delta.text) {
        yield { type: "text_delta", text: delta.text };
      }
    }

    // result — final output
    if (msgType === "result") {
      const result = parsed.result as string | undefined;
      if (result) {
        yield { type: "result", text: result };
      }
    }
  };

  // Collect stderr concurrently to avoid deadlock
  // (if stderr buffer fills, child blocks and stdout never closes)
  let stderr = "";
  if (child.stderr) {
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
  }

  // Read stdout line-by-line
  if (child.stdout) {
    for await (const chunk of child.stdout) {
      buffer += chunk.toString();
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        yield* processLine(part);
      }
    }
  }
  // Process remaining buffer
  if (buffer.trim()) {
    yield* processLine(buffer);
  }

  // Wait for exit
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
    } else {
      child.on("close", () => resolve());
    }
  });

  if (child.exitCode && child.exitCode !== 0) {
    yield { type: "error", error: stderr.trim().slice(0, 500) || `Process exited with code ${child.exitCode}` };
  }
}
