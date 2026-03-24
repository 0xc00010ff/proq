import { spawn, type ChildProcess } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync, writeFileSync } from "fs";
import { readFile } from "fs/promises";
import type { AgentBlock, TaskAttachment, TaskMode } from "./types";
import { getWorkbenchSession, setWorkbenchSession, getSettings, getProject } from "./db";
import { getClaudeBin } from "./claude-bin";
import type WebSocket from "ws";

export interface AgentTabSession {
  tabId: string;
  projectId: string;
  sessionId?: string;
  mode?: TaskMode;
  queryHandle: ChildProcess | null;
  blocks: AgentBlock[];
  clients: Set<WebSocket>;
  status: "running" | "done" | "error" | "aborted" | "interrupted";
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
          const toolBlock: AgentBlock & { type: "tool_use" } = {
            type: "tool_use",
            toolId: b.id as string,
            name: b.name as string,
            input: b.input as Record<string, unknown>,
          };

          if (b.name === "ExitPlanMode") {
            // Find the plan file by scanning backwards through blocks
            let planPath: string | undefined;
            for (let j = session.blocks.length - 1; j >= 0; j--) {
              const prev = session.blocks[j];
              if (prev.type === "tool_use" && (prev.name === "Write" || prev.name === "Edit")) {
                const fp = prev.input.file_path as string;
                if (fp && fp.endsWith(".md")) {
                  planPath = fp;
                  break;
                }
              }
            }
            // Read plan file, enrich block, then append+broadcast and kill
            const enrichAndKill = planPath
              ? readFile(planPath, "utf-8").then((content) => {
                  toolBlock.input._planContent = content;
                  toolBlock.input._planFilePath = planPath;
                }).catch(() => { /* plan file may not exist */ })
              : Promise.resolve();
            enrichAndKill.then(() => {
              appendBlock(session, toolBlock);
            }).finally(() => {
              if (session.queryHandle) {
                session.queryHandle.kill("SIGTERM");
              }
            });
          } else {
            appendBlock(session, toolBlock);
          }
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

    if (session.status === "aborted" || session.status === "interrupted") {
      // Only persist if session is still tracked (skip if it was cleared)
      if (sessions.get(session.tabId) === session) {
        await setWorkbenchSession(session.projectId, session.tabId, {
          agentBlocks: session.blocks,
          sessionId: session.sessionId,
          mode: session.mode,
        });
      }
      return;
    }

    // When killed with SIGTERM (e.g. ExitPlanMode, AskUserQuestion), code is null — not an error
    const intentionalKill =
      (code === null && signal === "SIGTERM") || code === 143;

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
      mode: session.mode,
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
      mode: session.mode,
    });
  });
}

// ── MCP config for workbench agents ──

