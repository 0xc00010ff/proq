import * as net from "net";
import * as pty from "node-pty";
import { existsSync } from "fs";
import { homedir } from "os";
import type { WebSocket } from "ws";

const SCROLLBACK_LIMIT = 50 * 1024; // 50 KB ring buffer per PTY

interface PtyEntry {
  pty?: pty.IPty;        // Shell terminals
  socket?: net.Socket;   // Task terminals (bridge socket)
  ws?: WebSocket;
  disconnectTimer?: ReturnType<typeof setTimeout>;
  scrollback: string;
  cmd?: string;
  cwd?: string;
}

const activePtys = new Map<string, PtyEntry>();

function defaultShell(): string {
  return process.env.SHELL || "/bin/zsh";
}

export function spawnPty(tabId: string, cmd?: string, cwd?: string): PtyEntry | null {
  const existing = activePtys.get(tabId);
  if (existing) return existing;

  const resolvedCmd = cmd || defaultShell();
  const rawCwd = cwd || process.cwd();
  const resolvedCwd = rawCwd.startsWith("~") ? rawCwd.replace("~", homedir()) : rawCwd;

  // Parse command: first token is the program, rest are args
  const parts = resolvedCmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [resolvedCmd];
  const program = parts[0];
  const args = parts.slice(1).map((a) => a.replace(/^['"]|['"]$/g, ""));

  // Clean env: strip vars that cause issues in interactive shells
  const env = { ...process.env } as Record<string, string>;
  delete env.CLAUDECODE;
  delete env.npm_config_prefix;
  // Remove all npm_* env vars injected by the parent npm process
  for (const key of Object.keys(env)) {
    if (key.startsWith('npm_')) delete env[key];
  }

  let shell: pty.IPty;
  try {
    shell = pty.spawn(program, args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: resolvedCwd,
      env,
    });
  } catch (err) {
    console.error(`[pty] Failed to spawn "${program}" for tab ${tabId}:`, err);
    return null;
  }

  const entry: PtyEntry = { pty: shell, scrollback: "", cmd: resolvedCmd, cwd: resolvedCwd };
  activePtys.set(tabId, entry);

  // Capture all output into scrollback buffer
  shell.onData((data: string) => {
    // Append to ring buffer, trim if over limit
    entry.scrollback += data;
    if (entry.scrollback.length > SCROLLBACK_LIMIT) {
      entry.scrollback = entry.scrollback.slice(-SCROLLBACK_LIMIT);
    }

    // Forward to attached WS if any
    if (entry.ws) {
      try {
        if (entry.ws.readyState === entry.ws.OPEN) {
          entry.ws.send(data);
        }
      } catch {}
    }
  });

  shell.onExit(({ exitCode }) => {
    const current = activePtys.get(tabId);
    if (current?.ws) {
      try {
        current.ws.send(JSON.stringify({ type: "exit", code: exitCode }));
      } catch {}
    }
    activePtys.delete(tabId);
  });

  return entry;
}

function connectBridgeSocket(tabId: string, socketPath: string): PtyEntry | null {
  const existing = activePtys.get(tabId);
  // If we already have a connected socket, reuse it
  if (existing?.socket && !existing.socket.destroyed) return existing;

  // If entry exists but socket was closed, clean up and reconnect
  if (existing) {
    if (existing.disconnectTimer) clearTimeout(existing.disconnectTimer);
    activePtys.delete(tabId);
  }

  const entry: PtyEntry = { scrollback: "" };
  activePtys.set(tabId, entry);

  const sock = net.createConnection(socketPath);
  entry.socket = sock;

  sock.on("data", (data: Buffer) => {
    const str = data.toString();

    // Append to local scrollback
    entry.scrollback += str;
    if (entry.scrollback.length > SCROLLBACK_LIMIT) {
      entry.scrollback = entry.scrollback.slice(-SCROLLBACK_LIMIT);
    }

    // Forward to attached WS
    if (entry.ws) {
      try {
        if (entry.ws.readyState === entry.ws.OPEN) {
          entry.ws.send(str);
        }
      } catch {}
    }
  });

  sock.on("close", () => {
    console.log(`[pty] bridge socket closed for ${tabId}`);
    // Don't delete entry — keep scrollback for reconnection
  });

  sock.on("error", (err) => {
    console.error(`[pty] bridge socket error for ${tabId}:`, err.message);
  });

  return entry;
}

export function attachWs(tabId: string, ws: WebSocket, cwd?: string): void {
  let entry = activePtys.get(tabId);

  if (!entry) {
    if (tabId.startsWith('task-')) {
      // Connect to bridge unix socket instead of spawning tmux attach
      const shortId = tabId.slice(5); // strip "task-" prefix
      const socketPath = `/tmp/proq/mc-${shortId}.sock`;

      // Poll for socket file (up to 5 seconds)
      let attempts = 0;
      const maxAttempts = 10;
      const tryConnect = () => {
        attempts++;
        if (existsSync(socketPath)) {
          const connected = connectBridgeSocket(tabId, socketPath);
          if (connected) {
            finishAttach(tabId, connected, ws);
          } else {
            sendError(ws, tabId);
          }
        } else if (attempts < maxAttempts) {
          setTimeout(tryConnect, 500);
        } else {
          console.error(`[pty] bridge socket not found after ${maxAttempts} attempts: ${socketPath}`);
          sendError(ws, tabId);
        }
      };
      tryConnect();
      return;
    } else {
      entry = spawnPty(tabId, undefined, cwd) ?? undefined;
    }
  } else if (tabId.startsWith('task-') && entry.socket?.destroyed) {
    // Socket was closed, try to reconnect
    const shortId = tabId.slice(5);
    const socketPath = `/tmp/proq/mc-${shortId}.sock`;
    if (existsSync(socketPath)) {
      entry = connectBridgeSocket(tabId, socketPath) ?? undefined;
    }
  }

  if (!entry) {
    sendError(ws, tabId);
    return;
  }

  finishAttach(tabId, entry, ws);
}

function sendError(ws: WebSocket, tabId: string): void {
  try {
    ws.send(`\r\n\x1b[31m[Failed to spawn terminal for ${tabId}]\x1b[0m\r\n`);
    ws.close();
  } catch {}
}

function finishAttach(tabId: string, entry: PtyEntry, ws: WebSocket): void {
  // Clear disconnect timer
  if (entry.disconnectTimer) {
    clearTimeout(entry.disconnectTimer);
    entry.disconnectTimer = undefined;
  }

  // Close previous WS if still connected (stale connection)
  if (entry.ws && entry.ws !== ws) {
    try { entry.ws.close(); } catch {}
  }

  // Replay scrollback BEFORE setting entry.ws to avoid duplication
  if (entry.scrollback.length > 0) {
    try {
      ws.send(entry.scrollback);
    } catch {}
  }

  entry.ws = ws;

  ws.on("close", () => {
    // Only detach if this is still the active WS (not replaced by a newer one)
    if (entry.ws === ws) {
      detachWs(tabId);
    }
  });
}

export function detachWs(tabId: string): void {
  const entry = activePtys.get(tabId);
  if (!entry) return;

  entry.ws = undefined;

  // For task terminals with bridge sockets, don't start cleanup timer —
  // the bridge persists in tmux, we just disconnect locally
  if (entry.socket) {
    return;
  }

  // Start cleanup timer for shell terminals (5 min — survives HMR + page refreshes)
  entry.disconnectTimer = setTimeout(() => {
    killPty(tabId);
  }, 300_000);
}

export function killPty(tabId: string): void {
  const entry = activePtys.get(tabId);
  if (!entry) return;

  if (entry.disconnectTimer) clearTimeout(entry.disconnectTimer);

  if (entry.socket) {
    try { entry.socket.destroy(); } catch {}
  }
  if (entry.pty) {
    try { entry.pty.kill(); } catch {}
  }

  activePtys.delete(tabId);
}

export function writeToPty(tabId: string, data: string): void {
  const entry = activePtys.get(tabId);
  if (!entry) return;

  if (entry.socket && !entry.socket.destroyed) {
    try { entry.socket.write(data); } catch {}
  } else if (entry.pty) {
    entry.pty.write(data);
  }
}

export function resizePty(tabId: string, cols: number, rows: number): void {
  const entry = activePtys.get(tabId);
  if (!entry) return;

  if (entry.socket && !entry.socket.destroyed) {
    // Send resize as in-band JSON message to bridge
    try {
      entry.socket.write(JSON.stringify({ type: "resize", cols, rows }));
    } catch {}
  } else if (entry.pty) {
    try { entry.pty.resize(cols, rows); } catch {}
  }
}

export function listPtys(): string[] {
  return Array.from(activePtys.keys());
}
