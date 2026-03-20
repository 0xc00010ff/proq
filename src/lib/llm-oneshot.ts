import { claudeOneShot } from "./claude-cli";
import { codexOneShot } from "./codex-cli";
import { getSettings } from "./db";

/**
 * Provider-agnostic one-shot LLM call. Used for auto-title generation,
 * commit message generation, and other lightweight inference tasks.
 */
export async function llmOneShot(
  prompt: string,
  options?: { model?: string },
): Promise<string> {
  const settings = await getSettings();

  if (settings.agentProvider === "codex") {
    return codexOneShot(prompt, options);
  }

  return claudeOneShot(prompt, options);
}
