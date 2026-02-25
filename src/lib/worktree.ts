import { execSync } from "child_process";
import { existsSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";

const WORKTREE_DIR = ".proq-worktrees";

export function createWorktree(
  projectPath: string,
  shortId: string,
): string {
  ensureGitignore(projectPath);
  const worktreePath = join(projectPath, WORKTREE_DIR, shortId);
  const branch = `proq/${shortId}`;
  execSync(
    `git -C '${projectPath}' worktree add '${WORKTREE_DIR}/${shortId}' -b '${branch}'`,
    { timeout: 30_000 },
  );
  console.log(`[worktree] created ${worktreePath} on branch ${branch}`);
  return worktreePath;
}

export function removeWorktree(
  projectPath: string,
  shortId: string,
): void {
  const branch = `proq/${shortId}`;
  try {
    execSync(
      `git -C '${projectPath}' worktree remove '${WORKTREE_DIR}/${shortId}' --force`,
      { timeout: 15_000 },
    );
    console.log(`[worktree] removed worktree for ${shortId}`);
  } catch (err) {
    console.error(`[worktree] failed to remove worktree for ${shortId}:`, err);
  }
  try {
    execSync(`git -C '${projectPath}' branch -D '${branch}'`, {
      timeout: 10_000,
    });
    console.log(`[worktree] deleted branch ${branch}`);
  } catch {
    // Branch may already be gone
  }
}

export function mergeWorktree(
  projectPath: string,
  shortId: string,
): { success: boolean; error?: string; conflictFiles?: string[] } {
  const branch = `proq/${shortId}`;
  try {
    execSync(
      `git -C '${projectPath}' merge '${branch}' --no-ff -m 'Merge ${branch}'`,
      { timeout: 30_000 },
    );
    console.log(`[worktree] merged ${branch} into main`);
    removeWorktree(projectPath, shortId);
    return { success: true };
  } catch (err) {
    // Capture conflicting file list before aborting
    let conflictFiles: string[] = [];
    try {
      const output = execSync(
        `git -C '${projectPath}' diff --name-only --diff-filter=U`,
        { timeout: 10_000, encoding: "utf-8" },
      );
      conflictFiles = output.trim().split("\n").filter(Boolean);
    } catch {
      // May fail if merge didn't leave conflicts
    }

    // Abort the failed merge
    try {
      execSync(`git -C '${projectPath}' merge --abort`, { timeout: 10_000 });
    } catch {
      // merge --abort can fail if there's nothing to abort
    }
    const message =
      err instanceof Error ? err.message : "Unknown merge error";
    console.error(`[worktree] merge failed for ${branch}:`, message);
    return {
      success: false,
      error: `Merge conflict merging ${branch}`,
      conflictFiles,
    };
  }
}

export function getCurrentBranch(
  projectPath: string,
): { branch: string; detached: boolean } {
  try {
    const branch = execSync(
      `git -C '${projectPath}' rev-parse --abbrev-ref HEAD`,
      { timeout: 10_000, encoding: "utf-8" },
    ).trim();

    if (branch !== "HEAD") {
      return { branch, detached: false };
    }

    return { branch: "HEAD", detached: true };
  } catch {
    return { branch: "main", detached: false };
  }
}

export function listBranches(projectPath: string): string[] {
  try {
    const output = execSync(
      `git -C '${projectPath}' branch --list --format='%(refname:short)'`,
      { timeout: 10_000, encoding: "utf-8" },
    );
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return ["main"];
  }
}

const PROQ_STASH_MSG = "proq-auto-stash";
const PREVIEW_SUFFIX = "/preview";

/** Convert a proq/* branch name to its preview equivalent */
export function previewBranchName(proqBranch: string): string {
  // proq/abc12345 → proq/abc12345/preview
  return proqBranch + PREVIEW_SUFFIX;
}

/** Check if a branch is a preview branch */
export function isPreviewBranch(branch: string): boolean {
  return branch.startsWith("proq/") && branch.endsWith(PREVIEW_SUFFIX);
}

/** Get the source proq/* branch for a preview branch */
export function sourceProqBranch(previewBranch: string): string {
  // proq/abc12345/preview → proq/abc12345
  return previewBranch.slice(0, -PREVIEW_SUFFIX.length);
}

export function checkoutBranch(
  projectPath: string,
  branch: string,
): void {
  const current = getCurrentBranch(projectPath);

  // Check if working tree is dirty and stash if needed
  const status = execSync(
    `git -C '${projectPath}' status --porcelain`,
    { timeout: 10_000, encoding: "utf-8" },
  ).trim();

  const needsStash = status.length > 0;
  if (needsStash) {
    execSync(
      `git -C '${projectPath}' stash push -m '${PROQ_STASH_MSG}'`,
      { timeout: 15_000 },
    );
    console.log("[git] auto-stashed dirty working tree");
  }

  // If we're leaving a preview branch, clean it up after checkout
  const oldPreviewBranch = (isPreviewBranch(current.branch) && branch !== current.branch)
    ? current.branch
    : null;

  try {
    if (branch.startsWith("proq/") && !isPreviewBranch(branch)) {
      // Create a preview branch pointing at the proq/* branch tip
      const preview = previewBranchName(branch);
      const commitHash = execSync(
        `git -C '${projectPath}' rev-parse '${branch}'`,
        { timeout: 10_000, encoding: "utf-8" },
      ).trim();

      // Delete existing preview branch if any (force, it's disposable)
      try {
        execSync(`git -C '${projectPath}' branch -D '${preview}'`, { timeout: 10_000 });
      } catch { /* may not exist */ }

      // Create and checkout the preview branch
      execSync(
        `git -C '${projectPath}' checkout -b '${preview}' '${commitHash}'`,
        { timeout: 15_000 },
      );
      console.log(`[git] checked out ${preview} (tracking ${branch})`);
    } else {
      execSync(
        `git -C '${projectPath}' checkout '${branch}'`,
        { timeout: 15_000 },
      );
      console.log(`[git] checked out ${branch}`);
    }
  } catch (err) {
    // On failure, try to pop stash if we pushed one
    if (needsStash) {
      try {
        execSync(`git -C '${projectPath}' stash pop`, { timeout: 10_000 });
      } catch { /* stash pop may fail */ }
    }
    throw err;
  }

  // Clean up old preview branch now that we've moved away
  if (oldPreviewBranch) {
    try {
      execSync(`git -C '${projectPath}' branch -D '${oldPreviewBranch}'`, { timeout: 10_000 });
      console.log(`[git] deleted old preview branch ${oldPreviewBranch}`);
    } catch { /* best effort */ }
  }

  // Pop auto-stash if we pushed one and we're now on a non-preview branch
  if (needsStash && !branch.startsWith("proq/")) {
    try {
      const stashMsg = execSync(
        `git -C '${projectPath}' stash list -1 --format=%s`,
        { timeout: 10_000, encoding: "utf-8" },
      ).trim();
      if (stashMsg.includes(PROQ_STASH_MSG)) {
        execSync(`git -C '${projectPath}' stash pop`, { timeout: 10_000 });
        console.log("[git] popped auto-stash");
      }
    } catch {
      console.error("[git] failed to pop auto-stash");
    }
  }
}

/**
 * Refresh a preview branch to pick up new commits from the source proq/* branch.
 * Returns true if files changed (new commits picked up).
 */
export function refreshPreviewBranch(
  projectPath: string,
  previewBranch: string,
): boolean {
  if (!isPreviewBranch(previewBranch)) return false;

  const source = sourceProqBranch(previewBranch);
  try {
    const headHash = execSync(
      `git -C '${projectPath}' rev-parse HEAD`,
      { timeout: 10_000, encoding: "utf-8" },
    ).trim();

    const sourceHash = execSync(
      `git -C '${projectPath}' rev-parse '${source}'`,
      { timeout: 10_000, encoding: "utf-8" },
    ).trim();

    if (headHash === sourceHash) return false;

    // Fast-forward the preview branch to the source branch tip
    execSync(
      `git -C '${projectPath}' merge --ff-only '${source}'`,
      { timeout: 15_000 },
    );
    console.log(`[git] refreshed ${previewBranch} to ${source} tip`);
    return true;
  } catch {
    return false;
  }
}

/** Delete a preview branch (cleanup helper) */
export function deletePreviewBranch(
  projectPath: string,
  proqBranch: string,
): void {
  const preview = previewBranchName(proqBranch);
  try {
    execSync(`git -C '${projectPath}' branch -D '${preview}'`, { timeout: 10_000 });
    console.log(`[git] deleted preview branch ${preview}`);
  } catch { /* may not exist */ }
}

export function ensureGitignore(projectPath: string): void {
  const gitignorePath = join(projectPath, ".gitignore");
  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf-8");
      if (content.includes(WORKTREE_DIR)) return;
      appendFileSync(gitignorePath, `\n${WORKTREE_DIR}\n`, "utf-8");
    } else {
      appendFileSync(gitignorePath, `${WORKTREE_DIR}\n`, "utf-8");
    }
    console.log(`[worktree] added ${WORKTREE_DIR} to .gitignore`);
  } catch (err) {
    console.error(`[worktree] failed to update .gitignore:`, err);
  }
}
