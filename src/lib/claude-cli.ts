import { spawn } from "child_process";

const CLAUDE = process.env.CLAUDE_BIN || "claude";

/**
 * One-shot Claude CLI call. Spawns `claude -p <prompt>` and returns the text output.
 * Uses the same spawn pattern as pretty-runtime.ts.
 */
export function claudeOneShot(
  prompt: string,
  options?: { model?: string },
): Promise<string> {
  const args = ["-p", prompt, "--model", options?.model ?? "haiku"];

  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE, args, {
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
