import type WebSocket from "ws";
import {
  getAgentTabSession,
  attachAgentTabClient,
  detachAgentTabClient,
  stopAgentTabSession,
  interruptAgentTabSession,
  startAgentTabSession,
  continueAgentTabSession,
  clearAgentTabSession,
} from "./agent-tab-runtime";
import { getWorkbenchSession, getProject } from "./db";
import { resolveProjectPath } from "./utils";
import type { AgentWsClientMsg } from "./types";

export async function attachAgentTabWs(
  tabId: string,
  projectId: string,
  ws: WebSocket,
  agentId?: string,
): Promise<void> {
  const session = getAgentTabSession(tabId);

  if (session) {
    // Live session — replay existing blocks then subscribe
    ws.send(JSON.stringify({ type: "replay", blocks: session.blocks }));
    attachAgentTabClient(tabId, ws);
  } else {
    // No live session — try to load persisted agentBlocks from DB
    const stored = await getWorkbenchSession(projectId, tabId);
    if (stored?.agentBlocks && stored.agentBlocks.length > 0) {
      ws.send(JSON.stringify({ type: "replay", blocks: stored.agentBlocks }));
    } else {
      // No history — send empty replay so client knows it's connected
      ws.send(JSON.stringify({ type: "replay", blocks: [] }));
    }
  }

  ws.on("message", async (raw) => {
    try {
      const msg: AgentWsClientMsg = JSON.parse(raw.toString());
      if (msg.type === "clear") {
        await clearAgentTabSession(tabId, projectId);
        ws.send(JSON.stringify({ type: "replay", blocks: [] }));
      } else if (msg.type === "stop") {
        stopAgentTabSession(tabId);
      } else if (msg.type === "followup") {
        try {
          const project = await getProject(projectId);
          const cwd = project ? resolveProjectPath(project.path) : ".";
          const mode = msg.mode;

          const session = getAgentTabSession(tabId);
          if (session) {
            await continueAgentTabSession(tabId, projectId, msg.text, cwd, ws, msg.attachments, { mode });
          } else {
            const stored = await getWorkbenchSession(projectId, tabId);
            if (stored?.sessionId) {
              await continueAgentTabSession(tabId, projectId, msg.text, cwd, ws, msg.attachments, { mode });
            } else {
              await startAgentTabSession(tabId, projectId, msg.text, cwd, msg.attachments, mode as import("./types").TaskMode | undefined, agentId);
              const newSession = getAgentTabSession(tabId);
              if (newSession) {
                attachAgentTabClient(tabId, ws);
                ws.send(JSON.stringify({ type: "replay", blocks: newSession.blocks }));
              }
            }
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          ws.send(JSON.stringify({ type: "error", error: errorMsg }));
        }
      } else if (msg.type === "plan-approve") {
        try {
          const project = await getProject(projectId);
          const cwd = project ? resolveProjectPath(project.path) : ".";
          await continueAgentTabSession(tabId, projectId, msg.text, cwd, ws, undefined, { planApproved: true });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          ws.send(JSON.stringify({ type: "error", error: errorMsg }));
        }
      } else if (msg.type === "interrupt") {
        try {
          const project = await getProject(projectId);
          const cwd = project ? resolveProjectPath(project.path) : ".";
          await interruptAgentTabSession(tabId);
          await continueAgentTabSession(tabId, projectId, msg.text, cwd, ws, msg.attachments);
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
    detachAgentTabClient(tabId, ws);
  });
}
