import { Codex } from "@openai/codex-sdk";
import { getSettings } from "./db";

/**
 * One-shot Codex SDK call. Starts a thread, runs the prompt, returns the final response.
 */
export async function codexOneShot(
  prompt: string,
  options?: { model?: string },
): Promise<string> {
  const settings = await getSettings();
  const model = options?.model ?? settings.codexModel ?? null;

  const codex = new Codex({
    ...(process.env.CODEX_BIN ? { codexPathOverride: process.env.CODEX_BIN } : {}),
  });

  const thread = codex.startThread({
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    ...(model ? { model } : {}),
  });

  const turn = await thread.run(prompt);
  return turn.finalResponse;
}
