import { exec } from "child_process";
import { updateTask } from "./db";

const CLAUDE = process.env.CLAUDE_BIN || "claude";

// Track in-flight requests to avoid duplicates (survives HMR)
const ga = globalThis as unknown as { __proqAutoTitlePending?: Set<string> };
if (!ga.__proqAutoTitlePending) ga.__proqAutoTitlePending = new Set();
const pending = ga.__proqAutoTitlePending;

/**
 * Fire-and-forget: ask Claude Haiku for a short title, then write it directly to the DB.
 */
export function autoTitle(projectId: string, taskId: string, description: string): void {
  if (pending.has(taskId)) return;
  pending.add(taskId);

  const prompt = `Give this task a short title (3-8 words, no quotes, no punctuation at the end). Just output the title, nothing else.\n\nTask description:\n${description.slice(0, 1000)}`;
  const escaped = prompt.replace(/'/g, "'\\''");

  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.PORT;

  exec(
    `${CLAUDE} -p '${escaped}' --model haiku`,
    { timeout: 30_000, env },
    async (err, stdout) => {
      pending.delete(taskId);
      if (err) {
        console.error(`[auto-title] failed for ${taskId.slice(0, 8)}:`, err.message);
        return;
      }
      const title = stdout.trim().split("\n")[0].replace(/^["']|["']$/g, "").replace(/\.+$/, "");
      if (title) {
        await updateTask(projectId, taskId, { title });
        console.log(`[auto-title] ${taskId.slice(0, 8)} → "${title}"`);
      }
    },
  );
}
