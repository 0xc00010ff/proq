import { claudeOneShot } from "./claude-cli";
import { updateTask } from "./db";
import { emitTaskUpdate } from "./task-events";

// Track in-flight requests to avoid duplicates (survives HMR)
const ga = globalThis as unknown as { __proqAutoTitlePending?: Set<string> };
if (!ga.__proqAutoTitlePending) ga.__proqAutoTitlePending = new Set();
const pending = ga.__proqAutoTitlePending;

function buildPrompt(description: string): string {
  return [
    "Give this task a short title (3-8 words, no quotes, no punctuation at the end).",
    "Just output the title, nothing else.",
    "",
    "Task description:",
    description.slice(0, 1000),
  ].join("\n");
}

function cleanTitle(raw: string): string {
  return raw.split("\n")[0].replace(/^["']|["']$/g, "").replace(/\.+$/, "");
}

/**
 * Generate a title and return it. Also writes to DB and emits SSE.
 * Returns the generated title, or null if generation fails or is already in-flight.
 */
export async function generateTitle(
  projectId: string,
  taskId: string,
  description: string,
): Promise<string | null> {
  if (pending.has(taskId)) return null;
  pending.add(taskId);

  try {
    const raw = await claudeOneShot(buildPrompt(description));
    const title = cleanTitle(raw);
    if (title) {
      await updateTask(projectId, taskId, { title });
      emitTaskUpdate(projectId, taskId, { title });
      console.log(`[auto-title] ${taskId.slice(0, 8)} → "${title}"`);
      return title;
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[auto-title] failed for ${taskId.slice(0, 8)}:`, msg);
    return null;
  } finally {
    pending.delete(taskId);
  }
}

/**
 * Fire-and-forget: ask Claude Haiku for a short title, then write it directly to the DB.
 */
export function autoTitle(projectId: string, taskId: string, description: string): void {
  generateTitle(projectId, taskId, description);
}
