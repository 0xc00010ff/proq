import { createServer } from "http";
import { parse } from "url";
import { WebSocketServer } from "ws";
import { attachWs, writeToPty, resizePty } from "./pty-server";

const PORT = 42069;

let started = false;

export function startTerminalServer() {
  if (started) return;
  started = true;

  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.end("terminal ws server");
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname, query } = parse(req.url || "/", true);

    if (pathname === "/ws/terminal") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const tabId = (query.id as string) || "default";
        console.log(`[ws] terminal connected: ${tabId}`);

        attachWs(tabId, ws);

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
    } else {
      socket.destroy();
    }
  });

  server.listen(PORT, () => {
    console.log(`> Terminal WS server on ws://localhost:${PORT}`);
  });
}
