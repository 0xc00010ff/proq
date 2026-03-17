import { execSync } from "child_process";
import { existsSync } from "fs";

// ── In-process cache on globalThis to survive HMR ──
const g = globalThis as unknown as {
  __proqCodexCmdCache?: string[] | null;
};

/**
 * Returns the command prefix to invoke the Codex CLI.
 * Returns ["codex"] if installed globally, or ["npx", "@openai/codex"] as fallback.
 * Checks CODEX_BIN env var first.
 */
export async function getCodexCmd(): Promise<string[]> {
  if (g.__proqCodexCmdCache) return g.__proqCodexCmdCache;

  // 1. Explicit override
  if (process.env.CODEX_BIN) {
    g.__proqCodexCmdCache = [process.env.CODEX_BIN];
    return g.__proqCodexCmdCache;
  }

  // 2. Interactive shell `which` (catches nvm, homebrew, custom PATHs)
  for (const shell of ["zsh", "bash"]) {
    try {
      const result = execSync(`${shell} -i -c 'which codex'`, {
        timeout: 5_000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      if (result && result.startsWith("/") && existsSync(result)) {
        g.__proqCodexCmdCache = [result];
        return g.__proqCodexCmdCache;
      }
    } catch {
      // shell not available or codex not found
    }
  }

  // 3. Fall back to npx
  g.__proqCodexCmdCache = ["npx", "@openai/codex"];
  return g.__proqCodexCmdCache;
}

export function invalidateCodexCmdCache(): void {
  g.__proqCodexCmdCache = null;
}
