import { spawn, type ChildProcess } from "child_process";
import type { AgentBlock, TaskAttachment } from "./types";
import { getAllProjects, getSupervisorAgentBlocks, setSupervisorAgentBlocks, getSettings } from "./db";
import { getClaudeBin } from "./claude-bin";
import { escapePrompt } from "./utils";
import type WebSocket from "ws";

export interface SupervisorSession {
  sessionId?: string;
  queryHandle: ChildProcess | null;
  blocks: AgentBlock[];
  clients: Set<WebSocket>;
  status: "running" | "done" | "error" | "aborted";
}

// ── Singleton on globalThis to survive HMR ──
const g = globalThis as unknown as {
  __proqSupervisorSession?: SupervisorSession;
};

function getSessionRef(): SupervisorSession | null {
  return g.__proqSupervisorSession ?? null;
}

function setSessionRef(session: SupervisorSession | null) {
  if (session) {
    g.__proqSupervisorSession = session;
  } else {
    delete g.__proqSupervisorSession;
  }
}

function broadcast(session: SupervisorSession, msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of session.clients) {
    try {
      if (ws.readyState === 1) ws.send(data);
    } catch {
      // client gone
    }
  }
}

function appendBlock(session: SupervisorSession, block: AgentBlock) {
  session.blocks.push(block);
  broadcast(session, { type: "block", block });
}

// ── System prompt ──

async function buildSupervisorSystemPrompt(): Promise<string> {
  const projects = await getAllProjects();
  const projectList = projects
    .map((p) => `- **${p.name}** (id: \`${p.id}\`, path: \`${p.path}\`${p.serverUrl ? `, server: ${p.serverUrl}` : ""})`)
    .join("\n");

  const PROQ_API = `http://localhost:${process.env.PORT || 1337}`;

  return `You are the Supervisor for proq — a task orchestration board for AI-assisted development running at ${PROQ_API}.

Your working directory is the proq codebase itself. You preside over all of proq's functionality and the currently loaded projects.

## Currently Loaded Projects

${projectList || "(no projects loaded)"}

## Available API Endpoints

You can manage projects and tasks by calling the REST API with curl or other tools.

Projects:
  GET    ${PROQ_API}/api/projects                         — List all projects
  POST   ${PROQ_API}/api/projects                         — Create project { name, path, serverUrl? }
  GET    ${PROQ_API}/api/projects/{id}                    — Get project details
  PATCH  ${PROQ_API}/api/projects/{id}                    — Update project
  DELETE ${PROQ_API}/api/projects/{id}                    — Delete project

Tasks:
  GET    ${PROQ_API}/api/projects/{id}/tasks              — List tasks (returns columns: todo, in-progress, verify, done)
  POST   ${PROQ_API}/api/projects/{id}/tasks              — Create task { title?, description, priority?, mode? }
  PATCH  ${PROQ_API}/api/projects/{id}/tasks/{taskId}     — Update task (status, title, description, summary, etc.)
  DELETE ${PROQ_API}/api/projects/{id}/tasks/{taskId}     — Delete task
  POST   ${PROQ_API}/api/projects/{id}/tasks/{taskId}/dispatch — Dispatch a task (moves to in-progress and launches agent)
  PUT    ${PROQ_API}/api/projects/{id}/tasks/reorder      — Bulk reorder tasks

Dispatching tasks:
  The simplest way to create and dispatch a task is to POST to create it, then POST to its /dispatch endpoint.
  Alternatively, PATCH the task with { status: "in-progress", agentStatus: "queued" } — this also triggers dispatch.

Task modes:
  - \`auto\` (default) — Full autonomy, agent decides what to do
  - \`build\` — Code changes expected, agent commits incrementally
  - \`plan\` — Agent proposes a plan first, waits for human approval before executing
  - \`answer\` — Research only, no code changes unless the human asks for them later
  Set the mode when creating or updating a task: { mode: "plan" }

Task lifecycle: todo → in-progress → verify → done

Execution modes (per-project):
  GET/PATCH ${PROQ_API}/api/projects/{id}/execution-mode  — Get or set execution mode
  - \`sequential\` — One task at a time per project (default)
  - \`parallel\` — All queued tasks dispatch immediately, sharing the same directory
  - \`worktrees\` — Each task gets its own git worktree and branch for isolation

Cron jobs:
  GET    ${PROQ_API}/api/projects/{id}/crons              — List cron jobs
  POST   ${PROQ_API}/api/projects/{id}/crons              — Create cron { name, prompt, schedule, mode?, enabled? }
  PATCH  ${PROQ_API}/api/projects/{id}/crons/{cronId}     — Update cron job
  DELETE ${PROQ_API}/api/projects/{id}/crons/{cronId}     — Delete cron job
  POST   ${PROQ_API}/api/projects/{id}/crons/{cronId}/trigger — Trigger cron manually

Chat:
  GET    ${PROQ_API}/api/projects/{id}/chat               — Get project chat log
  POST   ${PROQ_API}/api/projects/{id}/chat               — Add chat message

Cross-project:
  GET    ${PROQ_API}/api/agent/tasks                      — All currently in-progress tasks across all projects

Settings:
  GET    ${PROQ_API}/api/settings                         — Get global settings
  PATCH  ${PROQ_API}/api/settings                         — Update settings

## Guidelines

- Stay focused on proq management unless explicitly asked to do something else.
- Be concise and action-oriented. When creating or updating tasks, confirm what you did.
- You can read and modify files in any of the loaded project directories.
- When the user asks about a project, check its tasks and status first.`;
}

// ── Stream event processing ──

