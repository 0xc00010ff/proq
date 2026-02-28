import { spawn } from "child_process";

const MC_API = "http://localhost:1337";
const CLAUDE = process.env.CLAUDE_BIN || "claude";

// Track in-flight requests to avoid duplicates (survives HMR)
const ga = globalThis as unknown as { __proqAutoTitlePending?: Set<string> };
if (!ga.__proqAutoTitlePending) ga.__proqAutoTitlePending = new Set();
const pending = ga.__proqAutoTitlePending;

/**
 * Fire-and-forget: spawn a small claude process to generate a title,
 * then PATCH it back to the task API. Completely non-blocking.
 */
export function autoTitle(projectId: string, taskId: string, description: string): void {
  if (pending.has(taskId)) return;
  pending.add(taskId);

  const prompt = `Give this task a short title (3-8 words, no quotes, no punctuation at the end). Just output the title, nothing else.\n\nTask description:\n${description.slice(0, 1000)}`;

  // Shell pipeline: claude generates the title, then curl patches it back
  const script = `
title=$(${CLAUDE} -p ${shellQuote(prompt)} --model haiku 2>/dev/null)
if [ -n "$title" ]; then
  # Escape for JSON
  title=$(printf '%s' "$title" | head -1 | sed 's/"/\\\\"/g')
  curl -s -X PATCH ${MC_API}/api/projects/${projectId}/tasks/${taskId} \
    -H 'Content-Type: application/json' \
    -d "{\\"title\\":\\"$title\\"}"
fi
`;

  const child = spawn("bash", ["-c", script], {
    stdio: "ignore",
    detached: true,
    env: { ...process.env, DISABLE_INTERACTIVITY: "1" },
  });

  child.unref();

  child.on("exit", () => {
    pending.delete(taskId);
  });

  child.on("error", () => {
    pending.delete(taskId);
  });
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
