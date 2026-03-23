import { spawn, type ChildProcess } from "child_process";
import { join } from "path";
import { readFile } from "fs/promises";
import type { AgentBlock, TaskAttachment, TaskMode } from "./types";
import { resolveProjectPath } from "./utils";
import { updateTask, getTask, getProject, getSettings, setTaskAgentBlocks, readAgentBlocksFile } from "./db";
import {
  notify,
  buildProqSystemPrompt,
  writeMcpConfig,
} from "./agent-dispatch";
import { emitTaskUpdate } from "./task-events";
import { autoCommitIfDirty } from "./worktree";
import { getClaudeBin } from "./claude-bin";
import type WebSocket from "ws";

export interface AgentRuntimeSession {
  taskId: string;
  projectId: string;
  sessionId?: string;
  mcpConfig?: string;
  queryHandle: ChildProcess | null;
  blocks: AgentBlock[];
  clients: Set<WebSocket>;
  status: "running" | "done" | "error" | "aborted" | "interrupted";
}

// ── Singleton attached to globalThis to survive HMR ──
const g = globalThis as unknown as {
  __proqAgentRuntimeSessions?: Map<string, AgentRuntimeSession>;
  __proqAgentPendingClients?: Map<string, Set<WebSocket>>;
};
if (!g.__proqAgentRuntimeSessions) g.__proqAgentRuntimeSessions = new Map();
if (!g.__proqAgentPendingClients) g.__proqAgentPendingClients = new Map();

const sessions = g.__proqAgentRuntimeSessions;
const pendingClients = g.__proqAgentPendingClients;

function broadcast(session: AgentRuntimeSession, msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of session.clients) {
    try {
      if (ws.readyState === 1) ws.send(data);
    } catch {
      // client gone
    }
  }
}

function appendBlock(session: AgentRuntimeSession, block: AgentBlock) {
  session.blocks.push(block);
  broadcast(session, { type: "block", block, active: session.status === "running" });
}

