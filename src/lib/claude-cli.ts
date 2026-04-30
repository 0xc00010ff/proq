import { spawn } from "child_process";
import { tmpdir } from "os";
import { getClaudeBin } from "./claude-bin";
import { escapePrompt, childProcessEnv } from "./utils";

/**
 * One-shot Claude CLI call. Spawns `claude -p <prompt>` with minimization flags
 * so we skip MCP servers, settings, plugins, slash commands, tools, and session
 * persistence — none of which a single-shot text generation needs. This shaves
 * ~2s off each call vs. defaults.
 */
export async function claudeOneShot(
  prompt: string,
  options?: { model?: string; systemPrompt?: string },
): Promise<string> {
  const claudeBin = await getClaudeBin();
  const args = [
    "-p", escapePrompt(prompt),
    "--model", options?.model ?? "haiku",
    "--system-prompt", options?.systemPrompt ?? "You are a concise text generator. Output exactly what the user asks for, nothing else.",
    "--tools", "",
    "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}',
    "--setting-sources", "",
    "--no-session-persistence",
    "--disable-slash-commands",
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(claudeBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: childProcessEnv(),
      cwd: tmpdir(),
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
