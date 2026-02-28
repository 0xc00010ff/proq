import { spawn, type ChildProcess } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { PrettyBlock, TaskAttachment } from "./types";
import { getAgentTabData, setAgentTabData, getSettings, getProject } from "./db";
import type WebSocket from "ws";

const CLAUDE = process.env.CLAUDE_BIN || "claude";

export interface AgentTabSession {
  tabId: string;
  projectId: string;
  sessionId?: string;
  queryHandle: ChildProcess | null;
  blocks: PrettyBlock[];
  clients: Set<WebSocket>;
  status: "running" | "done" | "error" | "aborted";
}

// ── Multi-session Map on globalThis to survive HMR ──
const g = globalThis as unknown as {
  __proqAgentTabSessions?: Map<string, AgentTabSession>;
};
if (!g.__proqAgentTabSessions) g.__proqAgentTabSessions = new Map();

const sessions = g.__proqAgentTabSessions;

function broadcast(session: AgentTabSession, msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of session.clients) {
    try {
      if (ws.readyState === 1) ws.send(data);
    } catch {
      // client gone
    }
  }
}

function appendBlock(session: AgentTabSession, block: PrettyBlock) {
  session.blocks.push(block);
  broadcast(session, { type: "block", block });
}

// ── Stream event processing (same as supervisor-runtime) ──

function processStreamEvent(session: AgentTabSession, event: Record<string, unknown>) {
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

function wireProcess(session: AgentTabSession, proc: ChildProcess, startTime: number) {
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
      await setAgentTabData(session.projectId, session.tabId, {
        prettyLog: session.blocks,
        sessionId: session.sessionId,
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

    await setAgentTabData(session.projectId, session.tabId, {
      prettyLog: session.blocks,
      sessionId: session.sessionId,
    });
  });

  proc.on("error", async (err) => {
    session.status = "error";
    appendBlock(session, {
      type: "status",
      subtype: "error",
      error: err.message,
      durationMs: Date.now() - startTime,
    });
    await setAgentTabData(session.projectId, session.tabId, {
      prettyLog: session.blocks,
      sessionId: session.sessionId,
    });
  });
}

// ── Public API ──

export async function startAgentTabSession(
  tabId: string,
  projectId: string,
  text: string,
  cwd: string,
): Promise<void> {
  const existing = sessions.get(tabId);
  if (existing?.status === "running") {
    throw new Error("Agent session is already running");
  }

  const session: AgentTabSession = {
    tabId,
    projectId,
    queryHandle: null,
    blocks: [],
    clients: new Set(),
    status: "running",
  };
  sessions.set(tabId, session);

  const settings = await getSettings();
  const project = await getProject(projectId);
  const projectName = project?.name || "project";

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
  systemParts.push(`You are a coding assistant working on the "${projectName}" project in ${cwd}.`);
  args.push("--append-system-prompt", systemParts.join("\n\n"));

  const proc = spawn(CLAUDE, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined },
  });

  session.queryHandle = proc;
  wireProcess(session, proc, startTime);
}

export async function continueAgentTabSession(
  tabId: string,
  projectId: string,
  text: string,
  cwd: string,
  preAttachClient?: WebSocket,
  attachments?: TaskAttachment[],
): Promise<void> {
  let session = sessions.get(tabId);

  // Reconstruct from DB if no in-memory session
  if (!session) {
    const stored = await getAgentTabData(projectId, tabId);
    if (!stored?.sessionId) {
      throw new Error("No session to continue — no sessionId stored");
    }
    session = {
      tabId,
      projectId,
      sessionId: stored.sessionId,
      queryHandle: null,
      blocks: stored.prettyLog || [],
      clients: new Set(),
      status: "done",
    };
    sessions.set(tabId, session);
  }

  if (preAttachClient && !session.clients.has(preAttachClient)) {
    session.clients.add(preAttachClient);
  }

  if (session.status === "running") {
    throw new Error("Session is already running");
  }

  // Handle image attachments
  let promptText = text;
  if (attachments?.length) {
    const imageFiles: string[] = [];
    const attachDir = join(tmpdir(), "proq-prompts", `agent-${tabId}-${Date.now()}`);
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

  appendBlock(session, { type: "user", text, attachments: attachments?.length ? attachments : undefined });

  const settings = await getSettings();
  session.status = "running";

  const startTime = Date.now();
  const project = await getProject(projectId);
  const projectName = project?.name || "project";

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

  const systemParts: string[] = [];
  if (settings.systemPromptAdditions) systemParts.push(settings.systemPromptAdditions);
  systemParts.push(`You are a coding assistant working on the "${projectName}" project in ${cwd}.`);
  args.push("--append-system-prompt", systemParts.join("\n\n"));

  const proc = spawn(CLAUDE, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined },
  });

  session.queryHandle = proc;
  wireProcess(session, proc, startTime);
}

export function stopAgentTabSession(tabId: string): void {
  const session = sessions.get(tabId);
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

export function getAgentTabSession(tabId: string): AgentTabSession | null {
  return sessions.get(tabId) ?? null;
}

export function attachAgentTabClient(tabId: string, ws: WebSocket): void {
  const session = sessions.get(tabId);
  if (session) {
    session.clients.add(ws);
  }
}

export function detachAgentTabClient(tabId: string, ws: WebSocket): void {
  const session = sessions.get(tabId);
  if (session) {
    session.clients.delete(ws);
  }
}

export function clearAgentTabSession(tabId: string): void {
  const session = sessions.get(tabId);
  if (session) {
    if (session.status === "running" && session.queryHandle) {
      session.status = "aborted";
      session.queryHandle.kill("SIGTERM");
    }
    session.clients.clear();
    sessions.delete(tabId);
  }
}
