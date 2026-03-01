import type WebSocket from "ws";
import {
  getSupervisorSession,
  attachSupervisorClient,
  detachSupervisorClient,
  stopSupervisorSession,
  startSupervisorSession,
  continueSupervisorSession,
} from "./supervisor-runtime";
import { getSupervisorAgentBlocks } from "./db";
import type { AgentWsClientMsg } from "./types";

export async function attachSupervisorWs(ws: WebSocket): Promise<void> {
  const session = getSupervisorSession();

  if (session) {
    // Live session — replay existing blocks then subscribe
    ws.send(JSON.stringify({ type: "replay", blocks: session.blocks }));
    attachSupervisorClient(ws);
  } else {
    // No live session — try to load persisted agentBlocks from DB
    const stored = await getSupervisorAgentBlocks();
    if (stored.agentBlocks && stored.agentBlocks.length > 0) {
      ws.send(JSON.stringify({ type: "replay", blocks: stored.agentBlocks }));
    } else {
      // No history — send empty replay so client knows it's connected
      ws.send(JSON.stringify({ type: "replay", blocks: [] }));
    }
  }

  ws.on("message", async (raw) => {
    try {
      const msg: AgentWsClientMsg = JSON.parse(raw.toString());
      if (msg.type === "stop") {
        stopSupervisorSession();
      } else if (msg.type === "followup") {
        try {
          const session = getSupervisorSession();
          if (session) {
            // Continue existing session
            await continueSupervisorSession(msg.text, ws, msg.attachments);
          } else {
            // Start a new session
            // First attach the client so it gets blocks
            await startSupervisorSession(msg.text);
            const newSession = getSupervisorSession();
            if (newSession) {
              attachSupervisorClient(ws);
              // Replay blocks that were already emitted before client was attached
              ws.send(JSON.stringify({ type: "replay", blocks: newSession.blocks }));
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
    detachSupervisorClient(ws);
  });
}
