import * as pty from "node-pty";
import type { WebSocket } from "ws";

const SCROLLBACK_LIMIT = 50 * 1024; // 50 KB ring buffer per PTY

interface PtyEntry {
  pty: pty.IPty;
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

export function spawnPty(tabId: string, cmd?: string, cwd?: string): PtyEntry {
  const existing = activePtys.get(tabId);
  if (existing) return existing;

  const resolvedCmd = cmd || defaultShell();
  const resolvedCwd = cwd || process.cwd();

  // Parse command: first token is the program, rest are args
  const parts = resolvedCmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [resolvedCmd];
  const program = parts[0];
  const args = parts.slice(1).map((a) => a.replace(/^['"]|['"]$/g, ""));

  // Strip CLAUDECODE env var so nested Claude instances don't refuse to start
  const env = { ...process.env } as Record<string, string>;
  delete env.CLAUDECODE;

  const shell = pty.spawn(program, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: resolvedCwd,
    env,
  });

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

export function attachWs(tabId: string, ws: WebSocket): void {
  let entry = activePtys.get(tabId);

  if (!entry) {
    entry = spawnPty(tabId);
  }

  // Clear disconnect timer
  if (entry.disconnectTimer) {
    clearTimeout(entry.disconnectTimer);
    entry.disconnectTimer = undefined;
  }

  // Close previous WS if still connected (stale connection)
  if (entry.ws && entry.ws !== ws) {
    try { entry.ws.close(); } catch {}
  }

  entry.ws = ws;

  // Replay scrollback buffer so client sees previous output
  if (entry.scrollback.length > 0) {
    try {
      ws.send(entry.scrollback);
    } catch {}
  }

  // Data is already forwarded to ws via the onData handler in spawnPty,
  // so we only need to handle WS close here.
  ws.on("close", () => {
    // Only detach if this is still the active WS (not replaced by a newer one)
    if (entry!.ws === ws) {
      detachWs(tabId);
    }
  });
}

export function detachWs(tabId: string): void {
  const entry = activePtys.get(tabId);
  if (!entry) return;

  entry.ws = undefined;

  // Start cleanup timer (5 min — survives HMR + page refreshes)
  entry.disconnectTimer = setTimeout(() => {
    killPty(tabId);
  }, 300_000);
}

export function killPty(tabId: string): void {
  const entry = activePtys.get(tabId);
  if (!entry) return;

  if (entry.disconnectTimer) clearTimeout(entry.disconnectTimer);

  try {
    entry.pty.kill();
  } catch {}

  activePtys.delete(tabId);
}

export function writeToPty(tabId: string, data: string): void {
  const entry = activePtys.get(tabId);
  if (entry) {
    entry.pty.write(data);
  }
}

export function resizePty(tabId: string, cols: number, rows: number): void {
  const entry = activePtys.get(tabId);
  if (entry) {
    try {
      entry.pty.resize(cols, rows);
    } catch {}
  }
}

export function listPtys(): string[] {
  return Array.from(activePtys.keys());
}
