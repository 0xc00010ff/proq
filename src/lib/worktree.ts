import { execSync } from "child_process";
import { existsSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";

const WORKTREE_DIR = ".proq-worktrees";

/** Check if a path is inside a git repository */
export function isGitRepo(projectPath: string): boolean {
  try {
    execSync(`git -C '${projectPath}' rev-parse --git-dir`, {
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

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
): { success: boolean; error?: string; conflictFiles?: string[]; diff?: string } {
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
    let diff = "";
    try {
      const output = execSync(
        `git -C '${projectPath}' diff --name-only --diff-filter=U`,
        { timeout: 10_000, encoding: "utf-8" },
      );
      conflictFiles = output.trim().split("\n").filter(Boolean);
    } catch {
      // May fail if merge didn't leave conflicts
    }

    // Capture the conflict diff (with markers) for each conflicting file
    if (conflictFiles.length > 0) {
      try {
        diff = execSync(
          `git -C '${projectPath}' diff --diff-filter=U`,
          { timeout: 15_000, encoding: "utf-8", maxBuffer: 1024 * 1024 },
        );
      } catch {
        // Best effort — fall back to empty
      }
    }

    // If we didn't get file-level conflicts, try to get a summary diff between branches
    if (conflictFiles.length === 0 && !diff) {
      try {
        diff = execSync(
          `git -C '${projectPath}' diff HEAD...'${branch}' --stat`,
          { timeout: 10_000, encoding: "utf-8" },
        );
      } catch {
        // Best effort
      }
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
      diff,
    };
  }
}

/**
 * Merge main into the task's worktree branch so the agent can resolve conflicts there.
 * Unlike mergeWorktree (which merges task→main), this merges main→task.
 * We leave conflict markers in the worktree for the agent to resolve.
 */
export function mergeMainIntoWorktree(
  projectPath: string,
  shortId: string,
): { success: boolean; error?: string } {
  const worktreePath = join(projectPath, WORKTREE_DIR, shortId);
  try {
    // Merge main into the worktree branch — allow conflicts to remain
    execSync(
      `git -C '${worktreePath}' merge origin/main --no-ff -m 'Merge main into proq/${shortId} for conflict resolution' || git -C '${worktreePath}' merge main --no-ff -m 'Merge main into proq/${shortId} for conflict resolution'`,
      { timeout: 30_000, shell: "/bin/bash" },
    );
    console.log(`[worktree] merged main into proq/${shortId}`);
    return { success: true };
  } catch {
    // Merge left conflict markers — that's fine, the agent will resolve them
    // Check if there are actually unmerged files
    try {
      const output = execSync(
        `git -C '${worktreePath}' diff --name-only --diff-filter=U`,
        { timeout: 10_000, encoding: "utf-8" },
      );
      const conflictFiles = output.trim().split("\n").filter(Boolean);
      if (conflictFiles.length > 0) {
        console.log(`[worktree] merge left ${conflictFiles.length} conflicted files for agent to resolve`);
        return { success: true }; // Conflicts are intentional — agent will resolve
      }
    } catch {
      // No conflicts found despite merge failure
    }
    return { success: false, error: "Failed to merge main into worktree" };
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
const PROQ_PREFIX = "proq/";
const PREVIEW_PREFIX = "proq-preview/";

/** Convert a proq/* branch name to its preview equivalent */
export function previewBranchName(proqBranch: string): string {
  // proq/abc12345 → proq-preview/abc12345
  return PREVIEW_PREFIX + proqBranch.slice(PROQ_PREFIX.length);
}

/** Check if a branch is a preview branch */
export function isPreviewBranch(branch: string): boolean {
  return branch.startsWith(PREVIEW_PREFIX);
}

/** Get the source proq/* branch for a preview branch */
export function sourceProqBranch(previewBranch: string): string {
  // proq-preview/abc12345 → proq/abc12345
  return PROQ_PREFIX + previewBranch.slice(PREVIEW_PREFIX.length);
}

export function checkoutBranch(
  projectPath: string,
  branch: string,
  options?: { skipStashPop?: boolean },
): void {
  const current = getCurrentBranch(projectPath);

  // Check if working tree is dirty and stash if needed
  // Only stash if there isn't already a proq-auto-stash on top (avoid stacking duplicates)
  const status = execSync(
    `git -C '${projectPath}' status --porcelain`,
    { timeout: 10_000, encoding: "utf-8" },
  ).trim();

  let needsStash = status.length > 0;
  if (needsStash) {
    try {
      const topStash = execSync(
        `git -C '${projectPath}' stash list -1 --format=%s`,
        { timeout: 10_000, encoding: "utf-8" },
      ).trim();
      if (topStash.includes(PROQ_STASH_MSG)) {
        // Already have an auto-stash on top — don't stack another
        needsStash = false;
        console.log("[git] skipping stash — proq-auto-stash already on top");
      }
    } catch { /* no stash list — proceed with stash */ }
  }
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
    // On failure, try to pop stash only if we're still on the original branch
    if (needsStash) {
      const now = getCurrentBranch(projectPath);
      if (now.branch === current.branch) {
        try {
          execSync(`git -C '${projectPath}' stash pop`, { timeout: 10_000 });
        } catch { /* stash pop may fail */ }
      }
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

  // Pop auto-stash when arriving on a non-proq branch (e.g., main).
  // Check unconditionally — the stash may have been pushed in a previous checkoutBranch call.
  // Skip when caller will do merge/cleanup before the pop is safe (e.g., ensureNotOnTaskBranch).
  if (!branch.startsWith("proq/") && !options?.skipStashPop) {
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

/** Pop the top proq-auto-stash if one exists. Call after merge/cleanup completes. */
export function popAutoStash(projectPath: string): void {
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
