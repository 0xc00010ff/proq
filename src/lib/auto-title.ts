import { exec } from "child_process";
import { updateTask } from "./db";

const CLAUDE = process.env.CLAUDE_BIN || "claude";

// Track in-flight auto-title requests to avoid duplicates
const ga = globalThis as unknown as {
  __proqAutoTitlePending?: Set<string>;
};
if (!ga.__proqAutoTitlePending) ga.__proqAutoTitlePending = new Set();
const pending = ga.__proqAutoTitlePending;

/**
 * Fire-and-forget: generate a short title for a task using Claude Haiku.
 * Non-blocking — updates the task in the background when ready.
 */
export function autoTitle(projectId: string, taskId: string, description: string): void {
  if (pending.has(taskId)) return;
  pending.add(taskId);

  const prompt = `Give this task a short title (3-8 words, no quotes, no punctuation at the end). Just output the title, nothing else.\n\nTask description:\n${description.slice(0, 1000)}`;

  const child = exec(
    `${CLAUDE} --print --model haiku --max-turns 1 -p ${escapeShellArg(prompt)}`,
    { timeout: 30_000, env: { ...process.env, DISABLE_INTERACTIVITY: "1" } },
    async (err, stdout) => {
      pending.delete(taskId);
      if (err) {
        console.error(`[auto-title] failed for ${taskId.slice(0, 8)}:`, err.message);
        return;
      }
      const title = stdout.trim().replace(/^["']|["']$/g, "").replace(/\.+$/, "");
      if (title) {
        await updateTask(projectId, taskId, { title });
        console.log(`[auto-title] ${taskId.slice(0, 8)} → "${title}"`);
      }
    },
  );

  child.unref?.();
}

function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}