// ── Shared process wiring ──
// Handles stdout parsing, stderr capture, close/error handlers.
function wireProcess(
  session: AgentRuntimeSession,
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

  proc.on("close", async (code, signal) => {
    // Process any remaining buffered data
    if (stdoutBuffer.trim()) {
      try {
        const event = JSON.parse(stdoutBuffer.trim());
        processStreamEvent(session, event);
      } catch {
        // ignore
      }
    }

    if (session.status === "aborted" || session.status === "interrupted") {
      await setTaskAgentBlocks(taskId, session.blocks);
      return;
    }

    // Check if this was an intentional SIGTERM kill (e.g. ExitPlanMode or AskUserQuestion)
    // When killed with SIGTERM, code is null and signal is "SIGTERM".
    // But if the process handles SIGTERM itself and exits, code is 143 (128+15)
    // with signal null — treat both cases the same.
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

    // Check if the last tool_use was AskUserQuestion or ExitPlanMode — surface to human
    const lastToolUse = [...session.blocks]
      .reverse()
      .find((b) => b.type === "tool_use");
    const endedOnQuestion =
      lastToolUse?.type === "tool_use" &&
      lastToolUse.name === "AskUserQuestion";
    const endedOnPlanExit =
      lastToolUse?.type === "tool_use" && lastToolUse.name === "ExitPlanMode";
    let questionFields: { nextSteps?: string; summary?: string } = {};
    if (endedOnQuestion) {
      const input = lastToolUse.input as Record<string, unknown>;
      const questions = Array.isArray(input.questions)
        ? (input.questions as { question: string }[])
        : [];
      const questionText = questions.map((q) => q.question).join("\n");
      if (questionText) {
        questionFields = {
          nextSteps: questionText,
          summary: "Agent has a question — respond in chat window ←.",
        };
      }
    } else if (endedOnPlanExit) {
      questionFields = {
        nextSteps:
          "Agent has a plan ready for approval — review plan in chat window ←.",
        summary: "Agent created a plan and is waiting for approval.",
      };
    }

    // Check if task is still in-progress (agent didn't call update_task)
    const task = await getTask(projectId, taskId);
    const stillInProgress = task?.status === "in-progress";

    // Safety net: auto-commit any leftover uncommitted changes
    if (task && !endedOnQuestion && !endedOnPlanExit) {
      const effectivePath = task.worktreePath || await (async () => {
        const proj = await getProject(projectId);
        return proj ? resolveProjectPath(proj.path) : undefined;
      })();
      if (effectivePath) {
        autoCommitIfDirty(effectivePath, task.title);
      }
    }

    // Persist agent blocks to separate file
    await setTaskAgentBlocks(taskId, session.blocks, session.sessionId);

    if (stillInProgress) {
      // Safety net: move to verify and clear agentStatus
      const closeUpdate: Record<string, unknown> = {
        status: "verify",
        agentStatus: null,
        ...questionFields,
        sessionId: session.sessionId,
      };
      if (session.status === "error") {
        closeUpdate.summary = `Error: ${stderrOutput.trim() || `CLI exited with code ${code}`}`;
      }
      await updateTask(projectId, taskId, closeUpdate as Parameters<typeof updateTask>[2]);
      notify(
        `✅ *${(task?.title || task?.description || "task").slice(0, 40).replace(/"/g, '\\"')}* → verify`,
      );
      emitTaskUpdate(projectId, taskId, {
        status: "verify",
        agentStatus: null,
      });
    } else {
      // Agent already handled status via update_task — just persist sessionId
      await updateTask(projectId, taskId, {
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
    await setTaskAgentBlocks(taskId, session.blocks, session.sessionId);
    const task = await getTask(projectId, taskId);
    if (task?.status === "in-progress") {
      await updateTask(projectId, taskId, {
        status: "verify",
        agentStatus: null,
        summary: `Error: ${errorMsg}`,
      });
      emitTaskUpdate(projectId, taskId, {
        status: "verify",
        agentStatus: null,
      });
    }
  });
}

export async function startSession(
  projectId: string,
  taskId: string,
  prompt: string,
  cwd: string,
  options?: {
    model?: string;
    proqSystemPrompt?: string;
    mcpConfig?: string;
    permissionMode?: string;
  },
): Promise<void> {
  const session: AgentRuntimeSession = {
    taskId,
    projectId,
    queryHandle: null,
    blocks: [],
    clients: new Set(),
    status: "running",
  };
  sessions.set(taskId, session);

  // Promote any clients that connected before the session was created
  const waiting = pendingClients.get(taskId);
  if (waiting) {
    for (const ws of waiting) {
      if (ws.readyState === 1) session.clients.add(ws);
    }
    pendingClients.delete(taskId);
  }

  const settings = await getSettings();

  // Emit init status
  appendBlock(session, {
    type: "status",
    subtype: "init",
    model: settings.defaultModel || undefined,
    timestamp: new Date().toISOString(),
  });

  // Show the original prompt in the chatlog
  appendBlock(session, { type: "user", text: prompt });

  const startTime = Date.now();

  // Build CLI args
  const args: string[] = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--max-turns",
    "200",
  ];

  // Use --dangerously-skip-permissions for non-plan tasks (the flag is more
  // reliable than --permission-mode bypassPermissions, which has race conditions
  // where permission resolution happens before all tools are registered).
  // Plan tasks use --permission-mode plan to restrict edits.
  if (options?.permissionMode === "plan") {
    args.push("--permission-mode", "plan");
  } else {
    args.push("--dangerously-skip-permissions");
  }

  if (settings.defaultModel) {
    args.push("--model", settings.defaultModel);
  }

  // Append system prompt (caller provides combined global + project + proq prompt)
  if (options?.proqSystemPrompt) {
    args.push("--append-system-prompt", options.proqSystemPrompt);
  }

  if (options?.mcpConfig) {
    args.push("--mcp-config", options.mcpConfig);
    session.mcpConfig = options.mcpConfig;
  }

  // Pre-allow tools to avoid race conditions where permission resolution
  // happens before tool registration completes. For plan mode, also allow
  // read-only tools that plan permission mode should permit.
  const allowedTools: string[] = [];
  if (options?.mcpConfig) {
    allowedTools.push("mcp__proq__*");
  }
  if (options?.permissionMode === "plan") {
    allowedTools.push("Read", "Glob", "Grep", "WebFetch", "WebSearch", "Agent");
  }
  if (allowedTools.length > 0) {
    args.push("--allowedTools", allowedTools.join(","));
  }

  // Spawn the CLI child process
  const claudeBin = await getClaudeBin();
  const proc = spawn(claudeBin, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined, PROQ_API: `http://localhost:${process.env.PORT || 1337}` },
  });

  session.queryHandle = proc;

  wireProcess(session, proc, { startTime, projectId, taskId });
}

