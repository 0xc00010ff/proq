import type WebSocket from "ws";
import { getSession, attachClient, addPendingClient, detachClient, stopSession, interruptSession, continueSession } from "./agent-session";
import { getTask, getProject, updateTask, getTaskLogs } from "./db";
import { resolveProjectPath } from "./utils";
import { emitTaskUpdate } from "./task-events";
import type { AgentWsClientMsg } from "./types";

export async function attachAgentWsWithProject(
  taskId: string,
  projectId: string,
  ws: WebSocket,
): Promise<void> {
  const session = getSession(taskId);

  if (session) {
    const active = session.status === "running";
    ws.send(JSON.stringify({ type: "replay", blocks: session.blocks, active }));
    attachClient(taskId, ws);
  } else {
    // No live session — load stored blocks from disk.
    // Determine active from task DB (agent may be queued/starting).
    const [blocks, task] = await Promise.all([
      getTaskLogs(projectId, taskId),
      getTask(projectId, taskId),
    ]);
    const active = task?.agentStatus === "queued" || task?.agentStatus === "starting" || task?.agentStatus === "running";
    ws.send(JSON.stringify({ type: "replay", blocks, active }));
    // If no blocks and agent is dispatched, register as pending so when
    // the session starts, this client gets attached.
    if (blocks.length === 0 && active) {
      addPendingClient(taskId, ws);
    }
  }

  ws.on("message", async (raw) => {
    try {
      const msg: AgentWsClientMsg = JSON.parse(raw.toString());
      if (msg.type === "stop") {
        stopSession(taskId);
      } else if (msg.type === "interrupt") {
        try {
          console.log(`[agent-ws] interrupt requested for task ${taskId.slice(0, 8)}`);
          await interruptSession(taskId);
          console.log(`[agent-ws] interrupt complete, resuming task ${taskId.slice(0, 8)}`);
          const task = await getTask(projectId, taskId);
          const project = await getProject(projectId);
          const projectPath = project ? resolveProjectPath(project.path) : ".";
          const cwd = task?.worktreePath || projectPath;
          if (task && task.agentStatus !== "running") {
            await updateTask(projectId, taskId, { agentStatus: "running" });
            emitTaskUpdate(projectId, taskId, { agentStatus: "running" });
          }
          await continueSession(projectId, taskId, msg.text, cwd, ws, msg.attachments);
          console.log(`[agent-ws] session resumed for task ${taskId.slice(0, 8)}`);
        } catch (err) {
          console.error(`[agent-ws] interrupt failed for task ${taskId.slice(0, 8)}:`, err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          ws.send(JSON.stringify({ type: "error", error: errorMsg }));
        }
      } else if (msg.type === "followup" || msg.type === "plan-approve") {
        try {
          const task = await getTask(projectId, taskId);
          const project = await getProject(projectId);
          const projectPath = project ? resolveProjectPath(project.path) : ".";
          const cwd = task?.worktreePath || projectPath;
          const planApproved = msg.type === "plan-approve";
          const mode = msg.type === "followup" ? msg.mode : undefined;

          // When a plan is approved, switch mode from plan to auto so
          // subsequent followups use full permissions instead of re-entering plan mode
          if (planApproved && task && task.mode === "plan") {
            await updateTask(projectId, taskId, { mode: "auto" });
            emitTaskUpdate(projectId, taskId, { mode: "auto" });
          }

          // Mid-session mode switch: persist new mode to DB
          if (mode && task && mode !== task.mode && !planApproved) {
            await updateTask(projectId, taskId, { mode });
            emitTaskUpdate(projectId, taskId, { mode });
          }

          // Move task back to in-progress so the card shows "Agent working"
          if (task && task.status !== "in-progress") {
            await updateTask(projectId, taskId, { status: "in-progress", agentStatus: "running" });
            emitTaskUpdate(projectId, taskId, { status: "in-progress", agentStatus: "running" });
          } else if (task && task.agentStatus !== "running") {
            await updateTask(projectId, taskId, { agentStatus: "running" });
            emitTaskUpdate(projectId, taskId, { agentStatus: "running" });
          }

          await continueSession(projectId, taskId, msg.text, cwd, ws, msg.type === "followup" ? msg.attachments : undefined, { planApproved, mode });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          ws.send(JSON.stringify({ type: "error", error: errorMsg }));
        }
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("close", () => {
    detachClient(taskId, ws);
  });
}
