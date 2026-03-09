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
  baseBranch?: string,
): string {
  ensureGitignore(projectPath);
  const worktreePath = join(projectPath, WORKTREE_DIR, shortId);
  const branch = `proq/${shortId}`;
  const startPoint = baseBranch ? ` '${baseBranch}'` : '';
  execSync(
    `git -C '${projectPath}' worktree add '${WORKTREE_DIR}/${shortId}' -b '${branch}'${startPoint}`,
    { timeout: 30_000 },
  );
  console.log(`[worktree] created ${worktreePath} on branch ${branch}${baseBranch ? ` (based on ${baseBranch})` : ''}`);
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

const PROQ_STASH_PREFIX = "proq-auto-stash:";
const PROQ_PREFIX = "proq/";
const PREVIEW_PREFIX = "proq-preview/";

/** Build a stash message tagged with the source branch */
function stashMessage(branch: string): string {
  return `${PROQ_STASH_PREFIX}${branch}`;
}

/**
 * Find the stash index for a proq-auto-stash tagged with a specific branch.
 * Returns the stash index (e.g. 0 for stash@{0}) or -1 if not found.
 */
function findAutoStash(projectPath: string, branch: string): number {
  try {
    const list = execSync(
      `git -C '${projectPath}' stash list --format=%s`,
      { timeout: 10_000, encoding: "utf-8" },
    ).trim();
    if (!list) return -1;
    const target = stashMessage(branch);
    const entries = list.split("\n");
    for (let i = 0; i < entries.length; i++) {
      if (entries[i] === target || entries[i].endsWith(`: ${target}`)) return i;
    }
  } catch { /* no stash list */ }
  return -1;
}

/**
 * Pop or drop a stash at a specific index.
 * Uses `stash pop` for index 0, `stash pop stash@{n}` for others.
 * Returns true if successful.
 */
function popStashAt(projectPath: string, index: number): boolean {
  const ref = `stash@{${index}}`;
  try {
    execSync(`git -C '${projectPath}' stash pop '${ref}'`, { timeout: 10_000 });
    return true;
  } catch {
    // Pop failed (conflicts) — reset conflicted working tree but keep stash for manual recovery.
    try {
      execSync(`git -C '${projectPath}' checkout -- .`, { timeout: 10_000 });
    } catch { /* best effort */ }
    console.error(`[git] auto-stash ${ref} could not be applied (conflicts) — stash kept for manual recovery`);
    return false;
  }
}

/** Convert a proq/* branch name to its preview equivalent */
function previewBranchName(proqBranch: string): string {
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

  // Check if working tree is dirty and stash if needed.
  // Always stash dirty changes, tagged with the current branch name, so we can
  // pop the correct stash later even if multiple stashes accumulate.
  const status = execSync(
    `git -C '${projectPath}' status --porcelain`,
    { timeout: 10_000, encoding: "utf-8" },
  ).trim();

  const needsStash = status.length > 0;
  if (needsStash) {
    const msg = stashMessage(current.branch);
    execSync(
      `git -C '${projectPath}' stash push -u -m '${msg}'`,
      { timeout: 15_000 },
    );
    console.log(`[git] auto-stashed dirty working tree (from ${current.branch})`);
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
    // On failure, pop our stash back if we're still on the original branch
    if (needsStash) {
      const now = getCurrentBranch(projectPath);
      if (now.branch === current.branch) {
        const idx = findAutoStash(projectPath, current.branch);
        if (idx >= 0) popStashAt(projectPath, idx);
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

  // Pop the auto-stash for the TARGET branch when arriving on a non-proq branch (e.g., main).
  // This restores changes that were stashed when the user previously left this branch.
  // Skip when caller will do merge/cleanup before the pop is safe (e.g., ensureNotOnTaskBranch).
  if (!branch.startsWith("proq/") && !options?.skipStashPop) {
    const idx = findAutoStash(projectPath, branch);
    if (idx >= 0) {
      if (popStashAt(projectPath, idx)) {
        console.log(`[git] popped auto-stash for ${branch}`);
      } else {
        console.error(`[git] auto-stash for ${branch} could not be applied (conflicts)`);
      }
    }
  }
}

/**
 * Pop the proq-auto-stash for a specific branch (defaults to "main").
 * Call after merge/cleanup completes to restore the user's working changes.
 */
export function popAutoStash(projectPath: string, branch = "main"): void {
  const idx = findAutoStash(projectPath, branch);
  if (idx < 0) return;
  if (popStashAt(projectPath, idx)) {
    console.log(`[git] popped auto-stash for ${branch}`);
  } else {
    console.error(`[git] auto-stash for ${branch} could not be applied (conflicts)`);
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
function deletePreviewBranch(
  projectPath: string,
  proqBranch: string,
): void {
  const preview = previewBranchName(proqBranch);
  try {
    execSync(`git -C '${projectPath}' branch -D '${preview}'`, { timeout: 10_000 });
    console.log(`[git] deleted preview branch ${preview}`);
  } catch { /* may not exist */ }
}

/**
 * If the main project directory is currently on a task's branch (or its preview),
 * switch to main. Used before merge/remove operations so we don't operate on the
 * branch we're standing on.
 */
export function ensureNotOnTaskBranch(projectPath: string, taskBranch: string, defaultBranch = "main"): void {
  const cur = getCurrentBranch(projectPath);
  const isOnTask = cur.branch === taskBranch
    || (isPreviewBranch(cur.branch) && sourceProqBranch(cur.branch) === taskBranch);
  if (isOnTask) {
    checkoutBranch(projectPath, defaultBranch, { skipStashPop: true });
  }
  // Also clean up any leftover preview branch for this task
  deletePreviewBranch(projectPath, taskBranch);
}

/**
 * Ensure the main project directory is on `main` before merging a task branch.
 * Unlike ensureNotOnTaskBranch (which only moves off *this* task's branch),
 * this always checks out main if we're on any non-main branch. This prevents
 * merging into the wrong branch (e.g., another task's preview branch).
 */
export function ensureOnMainForMerge(projectPath: string, taskBranch: string, targetBranch = "main"): void {
  const cur = getCurrentBranch(projectPath);
  if (cur.branch !== targetBranch) {
    checkoutBranch(projectPath, targetBranch, { skipStashPop: true });
  }
  // Also clean up any leftover preview branch for this task
  deletePreviewBranch(projectPath, taskBranch);
}

// ── Git sync operations ──

/**
 * Auto-commit any uncommitted changes in a working directory.
 * Used as a safety net when agent sessions end without committing.
 * Returns true if a commit was made.
 */
export function autoCommitIfDirty(
  projectPath: string,
  taskTitle?: string,
): boolean {
  try {
    const status = execSync(
      `git -C '${projectPath}' status --porcelain`,
      { timeout: 10_000, encoding: "utf-8" },
    ).trim();
    if (!status) return false;

    const message = taskTitle
      ? `Commit leftover changes for: ${taskTitle}`
      : "Commit leftover changes";
    execSync(`git -C '${projectPath}' add -A`, { timeout: 10_000 });
    execSync(`git -C '${projectPath}' commit -m '${message.replace(/'/g, "'\\''")}'`, {
      timeout: 15_000,
    });
    console.log(`[git] auto-committed leftover changes in ${projectPath}`);
    return true;
  } catch {
    return false;
  }
}

/** Get sync status for a git repository (ahead/behind upstream, dirty file count) */
export function getGitSyncStatus(
  projectPath: string,
): { hasRemote: boolean; ahead: number; behind: number; dirty: number } {
  const result = { hasRemote: false, ahead: 0, behind: 0, dirty: 0 };

  try {
    const remotes = execSync(
      `git -C '${projectPath}' remote`,
      { timeout: 5_000, encoding: "utf-8" },
    ).trim();
    result.hasRemote = remotes.length > 0;
  } catch {
    return result;
  }

  // Dirty file count
  try {
    const status = execSync(
      `git -C '${projectPath}' status --porcelain`,
      { timeout: 10_000, encoding: "utf-8" },
    ).trim();
    if (status) {
      result.dirty = status.split("\n").filter(Boolean).length;
    }
  } catch { /* best effort */ }

  // Ahead/behind upstream
  if (result.hasRemote) {
    try {
      const output = execSync(
        `git -C '${projectPath}' rev-list --count --left-right '@{upstream}...HEAD'`,
        { timeout: 10_000, encoding: "utf-8" },
      ).trim();
      const [behind, ahead] = output.split(/\s+/).map(Number);
      result.ahead = ahead || 0;
      result.behind = behind || 0;
    } catch {
      // No tracking branch or no upstream — leave at 0
    }
  }

  return result;
}

/** List uncommitted files with their status codes */
export function gitStatusFiles(projectPath: string): { path: string; status: string }[] {
  try {
    const output = execSync(
      `git -C '${projectPath}' status --porcelain`,
      { timeout: 10_000, encoding: "utf-8" },
    ).trim();
    if (!output) return [];
    return output.split("\n").filter(Boolean).map((line) => {
      const status = line.slice(0, 2).trim();
      const path = line.slice(3);
      return { path, status };
    });
  } catch {
    return [];
  }
}

/** Parse git log output that uses %x1e as record separator with --shortstat */
function parseLogWithStats(
  output: string,
): { hash: string; message: string; author: string; date: string; insertions?: number; deletions?: number }[] {
  // Split on record separator (\x1e) to get per-commit blocks
  const blocks = output.split("\x1e").filter(Boolean);
  return blocks.map((block) => {
    const lines = block.trim().split("\n");
    const [hash, message, author, date] = lines[0].split("\x1f");
    let insertions: number | undefined;
    let deletions: number | undefined;
    // The shortstat line (if present) is the last non-empty line
    const statLine = lines.find((l) => l.includes("changed"));
    if (statLine) {
      const insMatch = statLine.match(/(\d+) insertion/);
      const delMatch = statLine.match(/(\d+) deletion/);
      if (insMatch) insertions = parseInt(insMatch[1], 10);
      if (delMatch) deletions = parseInt(delMatch[1], 10);
    }
    return { hash, message, author, date, insertions, deletions };
  });
}

/** Get short commit log for ahead or behind commits */
export function gitLogShort(
  projectPath: string,
  direction: "ahead" | "behind",
  count = 20,
): { hash: string; message: string; author: string; date: string; insertions?: number; deletions?: number }[] {
  try {
    const range = direction === "ahead" ? "@{upstream}..HEAD" : "HEAD..@{upstream}";
    const output = execSync(
      `git -C '${projectPath}' log ${range} --format='%x1e%h%x1f%s%x1f%an%x1f%ar' --shortstat -n ${count}`,
      { timeout: 15_000, encoding: "utf-8" },
    ).trim();
    if (!output) return [];
    return parseLogWithStats(output);
  } catch {
    return [];
  }
}

/** Get full diff of uncommitted changes */
export function gitDiffFull(projectPath: string): string {
  try {
    // Include both staged and unstaged changes
    const unstaged = execSync(
      `git -C '${projectPath}' diff`,
      { timeout: 15_000, encoding: "utf-8", maxBuffer: 1024 * 1024 },
    );
    const staged = execSync(
      `git -C '${projectPath}' diff --cached`,
      { timeout: 15_000, encoding: "utf-8", maxBuffer: 1024 * 1024 },
    );
    return [staged, unstaged].filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

/** Stage all changes and commit with the given message */
export function gitCommit(projectPath: string, message: string): void {
  execSync(`git -C '${projectPath}' add -A`, { timeout: 10_000 });
  execSync(
    `git -C '${projectPath}' commit -m ${JSON.stringify(message)}`,
    { timeout: 15_000 },
  );
}

/** Get full git log for ahead or behind commits */
export function gitLogFull(
  projectPath: string,
  direction: "ahead" | "behind",
  count = 50,
): string {
  try {
    const range = direction === "ahead" ? "@{upstream}..HEAD" : "HEAD..@{upstream}";
    return execSync(
      `git -C '${projectPath}' log ${range} --stat --format='commit %H%nAuthor: %an <%ae>%nDate:   %ar%n%n    %s%n' -n ${count}`,
      { timeout: 15_000, encoding: "utf-8", maxBuffer: 1024 * 1024 },
    );
  } catch {
    return "";
  }
}

/** Fetch from all remotes (best-effort, short timeout) */
export function gitFetch(projectPath: string): void {
  try {
    execSync(`git -C '${projectPath}' fetch --quiet --all`, {
      timeout: 30_000,
    });
    console.log(`[git] fetched from remotes for ${projectPath}`);
  } catch {
    // Best effort — network may be unavailable
  }
}

/** Push to upstream. Returns success/error. */
export function gitPush(
  projectPath: string,
): { success: boolean; error?: string } {
  // Block if working tree is dirty
  try {
    const status = execSync(
      `git -C '${projectPath}' status --porcelain`,
      { timeout: 10_000, encoding: "utf-8" },
    ).trim();
    if (status) {
      return { success: false, error: "Commit or stash your working changes first." };
    }
  } catch {
    return { success: false, error: "Failed to check working tree status." };
  }

  try {
    execSync(`git -C '${projectPath}' push`, {
      timeout: 30_000,
      encoding: "utf-8",
    });
    console.log(`[git] pushed to upstream from ${projectPath}`);
    return { success: true };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Push failed";
    // Extract the meaningful line from git's stderr (embedded in the Error message)
    const stderrMatch = raw.match(/stderr:\s*'([^']+)'/);
    const error = stderrMatch ? stderrMatch[1].trim() : raw;
    console.error(`[git] push failed:`, error);
    return { success: false, error };
  }
}

/** Pull from upstream with rebase. Returns success/error. */
export function gitPull(
  projectPath: string,
): { success: boolean; error?: string } {
  // Block if working tree is dirty
  try {
    const status = execSync(
      `git -C '${projectPath}' status --porcelain`,
      { timeout: 10_000, encoding: "utf-8" },
    ).trim();
    if (status) {
      return { success: false, error: "Commit or stash your working changes first." };
    }
  } catch {
    return { success: false, error: "Failed to check working tree status." };
  }

  try {
    execSync(`git -C '${projectPath}' pull --rebase`, {
      timeout: 30_000,
      encoding: "utf-8",
    });
    console.log(`[git] pulled from upstream into ${projectPath}`);
    return { success: true };
  } catch (err) {
    // Check if we're mid-rebase (conflict) and abort to restore pre-pull state
    try {
      const gitDir = execSync(
        `git -C '${projectPath}' rev-parse --git-dir`,
        { timeout: 5_000, encoding: "utf-8" },
      ).trim();
      const rebaseMergeDir = join(
        projectPath.endsWith(".git") ? projectPath : join(projectPath, gitDir),
        "rebase-merge",
      );
      if (existsSync(rebaseMergeDir)) {
        execSync(`git -C '${projectPath}' rebase --abort`, {
          timeout: 10_000,
        });
        console.log(`[git] aborted rebase due to conflict in ${projectPath}`);
        return {
          success: false,
          error: "Pull conflicts with your local commits — pull manually to resolve.",
        };
      }
    } catch {
      // best effort — if abort fails, fall through to generic error
    }
    const raw = err instanceof Error ? err.message : "Pull failed";
    const stderrMatch = raw.match(/stderr:\s*'([^']+)'/);
    const error = stderrMatch ? stderrMatch[1].trim() : raw;
    console.error(`[git] pull failed:`, error);
    return { success: false, error };
  }
}

/** Get paginated commit log from HEAD (not upstream-relative) */
export function gitLogPaginated(
  projectPath: string,
  skip = 0,
  limit = 10,
): { hash: string; message: string; author: string; date: string; insertions?: number; deletions?: number }[] {
  try {
    const output = execSync(
      `git -C '${projectPath}' log --format='%x1e%h%x1f%s%x1f%an%x1f%ar' --shortstat --skip=${skip} -n ${limit}`,
      { timeout: 15_000, encoding: "utf-8" },
    ).trim();
    if (!output) return [];
    return parseLogWithStats(output);
  } catch {
    return [];
  }
}

/** Get the full diff for a single commit */
export function gitShowCommit(projectPath: string, hash: string): string {
  // Sanitize: allow only hex characters (short or full SHA)
  if (!/^[0-9a-fA-F]+$/.test(hash)) {
    throw new Error("Invalid commit hash");
  }
  try {
    return execSync(
      `git -C '${projectPath}' show '${hash}'`,
      { timeout: 15_000, encoding: "utf-8", maxBuffer: 2 * 1024 * 1024 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "git show failed";
    throw new Error(message);
  }
}

/** Initialize a git repo with an initial commit */
export function gitInit(projectPath: string): void {
  execSync(`git -C '${projectPath}' init`, { timeout: 10_000 });
  execSync(`git -C '${projectPath}' add -A`, { timeout: 15_000 });
  try {
    execSync(`git -C '${projectPath}' commit -m 'Initial commit'`, {
      timeout: 15_000,
    });
  } catch {
    // May fail if directory is empty — that's fine
  }
  console.log(`[git] initialized repo in ${projectPath}`);
}

function ensureGitignore(projectPath: string): void {
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
