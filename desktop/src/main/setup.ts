import { execFile, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { getConfig, setConfig } from "./config";

const execFileAsync = promisify(execFile);

export interface CheckResult {
  ok: boolean;
  version?: string;
  path?: string;
  error?: string;
}

export async function checkNodeVersion(): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync("node", ["-v"]);
    const version = stdout.trim().replace(/^v/, "");
    const major = parseInt(version.split(".")[0], 10);
    if (major >= 18) {
      return { ok: true, version };
    }
    return { ok: false, version, error: `Node.js ${version} found — v18+ required` };
  } catch {
    return { ok: false, error: "Node.js not found" };
  }
}

export async function checkTmux(): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync("tmux", ["-V"]);
    const version = stdout.trim().replace(/^tmux\s*/, "");
    return { ok: true, version };
  } catch {
    return { ok: false, error: "tmux not found" };
  }
}

export async function installTmux(): Promise<CheckResult> {
  try {
    if (process.platform === "darwin") {
      await execFileAsync("brew", ["install", "tmux"]);
    } else {
      await execFileAsync("sudo", ["apt-get", "install", "-y", "tmux"]);
    }
    return checkTmux();
  } catch (e: any) {
    return { ok: false, error: `Failed to install tmux: ${e.message}` };
  }
}

export async function checkClaudeCli(): Promise<CheckResult> {
  const searchPaths = [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    path.join(process.env.HOME || "", ".npm-global/bin/claude"),
  ];

  // Check if `claude` is on PATH
  try {
    const { stdout } = await execFileAsync("which", ["claude"]);
    const claudePath = stdout.trim();
    if (claudePath) {
      return { ok: true, path: claudePath };
    }
  } catch {
    // not on PATH, check known locations
  }

  for (const p of searchPaths) {
    try {
      await fs.promises.access(p, fs.constants.X_OK);
      return { ok: true, path: p };
    } catch {
      continue;
    }
  }

  // Check nvm directories
  const nvmDir = process.env.NVM_DIR;
  if (nvmDir) {
    const versionsDir = path.join(nvmDir, "versions/node");
    try {
      const entries = await fs.promises.readdir(versionsDir);
      for (const entry of entries.reverse()) {
        const claudePath = path.join(versionsDir, entry, "bin/claude");
        try {
          await fs.promises.access(claudePath, fs.constants.X_OK);
          return { ok: true, path: claudePath };
        } catch {
          continue;
        }
      }
    } catch {
      // nvm dir doesn't exist
    }
  }

  return { ok: false, error: "Claude Code CLI not found" };
}

export async function checkXcodeTools(): Promise<CheckResult> {
  if (process.platform !== "darwin") {
    return { ok: true, version: "n/a" };
  }
  try {
    await execFileAsync("xcode-select", ["-p"]);
    return { ok: true };
  } catch {
    return { ok: false, error: "Xcode Command Line Tools not installed" };
  }
}

export async function cloneProq(targetDir: string): Promise<{ ok: boolean; error?: string }> {
  // Check if already cloned
  const pkgPath = path.join(targetDir, "package.json");
  try {
    const raw = await fs.promises.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    if (pkg.name === "proq") {
      return { ok: true }; // Already cloned
    }
  } catch {
    // Not cloned yet
  }

  try {
    const parentDir = path.dirname(targetDir);
    const dirName = path.basename(targetDir);
    await fs.promises.mkdir(parentDir, { recursive: true });
    await execFileAsync("git", ["clone", "https://github.com/0xc00010ff/proq.git", dirName], {
      cwd: parentDir,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `Clone failed: ${e.message}` };
  }
}

export async function validateExistingInstall(dirPath: string): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(path.join(dirPath, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    return pkg.name === "proq";
  } catch {
    return false;
  }
}

export function runNpmInstall(
  proqPath: string,
  onLog: (line: string) => void
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["install"], {
      cwd: proqPath,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (data: Buffer) => onLog(data.toString()));
    child.stderr?.on("data", (data: Buffer) => onLog(data.toString()));

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: `npm install exited with code ${code}` });
      }
    });

    child.on("error", (err) => {
      resolve({ ok: false, error: err.message });
    });
  });
}

export function runNpmBuild(
  proqPath: string,
  onLog: (line: string) => void
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "build"], {
      cwd: proqPath,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (data: Buffer) => onLog(data.toString()));
    child.stderr?.on("data", (data: Buffer) => onLog(data.toString()));

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: `npm run build exited with code ${code}` });
      }
    });

    child.on("error", (err) => {
      resolve({ ok: false, error: err.message });
    });
  });
}

export async function persistClaudePath(proqPath: string, claudeBinPath: string): Promise<void> {
  const settingsFile = path.join(proqPath, "data", "settings.json");
  await fs.promises.mkdir(path.join(proqPath, "data"), { recursive: true });

  let settings: Record<string, any> = {};
  try {
    const raw = await fs.promises.readFile(settingsFile, "utf-8");
    settings = JSON.parse(raw);
  } catch {
    // No existing settings
  }

  settings.claudeBin = claudeBinPath;
  await fs.promises.writeFile(settingsFile, JSON.stringify(settings, null, 2) + "\n");
  setConfig({ claudeBinPath: claudeBinPath });
}
