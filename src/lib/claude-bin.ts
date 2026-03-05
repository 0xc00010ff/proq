import { execSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getSettings, updateSettings } from "./db";

// ── In-process cache on globalThis to survive HMR ──
const g = globalThis as unknown as {
  __proqClaudeBinCache?: string | null;
};

/**
 * Returns the resolved path to the Claude CLI binary.
 * Reads from settings.claudeBin; if unresolved ("claude" or empty),
 * runs detection, persists the result, and caches it.
 */
export async function getClaudeBin(): Promise<string> {
  // Return cached value if it still exists on disk
  if (g.__proqClaudeBinCache) {
    if (g.__proqClaudeBinCache === "claude" || existsSync(g.__proqClaudeBinCache)) {
      return g.__proqClaudeBinCache;
    }
    // Cached path went stale (e.g. node version changed) — re-detect
    g.__proqClaudeBinCache = null;
  }

  const settings = await getSettings();
  const current = settings.claudeBin;

  // If already resolved to an absolute path and it still exists, use it
  if (current && current !== "claude" && current.startsWith("/") && existsSync(current)) {
    g.__proqClaudeBinCache = current;
    return current;
  }

  // Auto-detect and persist
  const detected = await detectClaudeBin();
  if (detected !== "claude") {
    await updateSettings({ claudeBin: detected });
  }
  g.__proqClaudeBinCache = detected;
  return detected;
}

/**
 * Detect the Claude CLI binary path by checking common installation methods.
 * Returns an absolute path if found, or bare "claude" as fallback.
 */
export async function detectClaudeBin(): Promise<string> {
  // 1. Try interactive shell `which` (catches nvm, homebrew, custom PATHs)
  for (const shell of ["zsh", "bash"]) {
    try {
      const result = execSync(`${shell} -i -c 'which claude'`, {
        timeout: 5_000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      if (result && result.startsWith("/") && existsSync(result)) {
        return result;
      }
    } catch {
      // shell not available or claude not found
    }
  }

  // 2. Enumerate nvm node versions
  const nvmDir = process.env.NVM_DIR || join(homedir(), ".nvm");
  const versionsDir = join(nvmDir, "versions", "node");
  try {
    if (existsSync(versionsDir)) {
      const versions = readdirSync(versionsDir).sort().reverse();
      for (const ver of versions) {
        const candidate = join(versionsDir, ver, "bin", "claude");
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch {
    // nvm dir not readable
  }

  // 3. Check known paths
  const knownPaths = [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    join(homedir(), ".npm-global", "bin", "claude"),
  ];
  for (const p of knownPaths) {
    if (existsSync(p)) return p;
  }

  // 4. Fallback
  return "claude";
}

/**
 * Clear the in-process cache. Call when settings.claudeBin is changed.
 */
export function invalidateClaudeBinCache(): void {
  g.__proqClaudeBinCache = null;
}
