import type WebSocket from "ws";
import { getSession, attachClient, detachClient, stopSession, continueSession } from "./agent-provider";
import { getTask, getProject, updateTask } from "./db";
import { emitTaskUpdate } from "./task-events";
import type { AgentWsClientMsg } from "./types";

export async function attachAgentWsWithProject(
  taskId: string,
  projectId: string,
  ws: WebSocket,
): Promise<void> {
  const session = getSession(taskId);

  if (session) {
    const replay = JSON.stringify({ type: "replay", blocks: session.blocks });
    ws.send(replay);
    attachClient(taskId, ws);
  } else {
    // Load from DB
    const task = await getTask(projectId, taskId);
    if (task?.agentBlocks && task.agentBlocks.length > 0) {
      ws.send(JSON.stringify({ type: "replay", blocks: task.agentBlocks }));
    } else {
      ws.send(JSON.stringify({ type: "error", error: "No session found" }));
    }
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
          const projectPath = project?.path.replace(/^~/, process.env.HOME || "~") || ".";
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
