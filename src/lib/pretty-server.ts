import type WebSocket from "ws";
import { getSession, attachClient, detachClient, stopSession, continueSession } from "./pretty-runtime";
import { getTask, getProject } from "./db";
import type { PrettyWsClientMsg } from "./types";

export async function attachPrettyWs(taskId: string, ws: WebSocket): Promise<void> {
  const session = getSession(taskId);

  if (session) {
    // Live session — replay existing blocks then subscribe
    const replay = JSON.stringify({ type: "replay", blocks: session.blocks });
    ws.send(replay);
    attachClient(taskId, ws);
  } else {
    // No live session — try to load persisted prettyLog from DB
    // Parse projectId from the task by searching all projects
    // For simplicity, we scan — the caller should pass projectId via query param
    // We'll handle this in terminal-server.ts by passing projectId
    const sent = await tryReplayFromDb(taskId, ws);
    if (!sent) {
      ws.send(JSON.stringify({ type: "error", error: "No session found" }));
    }
  }

  ws.on("message", (raw) => {
    try {
      const msg: PrettyWsClientMsg = JSON.parse(raw.toString());
      if (msg.type === "stop") {
        stopSession(taskId);
      }
      // Follow-up not implemented in v1 — would need SDK resume support
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("close", () => {
    detachClient(taskId, ws);
  });
}

// Project ID will be passed as a query param from the client
export async function attachPrettyWsWithProject(
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
    if (task?.prettyLog && task.prettyLog.length > 0) {
      ws.send(JSON.stringify({ type: "replay", blocks: task.prettyLog }));
    } else {
      ws.send(JSON.stringify({ type: "error", error: "No session found" }));
    }
  }

  ws.on("message", async (raw) => {
    try {
      const msg: PrettyWsClientMsg = JSON.parse(raw.toString());
      if (msg.type === "stop") {
        stopSession(taskId);
      } else if (msg.type === "followup") {
        try {
          const task = await getTask(projectId, taskId);
          const project = await getProject(projectId);
          const projectPath = project?.path.replace(/^~/, process.env.HOME || "~") || ".";
          const cwd = task?.worktreePath || projectPath;
          await continueSession(projectId, taskId, msg.text, cwd, ws);
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

async function tryReplayFromDb(taskId: string, ws: WebSocket): Promise<boolean> {
  // Without projectId we can't look up the task — return false
  // The client should use the /ws/pretty?taskId=X&projectId=Y endpoint
  return false;
}