function processStreamEvent(session: SupervisorSession, event: Record<string, unknown>) {
  const type = event.type as string;
  // Handle raw streaming deltas from Claude CLI
  if (type === "stream_event") {
    const inner = event.event as Record<string, unknown> | undefined;
    if (inner?.type === "content_block_delta") {
      const delta = inner.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        broadcast(session, { type: "stream_delta", text: delta.text });
      }
    }
    return;
  }

  if (type === "system") {
    const subtype = event.subtype as string | undefined;
    if (subtype === "init") {
      session.sessionId = event.session_id as string | undefined;
      const model = event.model as string | undefined;
      if (model) {
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

    if (isError) {
      session.status = "error";
    } else {
      session.status = "done";
    }
  }
}

// ── Wire a child process to the session ──

function wireProcess(session: SupervisorSession, proc: ChildProcess, startTime: number) {
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
    if (stdoutBuffer.trim()) {
      try {
        const event = JSON.parse(stdoutBuffer.trim());
        processStreamEvent(session, event);
      } catch {
        // ignore
      }
    }

    if (session.status === "aborted") {
      await setSupervisorAgentBlocks(session.blocks, session.sessionId);
      return;
    }

    // When killed with SIGTERM (e.g. ExitPlanMode, AskUserQuestion), code is null — not an error
    const intentionalKill = code === null && signal === "SIGTERM";

    if (code !== 0 && !intentionalKill && session.status === "running") {
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
      appendBlock(session, {
        type: "status",
        subtype: "complete",
        durationMs: Date.now() - startTime,
      });
    }

    await setSupervisorAgentBlocks(session.blocks, session.sessionId);
  });

  proc.on("error", async (err) => {
    session.status = "error";
    appendBlock(session, {
      type: "status",
      subtype: "error",
      error: err.message,
      durationMs: Date.now() - startTime,
    });
    await setSupervisorAgentBlocks(session.blocks, session.sessionId);
  });
}

// ── Public API ──

export async function startSupervisorSession(text: string): Promise<void> {
  const existing = getSessionRef();
  if (existing?.status === "running") {
    throw new Error("Supervisor session is already running");
  }

  const session: SupervisorSession = {
    queryHandle: null,
    blocks: [],
    clients: new Set(),
    status: "running",
  };
  setSessionRef(session);

  const settings = await getSettings();
  const systemPrompt = await buildSupervisorSystemPrompt();

  appendBlock(session, { type: "status", subtype: "init", model: settings.defaultModel || undefined, timestamp: new Date().toISOString() });
  appendBlock(session, { type: "user", text });

  const startTime = Date.now();

  const args: string[] = [
    "-p", escapePrompt(text),
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns", "200",
  ];

  if (settings.defaultModel) {
    args.push("--model", settings.defaultModel);
  }

  const systemParts: string[] = [];
  if (settings.systemPromptAdditions) systemParts.push(settings.systemPromptAdditions);
  systemParts.push(systemPrompt);
  args.push("--append-system-prompt", systemParts.join("\n\n"));

  const claudeBin = await getClaudeBin();
  const proc = spawn(claudeBin, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined, PROQ_API: `http://localhost:${process.env.PORT || 1337}` },
  });

  session.queryHandle = proc;
  wireProcess(session, proc, startTime);
}

export async function continueSupervisorSession(
  text: string,
  preAttachClient?: WebSocket,
  attachments?: TaskAttachment[],
): Promise<void> {
  let session = getSessionRef();

  // Reconstruct from DB if no in-memory session
  if (!session) {
    const stored = await getSupervisorAgentBlocks();
    if (!stored.sessionId) {
      throw new Error("No session to continue — no sessionId stored");
    }
    session = {
      sessionId: stored.sessionId,
      queryHandle: null,
      blocks: stored.agentBlocks || [],
      clients: new Set(),
      status: "done",
    };
    setSessionRef(session);
  }

  if (preAttachClient && !session.clients.has(preAttachClient)) {
    session.clients.add(preAttachClient);
  }

  if (session.status === "running") {
    throw new Error("Session is already running");
  }

  appendBlock(session, { type: "user", text, attachments: attachments?.length ? attachments : undefined });

  const settings = await getSettings();
  session.status = "running";

  const startTime = Date.now();
  const systemPrompt = await buildSupervisorSystemPrompt();

  const args: string[] = [
    "--resume", session.sessionId!,
    "-p", escapePrompt(text),
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns", "200",
  ];

  if (settings.defaultModel) {
    args.push("--model", settings.defaultModel);
  }

  const systemParts: string[] = [];
  if (settings.systemPromptAdditions) systemParts.push(settings.systemPromptAdditions);
  systemParts.push(systemPrompt);
  args.push("--append-system-prompt", systemParts.join("\n\n"));

  const claudeBin = await getClaudeBin();
  const proc = spawn(claudeBin, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined, PROQ_API: `http://localhost:${process.env.PORT || 1337}` },
  });

  session.queryHandle = proc;
  wireProcess(session, proc, startTime);
}

export function stopSupervisorSession(): void {
  const session = getSessionRef();
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

export function getSupervisorSession(): SupervisorSession | null {
  return getSessionRef();
}

export function attachSupervisorClient(ws: WebSocket): void {
  const session = getSessionRef();
  if (session) {
    session.clients.add(ws);
  }
}

export function detachSupervisorClient(ws: WebSocket): void {
  const session = getSessionRef();
  if (session) {
    session.clients.delete(ws);
  }
}

export async function clearSupervisorSessionData(): Promise<void> {
  const session = getSessionRef();
  if (session?.status === "running" && session.queryHandle) {
    session.status = "aborted";
    session.queryHandle.kill("SIGTERM");
  }
  setSessionRef(null);
  await setSupervisorAgentBlocks([], undefined);
}
