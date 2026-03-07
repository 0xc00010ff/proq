import { spawn, type ChildProcess } from "child_process";
import { join } from "path";
import { readFile } from "fs/promises";
import type { AgentBlock, TaskAttachment, TaskMode } from "./types";
import { updateTask, getTask, getProject, getSettings } from "./db";
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
  status: "running" | "done" | "error" | "aborted";
}

// ── Singleton attached to globalThis to survive HMR ──
const g = globalThis as unknown as {
  __proqAgentRuntimeSessions?: Map<string, AgentRuntimeSession>;
};
if (!g.__proqAgentRuntimeSessions) g.__proqAgentRuntimeSessions = new Map();

const sessions = g.__proqAgentRuntimeSessions;

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
  broadcast(session, { type: "block", block });
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

    if (session.status === "aborted") {
      await updateTask(projectId, taskId, {
        agentBlocks: session.blocks,
      });
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
    let questionFields: { humanSteps?: string; findings?: string } = {};
    if (endedOnQuestion) {
      const input = lastToolUse.input as Record<string, unknown>;
      const questions = Array.isArray(input.questions)
        ? (input.questions as { question: string }[])
        : [];
      const questionText = questions.map((q) => q.question).join("\n");
      if (questionText) {
        questionFields = {
          humanSteps: questionText,
          findings: "Agent has a question — respond in chat window ←.",
        };
      }
    } else if (endedOnPlanExit) {
      questionFields = {
        humanSteps:
          "Agent has a plan ready for approval — review plan in chat window ←.",
        findings: "Agent created a plan and is waiting for approval.",
      };
    }

    // Check if task is still in-progress (agent didn't call update_task)
    const task = await getTask(projectId, taskId);
    const stillInProgress = task?.status === "in-progress";

    // Safety net: auto-commit any leftover uncommitted changes
    if (task && !endedOnQuestion && !endedOnPlanExit) {
      const effectivePath = task.worktreePath || await (async () => {
        const proj = await getProject(projectId);
        return proj?.path.replace(/^~/, process.env.HOME || "~");
      })();
      if (effectivePath) {
        autoCommitIfDirty(effectivePath, task.title);
      }
    }

    if (stillInProgress) {
      // Safety net: move to verify and clear agentStatus
      await updateTask(projectId, taskId, {
        status: "verify",
        agentStatus: null,
        findings:
          session.status === "error"
            ? `Error: ${stderrOutput.trim() || `CLI exited with code ${code}`}`
            : undefined,
        ...questionFields,
        agentBlocks: session.blocks,
        sessionId: session.sessionId,
      });
      notify(
        `✅ *${(task?.title || task?.description || "task").slice(0, 40).replace(/"/g, '\\"')}* → verify`,
      );
      emitTaskUpdate(projectId, taskId, {
        status: "verify",
        agentStatus: null,
      });
    } else {
      // Agent already handled status via update_task — just persist agentBlocks
      await updateTask(projectId, taskId, {
        agentBlocks: session.blocks,
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
        agentStatus: null,
        findings: `Error: ${errorMsg}`,
        agentBlocks: session.blocks,
      });
      emitTaskUpdate(projectId, taskId, {
        status: "verify",
        agentStatus: null,
      });
    } else {
      await updateTask(projectId, taskId, {
        agentBlocks: session.blocks,
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
    "-p",
    prompt,
    "--output-format",
    "stream-json",
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

  // Combine user's system prompt additions with proq system prompt
  const systemParts: string[] = [];
  if (settings.systemPromptAdditions)
    systemParts.push(settings.systemPromptAdditions);
  if (options?.proqSystemPrompt) systemParts.push(options.proqSystemPrompt);
  if (systemParts.length > 0) {
    args.push("--append-system-prompt", systemParts.join("\n\n"));
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
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined },
  });

  session.queryHandle = proc;

  wireProcess(session, proc, { startTime, projectId, taskId });
}

function processStreamEvent(
  session: AgentRuntimeSession,
  event: Record<string, unknown>,
) {
  const type = event.type as string;

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
          appendBlock(session, {
            type: "tool_use",
            toolId: b.id as string,
            name: b.name as string,
            input: b.input as Record<string, unknown>,
          });

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
            // Read the plan file and enrich the block before killing
            const enrichAndKill = planPath
              ? readFile(planPath, "utf-8").then((content) => {
                  const exitBlock = session.blocks[session.blocks.length - 1];
                  if (exitBlock.type === "tool_use" && exitBlock.name === "ExitPlanMode") {
                    exitBlock.input._planContent = content;
                    exitBlock.input._planFilePath = planPath;
                    broadcast(session, { type: "block", block: exitBlock });
                  }
                }).catch(() => { /* plan file may not exist */ })
              : Promise.resolve();
            enrichAndKill.finally(() => {
              if (session.queryHandle) {
                session.queryHandle.kill("SIGTERM");
              }
            });
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

    appendBlock(session, {
      type: "status",
      subtype: isError ? "error" : "complete",
      sessionId: event.session_id as string | undefined,
      costUsd,
      durationMs: event.duration_ms as number | undefined,
      turns: event.num_turns as number | undefined,
      error: isError ? resultText || "Agent error" : undefined,
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
  options?: { planApproved?: boolean },
): Promise<void> {
  let session = sessions.get(taskId);
  let taskMode: string | undefined;
  let canResume = true;

  // If no in-memory session, reconstruct from DB.
  // The session was cleared (e.g. task moved to done), so the Claude CLI
  // session is likely dead.  We'll start fresh with context instead of
  // trying --resume on a stale session ID.
  if (!session) {
    const task = await getTask(projectId, taskId);
    taskMode = task?.mode;
    canResume = false;
    session = {
      taskId,
      projectId,
      sessionId: task?.sessionId,
      queryHandle: null,
      blocks: task?.agentBlocks || [],
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
  appendBlock(session, {
    type: "user",
    text,
    attachments: attachments?.length ? attachments : undefined,
  });

  const settings = await getSettings();
  session.status = "running";

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

  // Build CLI args — use --resume only if we have a live in-memory session.
  // Reconstructed sessions (from DB after clearSession) likely have a dead
  // Claude CLI session, so we start fresh with task context instead.
  const args: string[] = [];

  if (canResume && session.sessionId) {
    args.push("--resume", session.sessionId);
  }

  args.push(
    "-p",
    promptText,
    "--output-format",
    "stream-json",
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

  // Combine user's system prompt additions with proq system prompt
  const systemParts: string[] = [];
  if (settings.systemPromptAdditions)
    systemParts.push(settings.systemPromptAdditions);
  const project = await getProject(projectId);
  const proqSysPrompt = buildProqSystemPrompt(
    projectId,
    taskId,
    taskMode as TaskMode | undefined,
    project?.name,
  );
  systemParts.push(proqSysPrompt);

  // When starting fresh (no --resume), inject previous work context so the
  // agent knows what was done before.
  if (!canResume || !session.sessionId) {
    const task = await getTask(projectId, taskId);
    const contextParts: string[] = [];
    if (task?.title) contextParts.push(`Task: ${task.title}`);
    if (task?.description)
      contextParts.push(`Description: ${task.description}`);
    if (task?.findings)
      contextParts.push(`Previous findings:\n${task.findings}`);
    if (task?.humanSteps)
      contextParts.push(`Previous action items:\n${task.humanSteps}`);
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

  // Emit init block for the new session turn
  if (!canResume || !session.sessionId) {
    appendBlock(session, {
      type: "status",
      subtype: "init",
      model: settings.defaultModel || undefined,
    });
  }

  const claudeBin = await getClaudeBin();
  const proc = spawn(claudeBin, args, {
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

export function getSession(taskId: string): AgentRuntimeSession | null {
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
