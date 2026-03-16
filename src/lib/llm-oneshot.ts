import { getSettings } from "./db";
import { claudeOneShot } from "./claude-cli";

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
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const codexModel = settings.codexModel || "gpt-4o-mini";
    const model = options?.model ?? codexModel;
    const res = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
    });
    return res.choices[0]?.message?.content?.trim() ?? "";
  }

  return claudeOneShot(prompt, options);
}