function writeWorkbenchMcpConfig(projectId: string, tabId: string): string {
  const promptDir = join(tmpdir(), "proq-prompts");
  mkdirSync(promptDir, { recursive: true });
  const mcpScriptPath = join(process.cwd(), "src/lib/proq-mcp-project.js");
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

function buildSystemPrompt(projectName: string, cwd: string, mode?: TaskMode, settings?: { systemPromptAdditions?: string }, project?: { systemPrompt?: string } | null): string {
  const systemParts: string[] = [];
  if (settings?.systemPromptAdditions) systemParts.push(settings.systemPromptAdditions);
  if (project?.systemPrompt) systemParts.push(project.systemPrompt);

  let modeGuidance = "";
  if (mode === "plan") {
    modeGuidance = `\n\n**Starting mode: plan** — Create a detailed plan for the human to review. Do not make code changes until the human approves your plan. Once approved, your mode switches to auto and you should execute the plan, committing changes as you go.`;
  } else if (mode === "answer") {
    modeGuidance = `\n\n**Starting mode: answer** — Start by researching and analyzing — do not make code changes unless the human explicitly asks you to.`;
  } else if (mode === "build") {
    modeGuidance = `\n\n**Starting mode: build** — Focus on writing code. Skip unnecessary planning and get straight to implementation.`;
  }

  systemParts.push(`You are a coding assistant inside proq, a kanban-style task board for AI-assisted development. You are working on the "${projectName}" project in ${cwd}.${modeGuidance}

You have MCP tools from the **proq** server for managing tasks on the board:
- \`list_tasks\` — List all tasks in this project by status
- \`create_task\` — Create a new task in the Todo column
- \`get_task\` — Read a specific task's details
- \`update_task\` — Update a task (title, description, status, priority)
- \`delete_task\` — Delete a task
- \`list_projects\` — List all projects in proq
- \`set_live_url\` — Set the live preview URL (e.g. after starting a dev server)

Use these tools to manage tasks. If you identify follow-up work beyond your current scope, create tasks for it.

### Asking Questions
When you use \`AskUserQuestion\`, the tool result will show an auto-resolved error — this is expected, ignore it. Your question is displayed to the human and their real answer will arrive as a follow-up message.

### Plan Mode
When you use \`ExitPlanMode\`, the tool result will show an auto-resolved error — this is expected, ignore it. Your plan is displayed to the human and their approval or feedback will arrive as a follow-up message.`);

  return systemParts.join("\n\n");
}

export async function startAgentTabSession(
  tabId: string,
  projectId: string,
  text: string,
  cwd: string,
  attachments?: TaskAttachment[],
  mode?: TaskMode,
): Promise<void> {
  const existing = sessions.get(tabId);
  if (existing?.status === "running") {
    throw new Error("Agent session is already running");
  }

  const session: AgentTabSession = {
    tabId,
    projectId,
    mode,
    queryHandle: null,
    blocks: [],
    clients: new Set(),
    status: "running",
  };
  sessions.set(tabId, session);

  const settings = await getSettings();
  const project = await getProject(projectId);
  const projectName = project?.name || "project";

  appendBlock(session, { type: "status", subtype: "init", model: settings.defaultModel || undefined, timestamp: new Date().toISOString() });
  appendBlock(session, { type: "user", text, attachments: attachments?.length ? attachments : undefined });

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

  const startTime = Date.now();

  const mcpConfigPath = writeWorkbenchMcpConfig(projectId, tabId);

  const args: string[] = [
    "-p", promptText,
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--max-turns", "200",
    "--mcp-config", mcpConfigPath,
    "--allowedTools", "mcp__proq__*",
  ];

  // Plan mode uses restricted permissions; all other modes skip permissions
  if (mode === "plan") {
    args.push("--permission-mode", "plan");
  } else {
    args.push("--dangerously-skip-permissions");
  }

  if (settings.defaultModel) {
    args.push("--model", settings.defaultModel);
  }

  args.push("--append-system-prompt", buildSystemPrompt(projectName, cwd, mode, settings, project));

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
  options?: { planApproved?: boolean; mode?: TaskMode },
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
      mode: stored.mode,
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

  // Plan approval: switch mode from plan to auto
  if (options?.planApproved && session.mode === "plan") {
    session.mode = "auto";
  }

  // Mid-session mode switch (e.g. user selects plan mode after starting in auto)
  if (options?.mode && options.mode !== session.mode && !options.planApproved) {
    session.mode = options.mode;
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
    "--max-turns", "200",
    "--mcp-config", mcpConfigPath,
    "--allowedTools", "mcp__proq__*",
  ];

  // After plan approval or non-plan modes: skip permissions. In plan mode: restricted.
  if (session.mode === "plan" && !options?.planApproved) {
    args.push("--permission-mode", "plan");
  } else {
    args.push("--dangerously-skip-permissions");
  }

  if (settings.defaultModel) {
    args.push("--model", settings.defaultModel);
  }

  args.push("--append-system-prompt", buildSystemPrompt(projectName, cwd, session.mode, settings, project));

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

export function interruptAgentTabSession(tabId: string): Promise<void> {
  return new Promise((resolve) => {
    const session = sessions.get(tabId);
    if (!session || session.status !== "running" || !session.queryHandle) {
      resolve();
      return;
    }
    session.status = "interrupted";
    appendBlock(session, {
      type: "status",
      subtype: "interrupted" as "abort",
      error: "Session interrupted",
    });
    const proc = session.queryHandle;
    proc.once("close", () => resolve());
    proc.kill("SIGTERM");
  });
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
