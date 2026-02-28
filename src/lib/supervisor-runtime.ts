import { spawn, type ChildProcess } from "child_process";
import type { PrettyBlock, TaskAttachment } from "./types";
import { getAllProjects, getSupervisorPrettyLog, setSupervisorPrettyLog, getSettings } from "./db";
import type WebSocket from "ws";

const CLAUDE = process.env.CLAUDE_BIN || "claude";

export interface SupervisorSession {
  sessionId?: string;
  queryHandle: ChildProcess | null;
  blocks: PrettyBlock[];
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

function appendBlock(session: SupervisorSession, block: PrettyBlock) {
  session.blocks.push(block);
  broadcast(session, { type: "block", block });
}

// ── System prompt ──

async function buildSupervisorSystemPrompt(): Promise<string> {
  const projects = await getAllProjects();
  const projectList = projects
    .map((p) => `- **${p.name}** (id: \`${p.id}\`, path: \`${p.path}\`${p.serverUrl ? `, server: ${p.serverUrl}` : ""})`)
    .join("\n");

  return `You are the Supervisor for proq — a task orchestration board for AI-assisted development running at http://localhost:1337.

Your working directory is the proq codebase itself. You preside over all of proq's functionality and the currently loaded projects.

## Currently Loaded Projects

${projectList || "(no projects loaded)"}

## Available API Endpoints

You can manage projects and tasks by calling the REST API with curl or other tools.

Projects:
  GET    http://localhost:1337/api/projects                         — List all projects
  POST   http://localhost:1337/api/projects                         — Create project { name, path, serverUrl? }
  GET    http://localhost:1337/api/projects/{id}                    — Get project details
  PATCH  http://localhost:1337/api/projects/{id}                    — Update project
  DELETE http://localhost:1337/api/projects/{id}                    — Delete project

Tasks:
  GET    http://localhost:1337/api/projects/{id}/tasks              — List tasks (returns columns: todo, in-progress, verify, done)
  POST   http://localhost:1337/api/projects/{id}/tasks              — Create task { title?, description, priority?, mode? }
  PATCH  http://localhost:1337/api/projects/{id}/tasks/{taskId}     — Update task (status, title, description, findings, etc.)
  DELETE http://localhost:1337/api/projects/{id}/tasks/{taskId}     — Delete task
  PUT    http://localhost:1337/api/projects/{id}/tasks/reorder      — Bulk reorder tasks

Task lifecycle: todo → in-progress → verify → done
When a task moves to "in-progress", it gets dispatched to a Claude Code agent automatically.
When setting status to "in-progress", also set dispatch to "queued".

Chat:
  GET    http://localhost:1337/api/projects/{id}/chat               — Get project chat log
  POST   http://localhost:1337/api/projects/{id}/chat               — Add chat message

Cross-project:
  GET    http://localhost:1337/api/agent/tasks                      — All currently in-progress tasks across all projects

## Guidelines

- Stay focused on proq management unless explicitly asked to do something else.
- Be concise and action-oriented. When creating or updating tasks, confirm what you did.
- You can read and modify files in any of the loaded project directories.
- When the user asks about a project, check its tasks and status first.`;
}

// ── Stream event processing (shared with pretty-runtime) ──

function processStreamEvent(session: SupervisorSession, event: Record<string, unknown>) {
  const type = event.type as string;

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

  proc.on("close", async (code) => {
    if (stdoutBuffer.trim()) {
      try {
        const event = JSON.parse(stdoutBuffer.trim());
        processStreamEvent(session, event);
      } catch {
        // ignore
      }
    }

    if (session.status === "aborted") {
      await setSupervisorPrettyLog(session.blocks, session.sessionId);
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

    await setSupervisorPrettyLog(session.blocks, session.sessionId);
  });

  proc.on("error", async (err) => {
    session.status = "error";
    appendBlock(session, {
      type: "status",
      subtype: "error",
      error: err.message,
      durationMs: Date.now() - startTime,
    });
    await setSupervisorPrettyLog(session.blocks, session.sessionId);
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

  appendBlock(session, { type: "status", subtype: "init", model: settings.defaultModel || undefined });
  appendBlock(session, { type: "user", text });

  const startTime = Date.now();

  const args: string[] = [
    "-p", text,
    "--output-format", "stream-json",
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

  const proc = spawn(CLAUDE, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined },
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
    const stored = await getSupervisorPrettyLog();
    if (!stored.sessionId) {
      throw new Error("No session to continue — no sessionId stored");
    }
    session = {
      sessionId: stored.sessionId,
      queryHandle: null,
      blocks: stored.prettyLog || [],
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
    "-p", text,
    "--output-format", "stream-json",
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

  const proc = spawn(CLAUDE, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined },
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
  await setSupervisorPrettyLog([], undefined);
}
