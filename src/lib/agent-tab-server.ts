import type WebSocket from "ws";
import {
  getAgentTabSession,
  attachAgentTabClient,
  detachAgentTabClient,
  stopAgentTabSession,
  startAgentTabSession,
  continueAgentTabSession,
} from "./agent-tab-runtime";
import { getAgentTabData, getProject } from "./db";
import type { PrettyWsClientMsg } from "./types";

export async function attachAgentTabWs(
  tabId: string,
  projectId: string,
  ws: WebSocket,
): Promise<void> {
  const session = getAgentTabSession(tabId);

  if (session) {
    // Live session — replay existing blocks then subscribe
    ws.send(JSON.stringify({ type: "replay", blocks: session.blocks }));
    attachAgentTabClient(tabId, ws);
  } else {
    // No live session — try to load persisted prettyLog from DB
    const stored = await getAgentTabData(projectId, tabId);
    if (stored?.prettyLog && stored.prettyLog.length > 0) {
      ws.send(JSON.stringify({ type: "replay", blocks: stored.prettyLog }));
    } else {
      // No history — send empty replay so client knows it's connected
      ws.send(JSON.stringify({ type: "replay", blocks: [] }));
    }
  }

  ws.on("message", async (raw) => {
    try {
      const msg: PrettyWsClientMsg = JSON.parse(raw.toString());
      if (msg.type === "stop") {
        stopAgentTabSession(tabId);
      } else if (msg.type === "followup") {
        try {
          const project = await getProject(projectId);
          const cwd = project?.path.replace(/^~/, process.env.HOME || "~") || ".";

          const session = getAgentTabSession(tabId);
          if (session) {
            // Continue existing session
            await continueAgentTabSession(tabId, projectId, msg.text, cwd, ws, msg.attachments);
          } else {
            // Check if there's a stored session to resume
            const stored = await getAgentTabData(projectId, tabId);
            if (stored?.sessionId) {
              await continueAgentTabSession(tabId, projectId, msg.text, cwd, ws, msg.attachments);
            } else {
              // Start a new session
              await startAgentTabSession(tabId, projectId, msg.text, cwd);
              const newSession = getAgentTabSession(tabId);
              if (newSession) {
                attachAgentTabClient(tabId, ws);
                // Replay blocks that were already emitted before client was attached
                ws.send(JSON.stringify({ type: "replay", blocks: newSession.blocks }));
              }
            }
          }
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
