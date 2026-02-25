#!/usr/bin/env node
// proq-bridge.js — Runs inside a tmux session, exposes the agent's PTY over a unix domain socket.
// Usage: node proq-bridge.js <socket-path> <launcher-script>
//
// This lets xterm.js connect directly to the PTY without going through tmux's terminal layer,
// avoiding key interception issues (shift-enter, scroll conflicts, etc.).

const net = require("net");
const fs = require("fs");
const path = require("path");

// Resolve node-pty from the project's node_modules
const ptyModule = require(path.join(__dirname, "../../node_modules/node-pty"));

const SCROLLBACK_LIMIT = 50 * 1024; // 50 KB ring buffer

const socketPath = process.argv[2];
const launcherScript = process.argv[3];

if (!socketPath || !launcherScript) {
  console.error("Usage: node proq-bridge.js <socket-path> <launcher-script>");
  process.exit(1);
}

// Clean up stale socket file
if (fs.existsSync(socketPath)) {
  fs.unlinkSync(socketPath);
}

// Ensure socket directory exists
fs.mkdirSync(path.dirname(socketPath), { recursive: true });

// Clean env: strip vars that cause issues
const env = { ...process.env };
delete env.CLAUDECODE;
delete env.PORT;
delete env.npm_config_prefix;
for (const key of Object.keys(env)) {
  if (key.startsWith("npm_")) delete env[key];
}

// Spawn the launcher script in a real PTY
const shell = ptyModule.spawn("bash", [launcherScript], {
  name: "xterm-256color",
  cols: 120,
  rows: 30,
  cwd: process.cwd(),
  env,
});

let scrollback = "";
const activeClients = new Set();
let processExited = false;
let exitCode = null;

// Capture PTY output
shell.onData((data) => {
  scrollback += data;
  if (scrollback.length > SCROLLBACK_LIMIT) {
    scrollback = scrollback.slice(-SCROLLBACK_LIMIT);
  }

  for (const client of activeClients) {
    if (!client.destroyed) {
      try { client.write(data); } catch {}
    }
  }
});

shell.onExit(({ exitCode: code }) => {
  processExited = true;
  exitCode = code;
  console.log(`[proq-bridge] process exited with code ${code}`);

  // Notify all connected clients
  for (const client of activeClients) {
    if (!client.destroyed) {
      try { client.write(JSON.stringify({ type: "exit", code }) + "\n"); } catch {}
    }
  }
});

// Unix domain socket server
const server = net.createServer((client) => {
  console.log("[proq-bridge] client connected");

  activeClients.add(client);

  // Replay scrollback
  if (scrollback.length > 0) {
    try {
      client.write(scrollback);
    } catch {}
  }

  // If process already exited, notify immediately
  if (processExited) {
    try {
      client.write(JSON.stringify({ type: "exit", code: exitCode }) + "\n");
    } catch {}
  }

  // Forward client input to PTY
  let inputBuffer = "";
  client.on("data", (data) => {
    const str = data.toString();

    // Check for in-band JSON resize messages
    // They arrive as complete JSON objects, potentially mixed with terminal data
    inputBuffer += str;

    // Try to extract JSON messages from the buffer
    while (inputBuffer.length > 0) {
      // Look for JSON object start
      const jsonStart = inputBuffer.indexOf("{");
      if (jsonStart === -1) {
        // No JSON, send everything as terminal input
        if (!processExited) {
          try { shell.write(inputBuffer); } catch {}
        }
        inputBuffer = "";
        break;
      }

      // Send any text before the JSON as terminal input
      if (jsonStart > 0) {
        if (!processExited) {
          try { shell.write(inputBuffer.slice(0, jsonStart)); } catch {}
        }
        inputBuffer = inputBuffer.slice(jsonStart);
      }

      // Try to parse JSON
      try {
        // Find the matching closing brace
        let braceDepth = 0;
        let jsonEnd = -1;
        for (let i = 0; i < inputBuffer.length; i++) {
          if (inputBuffer[i] === "{") braceDepth++;
          else if (inputBuffer[i] === "}") {
            braceDepth--;
            if (braceDepth === 0) {
              jsonEnd = i + 1;
              break;
            }
          }
        }

        if (jsonEnd === -1) {
          // Incomplete JSON, wait for more data
          break;
        }

        const jsonStr = inputBuffer.slice(0, jsonEnd);
        const parsed = JSON.parse(jsonStr);

        if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          try { shell.resize(parsed.cols, parsed.rows); } catch {}
          inputBuffer = inputBuffer.slice(jsonEnd);
          continue;
        }

        // Not a recognized message, send as terminal input
        if (!processExited) {
          try { shell.write(jsonStr); } catch {}
        }
        inputBuffer = inputBuffer.slice(jsonEnd);
      } catch {
        // Invalid JSON, send the opening brace as terminal input and continue
        if (!processExited) {
          try { shell.write("{"); } catch {}
        }
        inputBuffer = inputBuffer.slice(1);
      }
    }
  });

  client.on("close", () => {
    console.log("[proq-bridge] client disconnected");
    activeClients.delete(client);
  });

  client.on("error", () => {
    activeClients.delete(client);
  });
});

server.listen(socketPath, () => {
  console.log(`[proq-bridge] listening on ${socketPath}`);
});

// Graceful shutdown: write scrollback to log file, clean up
function shutdown() {
  console.log("[proq-bridge] shutting down...");

  const logPath = socketPath + ".log";
  try {
    fs.writeFileSync(logPath, scrollback, "utf-8");
    console.log(`[proq-bridge] wrote scrollback to ${logPath}`);
  } catch (err) {
    console.error(`[proq-bridge] failed to write log:`, err);
  }

  // Clean up socket file
  try {
    fs.unlinkSync(socketPath);
  } catch {}

  // Kill the PTY if still running
  if (!processExited) {
    try { shell.kill(); } catch {}
  }

  // Close the server
  try { server.close(); } catch {}

  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
