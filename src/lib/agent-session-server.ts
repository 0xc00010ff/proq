import type WebSocket from "ws";
import { getSession, attachClient, detachClient, stopSession, continueSession } from "./agent-session";
import { getTask, getProject, updateTask, getTaskAgentBlocks } from "./db";
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
    ws.send(JSON.stringify({ type: "replay", blocks: session.blocks, live: true }));
    attachClient(taskId, ws);
  } else {
    // No live session — load stored blocks from disk.
    // Always send a replay (even if empty) so the client doesn't retry.
    // Mark as not live so the client knows the session is historical.
    const blocks = await getTaskAgentBlocks(taskId);
    ws.send(JSON.stringify({ type: "replay", blocks, live: false }));
  }

  ws.on("message", async (raw) => {
    try {
      const msg: AgentWsClientMsg = JSON.parse(raw.toString());
      if (msg.type === "stop") {
        stopSession(taskId);
      } else if (msg.type === "followup" || msg.type === "plan-approve") {
        try {
          const task = await getTask(projectId, taskId);
          const project = await getProject(projectId);
          const projectPath = project ? resolveProjectPath(project.path) : ".";
          const cwd = task?.worktreePath || projectPath;
          const planApproved = msg.type === "plan-approve";

          // Move task back to in-progress so the card shows "Agent working"
          if (task && task.status !== "in-progress") {
            await updateTask(projectId, taskId, { status: "in-progress", agentStatus: "running" });
            emitTaskUpdate(projectId, taskId, { status: "in-progress", agentStatus: "running" });
          } else if (task && task.agentStatus !== "running") {
            await updateTask(projectId, taskId, { agentStatus: "running" });
            emitTaskUpdate(projectId, taskId, { agentStatus: "running" });
          }

          await continueSession(projectId, taskId, msg.text, cwd, ws, msg.type === "followup" ? msg.attachments : undefined, { planApproved });
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
