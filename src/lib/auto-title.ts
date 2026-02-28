import { spawn } from "child_process";
import { updateTask } from "./db";

const CLAUDE = process.env.CLAUDE_BIN || "claude";

// Track in-flight requests to avoid duplicates (survives HMR)
const ga = globalThis as unknown as { __proqAutoTitlePending?: Set<string> };
if (!ga.__proqAutoTitlePending) ga.__proqAutoTitlePending = new Set();
const pending = ga.__proqAutoTitlePending;

/**
 * Fire-and-forget: ask Claude Haiku for a short title, then write it directly to the DB.
 * Uses spawn with args array (same pattern as pretty-runtime.ts).
 */
export function autoTitle(projectId: string, taskId: string, description: string): void {
  if (pending.has(taskId)) return;
  pending.add(taskId);

  const prompt = [
    "Give this task a short title (3-8 words, no quotes, no punctuation at the end).",
    "Just output the title, nothing else.",
    "",
    "Task description:",
    description.slice(0, 1000),
  ].join("\n");

  const proc = spawn(CLAUDE, ["-p", prompt, "--model", "haiku"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined, PORT: undefined },
  });

  let stdout = "";
  proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });

  proc.on("close", async (code) => {
    pending.delete(taskId);
    if (code !== 0) {
      console.error(`[auto-title] failed for ${taskId.slice(0, 8)}: exit=${code}`);
      return;
    }
    const title = stdout.trim().split("\n")[0].replace(/^["']|["']$/g, "").replace(/\.+$/, "");
    if (title) {
      await updateTask(projectId, taskId, { title });
      console.log(`[auto-title] ${taskId.slice(0, 8)} → "${title}"`);
    }
  });

  proc.on("error", (err) => {
    pending.delete(taskId);
    console.error(`[auto-title] spawn error for ${taskId.slice(0, 8)}:`, err.message);
  });
}
