import * as pty from "node-pty";
import type { WebSocket } from "ws";

interface PtyEntry {
  pty: pty.IPty;
  ws?: WebSocket;
  disconnectTimer?: ReturnType<typeof setTimeout>;
  cmd?: string;
  cwd?: string;
}

const activePtys = new Map<string, PtyEntry>();

const CLAUDE_BIN = process.env.CLAUDE_BIN || "/Users/brian/.local/bin/claude";

function defaultCmd(tabId: string): string {
  if (tabId === "default") return `${CLAUDE_BIN} --dangerously-skip-permissions`;
  if (tabId.startsWith("shell-")) return process.env.SHELL || "/bin/zsh";
  return process.env.SHELL || "/bin/zsh";
}

export function spawnPty(tabId: string, cmd?: string, cwd?: string): PtyEntry {
  // If already exists, return it
  const existing = activePtys.get(tabId);
  if (existing) return existing;

  const resolvedCmd = cmd || defaultCmd(tabId);
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

  const entry: PtyEntry = { pty: shell, cmd: resolvedCmd, cwd: resolvedCwd };
  activePtys.set(tabId, entry);

  shell.onExit(({ exitCode }) => {
    const current = activePtys.get(tabId);
    if (current?.ws) {
      try {
        current.ws.send(JSON.stringify({ type: "exit", code: exitCode }));
      } catch {}
    }

    activePtys.delete(tabId);

    // Respawn default tab only on clean exit
    if (tabId === "default" && exitCode === 0) {
      setTimeout(() => spawnPty("default"), 500);
    }
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

  entry.ws = ws;

  // Pipe PTY output to WS
  const dataHandler = entry.pty.onData((data: string) => {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    } catch {}
  });

  ws.on("close", () => {
    dataHandler.dispose();
    detachWs(tabId);
  });
}

export function detachWs(tabId: string): void {
  const entry = activePtys.get(tabId);
  if (!entry) return;

  entry.ws = undefined;

  // Start cleanup timer (60s), except default which should persist
  if (tabId === "default") return;

  entry.disconnectTimer = setTimeout(() => {
    killPty(tabId);
  }, 60_000);
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
