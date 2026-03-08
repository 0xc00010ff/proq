import { execFile } from "child_process";
import { promisify } from "util";
import { getConfig, setConfig } from "./config";

const execFileAsync = promisify(execFile);

export interface UpdateCheckResult {
  available: boolean;
  commits: string[];
  error?: string;
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const { proqPath } = getConfig();

  try {
    await execFileAsync("git", ["fetch", "origin", "main"], { cwd: proqPath });
    const { stdout } = await execFileAsync(
      "git",
      ["log", "HEAD..origin/main", "--oneline"],
      { cwd: proqPath }
    );

    const commits = stdout
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);

    return { available: commits.length > 0, commits };
  } catch (e: any) {
    return { available: false, commits: [], error: e.message };
  }
}

export async function applyUpdate(
  onLog?: (line: string) => void
): Promise<{ ok: boolean; error?: string }> {
  const { proqPath } = getConfig();

  try {
    // Pull latest
    const pull = await execFileAsync("git", ["pull", "origin", "main"], { cwd: proqPath });
    onLog?.(pull.stdout);

    // Reinstall deps
    onLog?.("Installing dependencies...");
    const install = await execFileAsync("npm", ["install"], { cwd: proqPath });
    onLog?.(install.stdout);

    // Rebuild
    onLog?.("Building...");
    const build = await execFileAsync("npm", ["run", "build"], { cwd: proqPath });
    onLog?.(build.stdout);

    setConfig({ lastUpdated: new Date().toISOString() });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
