import { createServer } from "http";
import { parse } from "url";
import { WebSocketServer } from "ws";
import { attachWs, writeToPty, resizePty } from "./pty-server";
import { attachAgentWsWithProject } from "./agent-session-server";
import { attachSupervisorWs } from "./supervisor-server";
import { attachAgentTabWs } from "./agent-tab-server";

const PORT = parseInt(process.env.NEXT_PUBLIC_WS_PORT || "42069", 10);

let started = false;

export function startWsServer() {
  if (started) return;
  started = true;

  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.end("ws server");
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname, query } = parse(req.url || "/", true);

    if (pathname === "/ws/terminal") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const tabId = (query.id as string) || "default";
        const cwd = query.cwd as string | undefined;
        console.log(`[ws] terminal connected: ${tabId}`);

        try {
          attachWs(tabId, ws, cwd);
        } catch (err) {
          console.error(`[ws] failed to attach terminal for ${tabId}:`, err);
          try {
            ws.send(`\r\n\x1b[31m[Terminal error: ${err instanceof Error ? err.message : err}]\x1b[0m\r\n`);
            ws.close();
          } catch {}
          return;
        }

        ws.on("message", (raw) => {
          const msg = raw.toString();

          try {
            const parsed = JSON.parse(msg);
            if (parsed.type === "resize" && parsed.cols && parsed.rows) {
              resizePty(tabId, parsed.cols, parsed.rows);
              return;
            }
          } catch {
            // Not JSON — raw terminal input
          }

          writeToPty(tabId, msg);
        });
      });
    } else if (pathname === "/ws/agent") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const taskId = query.taskId as string;
        const projectId = query.projectId as string;
        console.log(`[ws] agent connected: task=${taskId} project=${projectId}`);

        if (!taskId || !projectId) {
          ws.send(JSON.stringify({ type: "error", error: "taskId and projectId required" }));
          ws.close();
          return;
        }

        attachAgentWsWithProject(taskId, projectId, ws);
      });
    } else if (pathname === "/ws/agent-tab") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const tabId = query.tabId as string;
        const projectId = query.projectId as string;
        console.log(`[ws] agent-tab connected: tab=${tabId} project=${projectId}`);

        if (!tabId || !projectId) {
          ws.send(JSON.stringify({ type: "error", error: "tabId and projectId required" }));
          ws.close();
          return;
        }

        attachAgentTabWs(tabId, projectId, ws);
      });
    } else if (pathname === "/ws/supervisor") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        console.log(`[ws] supervisor connected`);
        attachSupervisorWs(ws);
      });
    } else {
      socket.destroy();
    }
  });

  server.listen(PORT, () => {
    console.log(`> WS server on ws://localhost:${PORT}`);
  });
}
