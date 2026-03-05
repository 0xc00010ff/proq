import { spawn } from "child_process";
import { getClaudeBin } from "./claude-bin";

/**
 * One-shot Claude CLI call. Spawns `claude -p <prompt>` and returns the text output.
 * Uses the same spawn pattern as agent-session.ts.
 */
export async function claudeOneShot(
  prompt: string,
  options?: { model?: string },
): Promise<string> {
  const claudeBin = await getClaudeBin();
  const args = ["-p", prompt, "--model", options?.model ?? "haiku"];

  return new Promise((resolve, reject) => {
    const proc = spawn(claudeBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CLAUDECODE: undefined, PORT: undefined },
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr || stdout}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on("error", reject);
  });
}
