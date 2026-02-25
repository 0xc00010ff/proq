import * as net from "net";
import { execSync } from "child_process";
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import type { WebSocket } from "ws";

const SCROLLBACK_LIMIT = 50 * 1024; // 50 KB ring buffer per PTY

interface PtyEntry {
  socket?: net.Socket;
  clients: Set<WebSocket>;
  disconnectTimer?: ReturnType<typeof setTimeout>;
  scrollback: string;
  cmd?: string;
  cwd?: string;
}

const activePtys = new Map<string, PtyEntry>();

function defaultShell(): string {
  return process.env.SHELL || "/bin/zsh";
}

/**
 * Derive tmux session name from tabId.
 * Task tabs: "task-{shortId}" → "mc-{shortId}"
 * Shell tabs: "{tabId}" as-is (e.g. "default-abc12345", "shell-xyz98765")
 */
function sessionName(tabId: string): string {
  if (tabId.startsWith("task-")) {
    return `mc-${tabId.slice(5)}`;
  }
  return tabId;
}

/**
 * Derive bridge socket path from tabId.
 */
function socketPath(tabId: string): string {
  return `/tmp/proq/${sessionName(tabId)}.sock`;
}

/**
 * Spawn a shell terminal in tmux via proq-bridge.
 * Returns true if the session was launched (or already existed).
 */
export function spawnShellSession(tabId: string, cmd?: string, cwd?: string): boolean {
  const session = sessionName(tabId);
  const sock = socketPath(tabId);

  // Idempotent: if tmux session already exists, nothing to do
  try {
    execSync(`tmux has-session -t '${session}' 2>/dev/null`, { timeout: 3_000 });
    return true;
  } catch {
    // Session doesn't exist, proceed to create it
  }

  const resolvedCmd = cmd || defaultShell();
  const rawCwd = cwd || process.cwd();
  const resolvedCwd = rawCwd.startsWith("~") ? rawCwd.replace("~", homedir()) : rawCwd;

  // Write launcher script
  const promptDir = join(tmpdir(), "proq-prompts");
  mkdirSync(promptDir, { recursive: true });
  const launcherFile = join(promptDir, `${session}.sh`);
  writeFileSync(launcherFile, `#!/bin/bash\nexec ${resolvedCmd}\n`, "utf-8");

  // Ensure socket directory exists
  mkdirSync("/tmp/proq", { recursive: true });

  const bridgePath = join(process.cwd(), "src/lib/proq-bridge.js");
  const tmuxCmd = `tmux new-session -d -s '${session}' -c '${resolvedCwd}' node '${bridgePath}' '${sock}' '${launcherFile}'`;

  try {
    execSync(tmuxCmd, { timeout: 10_000 });
    console.log(`[pty] launched tmux shell session ${session} for tab ${tabId}`);
    return true;
  } catch (err) {
    console.error(`[pty] failed to spawn shell session for ${tabId}:`, err);
    return false;
  }
}

function connectBridgeSocket(tabId: string, sockPath: string): PtyEntry | null {
  const existing = activePtys.get(tabId);
  // If we already have a connected socket, reuse it
  if (existing?.socket && !existing.socket.destroyed) return existing;

  // If entry exists but socket was closed, clean up and reconnect
  if (existing) {
    if (existing.disconnectTimer) clearTimeout(existing.disconnectTimer);
    activePtys.delete(tabId);
  }

  const entry: PtyEntry = { clients: new Set(), scrollback: "" };
  activePtys.set(tabId, entry);

  const sock = net.createConnection(sockPath);
  entry.socket = sock;

  sock.on("data", (data: Buffer) => {
    const str = data.toString();

    // Append to local scrollback
    entry.scrollback += str;
    if (entry.scrollback.length > SCROLLBACK_LIMIT) {
      entry.scrollback = entry.scrollback.slice(-SCROLLBACK_LIMIT);
    }

    // Forward to all attached WS clients
    for (const client of entry.clients) {
      try {
        if (client.readyState === client.OPEN) {
          client.send(str);
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

  // Try to reconnect if existing socket is destroyed
  if (entry?.socket?.destroyed) {
    const sock = socketPath(tabId);
    if (existsSync(sock)) {
      entry = connectBridgeSocket(tabId, sock) ?? undefined;
    } else {
      entry = undefined;
    }
  }

  if (!entry) {
    const sock = socketPath(tabId);

    // For shell tabs, ensure tmux session exists
    if (!tabId.startsWith("task-")) {
      spawnShellSession(tabId, undefined, cwd);
    }

    // Poll for socket file (up to 5 seconds)
    let attempts = 0;
    const maxAttempts = 10;
    const tryConnect = () => {
      attempts++;
      if (existsSync(sock)) {
        const connected = connectBridgeSocket(tabId, sock);
        if (connected) {
          finishAttach(tabId, connected, ws);
        } else {
          sendError(ws, tabId);
        }
      } else if (attempts < maxAttempts) {
        setTimeout(tryConnect, 500);
      } else {
        console.error(`[pty] bridge socket not found after ${maxAttempts} attempts: ${sock}`);
        sendError(ws, tabId);
      }
    };
    tryConnect();
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

  // Replay scrollback before adding to clients set
  if (entry.scrollback.length > 0) {
    try {
      ws.send(entry.scrollback);
    } catch {}
  }

  entry.clients.add(ws);

  ws.on("close", () => {
    entry.clients.delete(ws);
    if (entry.clients.size === 0) {
      detachWs(tabId);
    }
  });
}

export function detachWs(tabId: string): void {
  const entry = activePtys.get(tabId);
  if (!entry) return;

  // Close any remaining clients
  for (const client of entry.clients) {
    try { client.close(); } catch {}
  }
  entry.clients.clear();
  // All tabs now use bridge sockets — no cleanup timer needed.
  // Shells persist in tmux until explicitly killed via killPty().
}

export function killPty(tabId: string): void {
  const entry = activePtys.get(tabId);
  if (!entry) return;

  if (entry.disconnectTimer) clearTimeout(entry.disconnectTimer);

  if (entry.socket) {
    try { entry.socket.destroy(); } catch {}
  }

  // Kill the tmux session
  const session = sessionName(tabId);
  try {
    execSync(`tmux kill-session -t '${session}'`, { timeout: 5_000 });
    console.log(`[pty] killed tmux session ${session}`);
  } catch {
    // Session may already be gone
  }

  // Clean up launcher script and socket files for shell tabs
  if (!tabId.startsWith("task-")) {
    const sock = socketPath(tabId);
    const launcherFile = join(tmpdir(), "proq-prompts", `${session}.sh`);
    try { if (existsSync(sock)) unlinkSync(sock); } catch {}
    try { if (existsSync(sock + ".log")) unlinkSync(sock + ".log"); } catch {}
    try { if (existsSync(launcherFile)) unlinkSync(launcherFile); } catch {}
  }

  activePtys.delete(tabId);
}

export function writeToPty(tabId: string, data: string): void {
  const entry = activePtys.get(tabId);
  if (!entry) return;

  if (entry.socket && !entry.socket.destroyed) {
    try { entry.socket.write(data); } catch {}
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
  }
}

export function listPtys(): string[] {
  return Array.from(activePtys.keys());
}
