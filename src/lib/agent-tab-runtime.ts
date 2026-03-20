import { spawn, type ChildProcess } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync, writeFileSync } from "fs";
import type { AgentBlock, TaskAttachment } from "./types";
import { getWorkbenchSession, setWorkbenchSession, getSettings, getProject } from "./db";
import { getClaudeBin } from "./claude-bin";
import type WebSocket from "ws";

export interface AgentTabSession {
  tabId: string;
  projectId: string;
  sessionId?: string;
  queryHandle: ChildProcess | null;
  blocks: AgentBlock[];
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

function appendBlock(session: AgentTabSession, block: AgentBlock) {
  session.blocks.push(block);
  broadcast(session, { type: "block", block });
}

// ── Stream event processing (same as supervisor-runtime) ──

function processStreamEvent(session: AgentTabSession, event: Record<string, unknown>) {
  const type = event.type as string;

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
      // Only persist if session is still tracked (skip if it was cleared)
      if (sessions.get(session.tabId) === session) {
        await setWorkbenchSession(session.projectId, session.tabId, {
          agentBlocks: session.blocks,
          sessionId: session.sessionId,
        });
      }
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

    await setWorkbenchSession(session.projectId, session.tabId, {
      agentBlocks: session.blocks,
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
    await setWorkbenchSession(session.projectId, session.tabId, {
      agentBlocks: session.blocks,
      sessionId: session.sessionId,
    });
  });
}

// ── MCP config for workbench agents ──

function writeWorkbenchMcpConfig(projectId: string, tabId: string): string {
  const promptDir = join(tmpdir(), "proq-prompts");
  mkdirSync(promptDir, { recursive: true });
  const mcpScriptPath = join(process.cwd(), "src/lib/proq-mcp-general.js");
  const configPath = join(promptDir, `mcp-workbench-${tabId.slice(0, 12)}.json`);
  const config = {
    mcpServers: {
      proq: {
        command: "node",
        args: [mcpScriptPath, "--project", projectId],
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config), "utf-8");
  return configPath;
}

// ── Public API ──

export async function startAgentTabSession(
  tabId: string,
  projectId: string,
  text: string,
  cwd: string,
  context?: string,
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

  const mcpConfigPath = writeWorkbenchMcpConfig(projectId, tabId);

  const args: string[] = [
    "-p", text,
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns", "200",
    "--mcp-config", mcpConfigPath,
    "--allowedTools", "mcp__proq__*",
  ];

  if (settings.defaultModel) {
    args.push("--model", settings.defaultModel);
  }

  const systemParts: string[] = [];
  if (settings.systemPromptAdditions) systemParts.push(settings.systemPromptAdditions);
  if (project?.systemPrompt) systemParts.push(project.systemPrompt);
  systemParts.push(`You are a coding assistant inside proq, a kanban-style task board for AI-assisted development. You are working on the "${projectName}" project in ${cwd}.

You have MCP tools from the **proq** server for managing tasks on the board:
- \`list_tasks\` — List all tasks in this project by status
- \`create_task\` — Create a new task in the Todo column
- \`get_task\` — Read a specific task's details
- \`update_task\` — Update a task (title, description, status, priority)
- \`delete_task\` — Delete a task
- \`list_projects\` — List all projects in proq

Use these tools to manage tasks. If you identify follow-up work beyond your current scope, create tasks for it.`);
  if (context === "live") {
    systemParts.push(buildLiveContextPrompt(projectId));
  }
  args.push("--append-system-prompt", systemParts.join("\n\n"));

  const claudeBin = await getClaudeBin();
  const proc = spawn(claudeBin, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined, PROQ_API: `http://localhost:${process.env.PORT || 1337}` },
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
    const stored = await getWorkbenchSession(projectId, tabId);
    if (!stored?.sessionId) {
      throw new Error("No session to continue — no sessionId stored");
    }
    session = {
      tabId,
      projectId,
      sessionId: stored.sessionId,
      queryHandle: null,
      blocks: stored.agentBlocks || [],
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

  // Append file attachment paths to prompt
  let promptText = text;
  if (attachments?.length) {
    const imageFiles = attachments.filter((a) => a.filePath && a.type.startsWith("image/")).map((a) => a.filePath!);
    const otherFiles = attachments.filter((a) => a.filePath && !a.type.startsWith("image/")).map((a) => a.filePath!);
    if (imageFiles.length > 0) {
      promptText += `\n\n## Attached Images\nThe following image files are attached to this message. Use your Read tool to view them:\n${imageFiles.map((f) => `- ${f}`).join("\n")}\n`;
    }
    if (otherFiles.length > 0) {
      promptText += `\n\n## Attached Files\nThe following files are attached to this message. Use your Read tool to view them:\n${otherFiles.map((f) => `- ${f}`).join("\n")}\n`;
    }
  }

  appendBlock(session, { type: "user", text, attachments: attachments?.length ? attachments : undefined });

  const settings = await getSettings();
  session.status = "running";

  const startTime = Date.now();
  const project = await getProject(projectId);
  const projectName = project?.name || "project";
  const mcpConfigPath = writeWorkbenchMcpConfig(projectId, tabId);

  const args: string[] = [
    "--resume", session.sessionId!,
    "-p", promptText,
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns", "200",
    "--mcp-config", mcpConfigPath,
    "--allowedTools", "mcp__proq__*",
  ];

  if (settings.defaultModel) {
    args.push("--model", settings.defaultModel);
  }

  const systemParts: string[] = [];
  if (settings.systemPromptAdditions) systemParts.push(settings.systemPromptAdditions);
  if (project?.systemPrompt) systemParts.push(project.systemPrompt);
  systemParts.push(`You are a coding assistant inside proq, a kanban-style task board for AI-assisted development. You are working on the "${projectName}" project in ${cwd}.

You have MCP tools from the **proq** server for managing tasks on the board:
- \`list_tasks\` — List all tasks in this project by status
- \`create_task\` — Create a new task in the Todo column
- \`get_task\` — Read a specific task's details
- \`update_task\` — Update a task (title, description, status, priority)
- \`delete_task\` — Delete a task
- \`list_projects\` — List all projects in proq

Use these tools to manage tasks. If you identify follow-up work beyond your current scope, create tasks for it.`);
  args.push("--append-system-prompt", systemParts.join("\n\n"));

  const claudeBin = await getClaudeBin();
  const proc = spawn(claudeBin, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined, PROQ_API: `http://localhost:${process.env.PORT || 1337}` },
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

function buildLiveContextPrompt(projectId: string): string {
  return `## Live Preview Context

You are working in the **Live Preview** tab of proq. Your primary job here is to help start, manage, and debug the project's development server.

### When starting the dev environment:
1. Look at the project's package.json (or equivalent) to determine the start command (e.g. \`npm run dev\`, \`yarn dev\`, \`bun dev\`, etc.)
2. Run the appropriate command to start the development server
3. Watch the output for the local server URL (e.g. \`http://localhost:3000\`, \`http://localhost:5173\`, etc.)
4. Once you see the server is running, **immediately** set the live preview URL by making this API call:

\`\`\`bash
curl -s -X PATCH http://localhost:${process.env.PORT || 1337}/api/projects/${projectId} \\
  -H 'Content-Type: application/json' \\
  -d '{"serverUrl":"<the-url-you-found>"}'
\`\`\`

This will update the Live preview iframe to show the running application.

### Important:
- Always check if a server is already running on common ports before starting a new one
- If the server fails to start, diagnose the issue (missing dependencies, port conflicts, etc.)
- After setting the URL, the Live preview will automatically refresh to show the app
- If asked to install dependencies, run the appropriate install command first`;
}

export async function clearAgentTabSession(tabId: string, projectId?: string): Promise<void> {
  const session = sessions.get(tabId);
  if (session) {
    if (session.status === "running" && session.queryHandle) {
      session.status = "aborted";
      session.queryHandle.kill("SIGTERM");
    }
    // Clear persisted data
    await setWorkbenchSession(session.projectId, tabId, {
      agentBlocks: [],
      sessionId: undefined,
    });
    session.clients.clear();
    sessions.delete(tabId);
  } else if (projectId) {
    // No in-memory session but clear persisted data
    await setWorkbenchSession(projectId, tabId, {
      agentBlocks: [],
      sessionId: undefined,
    });
  }
}
