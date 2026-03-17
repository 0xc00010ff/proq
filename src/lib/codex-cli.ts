import { spawn } from "child_process";
import { getCodexCmd } from "./codex-bin";
import { getSettings } from "./db";

/**
 * One-shot Codex CLI call. Spawns `codex exec --json` and extracts agent_message text.
 */
export async function codexOneShot(
  prompt: string,
  options?: { model?: string },
): Promise<string> {
  const settings = await getSettings();
  const model = options?.model ?? settings.codexModel ?? null;

  const codexCmd = await getCodexCmd();
  const [bin, ...prefixArgs] = codexCmd;

  const args = [
    ...prefixArgs,
    "exec",
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    ...(model ? ["--model", model] : []),
    prompt,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", PORT: undefined },
    });

    let stdoutBuf = "";
    let stderrBuf = "";
    const textParts: string[] = [];

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;
          if (
            event.type === "item.completed" &&
            (event.item as Record<string, unknown>)?.type === "agent_message"
          ) {
            const text = ((event.item as Record<string, unknown>).text as string) || "";
            if (text) textParts.push(text);
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`codex exited ${code}: ${stderrBuf.trim() || "unknown error"}`));
      } else {
        resolve(textParts.join("\n").trim());
      }
    });

    proc.on("error", reject);
  });
}