function processStreamEvent(
  session: AgentRuntimeSession,
  event: Record<string, unknown>,
) {
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
        // Update the most recent init block's model
        const initBlocks = session.blocks.filter(
          (b) => b.type === "status" && b.subtype === "init",
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
          appendBlock(session, {
            type: "thinking",
            thinking: b.thinking as string,
          });
        } else if (b.type === "tool_use") {
          const toolBlock: AgentBlock & { type: "tool_use" } = {
            type: "tool_use",
            toolId: b.id as string,
            name: b.name as string,
            input: b.input as Record<string, unknown>,
          };

          // Plan mode: when the agent calls ExitPlanMode, read the plan file
          // from disk and enrich the block, then kill the process.
          // The close handler will detect endedOnPlanExit and move to verify
          // for human approval. The human can then continue with full permissions.
          if (b.name === "ExitPlanMode") {
            // Find the plan file path by scanning backwards through blocks
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
            // Read the plan file, enrich the block, then append+broadcast once and kill
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
          const output =
            typeof b.content === "string"
              ? b.content
              : Array.isArray(b.content)
                ? (b.content as { type: string; text: string }[])
                    .filter((c) => c.type === "text")
                    .map((c) => c.text)
                    .join("\n")
                : JSON.stringify(b.content);
          // Find the matching tool_use to get its name
          const matchingToolUse = session.blocks.find(
            (bl) => bl.type === "tool_use" && bl.toolId === b.tool_use_id,
          );
          appendBlock(session, {
            type: "tool_result",
            toolId: b.tool_use_id as string,
            name:
              matchingToolUse && matchingToolUse.type === "tool_use"
                ? matchingToolUse.name
                : "",
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

    // Set status BEFORE appendBlock so the broadcast carries active: false
    if (isError) {
      session.status = "error";
    } else {
      session.status = "done";
    }

    appendBlock(session, {
      type: "status",
      subtype: isError ? "error" : "complete",
      sessionId: event.session_id as string | undefined,
      costUsd,
      durationMs: event.duration_ms as number | undefined,
      turns: event.num_turns as number | undefined,
      error: isError ? resultText || "Agent error" : undefined,
    });
  }
}

export async function continueSession(
  projectId: string,
  taskId: string,
  text: string,
  cwd: string,
  preAttachClient?: WebSocket,
  attachments?: TaskAttachment[],
  options?: { planApproved?: boolean },
): Promise<void> {
  let session = sessions.get(taskId);
  let taskMode: string | undefined;

  // If no in-memory session, reconstruct from DB.
  // Claude CLI persists sessions to disk, so --resume works even after
  // proq server restarts — we just need the sessionId.
  if (!session) {
    const task = await getTask(projectId, taskId);
    taskMode = task?.mode;
    const stored = readAgentBlocksFile(taskId);
    session = {
      taskId,
      projectId,
      sessionId: stored.sessionId || task?.sessionId,
      queryHandle: null,
      blocks: stored.blocks,
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

  // Set running BEFORE appending user block so it carries active: true
  // and the client shows the thinking indicator immediately
  session.status = "running";
  appendBlock(session, {
    type: "user",
    text,
    attachments: attachments?.length ? attachments : undefined,
  });

  const settings = await getSettings();

  const startTime = Date.now();

  // Append file attachment paths to prompt
  let promptText = text;
  if (attachments?.length) {
    const imageFiles = attachments
      .filter((a) => a.filePath && a.type.startsWith("image/"))
      .map((a) => a.filePath!);
    const otherFiles = attachments
      .filter((a) => a.filePath && !a.type.startsWith("image/"))
      .map((a) => a.filePath!);
    if (imageFiles.length > 0) {
      promptText += `\n\n## Attached Images\nThe following image files are attached to this message. Use your Read tool to view them:\n${imageFiles.map((f) => `- ${f}`).join("\n")}\n`;
    }
    if (otherFiles.length > 0) {
      promptText += `\n\n## Attached Files\nThe following files are attached to this message. Use your Read tool to view them:\n${otherFiles.map((f) => `- ${f}`).join("\n")}\n`;
    }
  }

  // Build CLI args — use --resume whenever we have a sessionId.
  // Claude CLI persists sessions to disk, so --resume works even for
  // sessions reconstructed from DB after server restarts.
  const args: string[] = [];

  if (session.sessionId) {
    args.push("--resume", session.sessionId);
  }

  args.push(
    "-p",
    promptText,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--max-turns",
    "200",
  );

  // Plan tasks stay in plan mode unless the human explicitly approved.
  // Only switch to full permissions on plan approval.
  const keepPlanMode = taskMode === "plan" && !options?.planApproved;
  if (keepPlanMode) {
    args.push("--permission-mode", "plan");
  } else {
    args.push("--dangerously-skip-permissions");
  }

  if (settings.defaultModel) {
    args.push("--model", settings.defaultModel);
  }

  // Combine system prompts: global additions + project prompt + proq prompt
  const systemParts: string[] = [];
  if (settings.systemPromptAdditions)
    systemParts.push(settings.systemPromptAdditions);
  const project = await getProject(projectId);
  if (project?.systemPrompt) systemParts.push(project.systemPrompt);
  const proqSysPrompt = buildProqSystemPrompt(
    projectId,
    taskId,
    taskMode as TaskMode | undefined,
    project?.name,
  );
  systemParts.push(proqSysPrompt);

  // When starting fresh (no --resume), inject previous work context so the
  // agent knows what was done before.
  if (!session.sessionId) {
    const task = await getTask(projectId, taskId);
    const contextParts: string[] = [];
    if (task?.title) contextParts.push(`Task: ${task.title}`);
    if (task?.description)
      contextParts.push(`Description: ${task.description}`);
    if (task?.summary)
      contextParts.push(`Previous summary:\n${task.summary}`);
    if (task?.nextSteps)
      contextParts.push(`Previous next steps:\n${task.nextSteps}`);
    if (contextParts.length > 0) {
      systemParts.push(
        `## Previous work on this task\nThis task was previously worked on by an agent. Here is the context from that work:\n\n${contextParts.join("\n\n")}`,
      );
    }
  }

  if (systemParts.length > 0) {
    args.push("--append-system-prompt", systemParts.join("\n\n"));
  }

  // Ensure MCP config is available (may need to recreate after server restart)
  if (!session.mcpConfig) {
    session.mcpConfig = writeMcpConfig(projectId, taskId);
  }
  args.push("--mcp-config", session.mcpConfig);

  // Pre-allow tools to avoid race conditions with permission resolution.
  const allowedTools: string[] = [];
  if (session.mcpConfig) {
    allowedTools.push("mcp__proq__*");
  }
  if (keepPlanMode) {
    allowedTools.push("Read", "Glob", "Grep", "WebFetch", "WebSearch", "Agent");
  }
  if (allowedTools.length > 0) {
    args.push("--allowedTools", allowedTools.join(","));
  }

  // Emit init block for the new session turn (only when starting fresh)
  if (!session.sessionId) {
    appendBlock(session, {
      type: "status",
      subtype: "init",
      model: settings.defaultModel || undefined,
      timestamp: new Date().toISOString(),
    });
  }

  const claudeBin = await getClaudeBin();
  const proc = spawn(claudeBin, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined, PROQ_API: `http://localhost:${process.env.PORT || 1337}` },
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

export async function interruptSession(taskId: string): Promise<void> {
  const session = sessions.get(taskId);
  if (!session || session.status !== "running" || !session.queryHandle) {
    return;
  }

  const proc = session.queryHandle;
  session.status = "interrupted";
  appendBlock(session, {
    type: "status",
    subtype: "interrupted",
  });

  // If process already exited, nothing to wait for
  if (proc.exitCode !== null) return;

  // Wait for process to close with a safety timeout
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      resolve();
    }, 5000);
    proc.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    proc.kill("SIGTERM");
  });
}

export function getSession(taskId: string): AgentRuntimeSession | null {
  return sessions.get(taskId) ?? null;
}

export function attachClient(taskId: string, ws: WebSocket): void {
  const session = sessions.get(taskId);
  if (session) {
    session.clients.add(ws);
  }
}

export function addPendingClient(taskId: string, ws: WebSocket): void {
  if (!pendingClients.has(taskId)) pendingClients.set(taskId, new Set());
  pendingClients.get(taskId)!.add(ws);
  ws.on("close", () => {
    pendingClients.get(taskId)?.delete(ws);
  });
}

export function detachClient(taskId: string, ws: WebSocket): void {
  const session = sessions.get(taskId);
  if (session) {
    session.clients.delete(ws);
  }
  pendingClients.get(taskId)?.delete(ws);
}

export function clearSession(taskId: string): void {
  const session = sessions.get(taskId);
  if (session) {
    session.clients.clear();
    sessions.delete(taskId);
  }
  pendingClients.delete(taskId);
}

export function isSessionRunning(taskId: string): boolean {
  const session = sessions.get(taskId);
  return session?.status === "running";
}
