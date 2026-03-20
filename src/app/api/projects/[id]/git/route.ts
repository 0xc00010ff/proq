import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { safeParseBody } from "@/lib/api-utils";
import {
  getCurrentBranch,
  listBranches,
  checkoutBranch,
  refreshPreviewBranch,
  isPreviewBranch,
  sourceProqBranch,
  isGitRepo,
  getGitSyncStatus,
  detectDefaultBranch,
  gitFetch,
  gitPush,
  gitPull,
  gitInit,
  gitStatusFiles,
  gitLogShort,
  gitDiffFull,
  gitLogFull,
  gitShowCommit,
  gitLogPaginated,
  gitCommitsByHash,
} from "@/lib/worktree";
import { getTask } from "@/lib/db";
import { resolveProjectPath } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

/** GET — current branch + all local branches + sync status */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const projectPath = resolveProjectPath(project.path);

  if (!isGitRepo(projectPath)) {
    return NextResponse.json({
      current: null,
      detached: false,
      branches: [],
      hasGit: false,
      hasRemote: false,
      ahead: 0,
      behind: 0,
      dirty: 0,
    });
  }

  const current = getCurrentBranch(projectPath);
  const allBranches = listBranches(projectPath);
  const syncStatus = getGitSyncStatus(projectPath);

  // Filter out proq/*/preview branches — they're internal implementation detail
  const branches = allBranches.filter((b) => !isPreviewBranch(b));

  // If we're on a preview branch, report the source proq/* branch as current
  let currentName = current.branch;
  if (isPreviewBranch(current.branch)) {
    currentName = sourceProqBranch(current.branch);
  }

  return NextResponse.json({
    current: currentName,
    detached: current.detached,
    branches,
    defaultBranch: detectDefaultBranch(projectPath) || undefined,
    hasGit: true,
    ...syncStatus,
  });
}

/** POST — switch branch or perform git actions (push/pull/fetch/init) */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;
  const projectPath = resolveProjectPath(project.path);

  // Action-based dispatch
  if (body.action) {
    if (body.action === "init") {
      if (isGitRepo(projectPath)) {
        return NextResponse.json({ error: "Already a git repository" }, { status: 400 });
      }
      try {
        gitInit(projectPath);
        const syncStatus = getGitSyncStatus(projectPath);
        return NextResponse.json({ hasGit: true, ...syncStatus });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Init failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    if (!isGitRepo(projectPath)) {
      return NextResponse.json({ error: "Project is not a git repository" }, { status: 400 });
    }

    if (body.action === "status") {
      const files = gitStatusFiles(projectPath);
      return NextResponse.json({ files });
    }

    if (body.action === "log") {
      const direction = body.direction === "behind" ? "behind" : "ahead";
      const commits = gitLogShort(projectPath, direction);
      return NextResponse.json({ commits });
    }

    if (body.action === "diff") {
      const diff = gitDiffFull(projectPath);
      return NextResponse.json({ diff });
    }

    if (body.action === "log-full") {
      const direction = body.direction === "behind" ? "behind" : "ahead";
      const log = gitLogFull(projectPath, direction);
      return NextResponse.json({ log });
    }

    if (body.action === "log-paginated") {
      const skip = Math.max(0, Number(body.skip) || 0);
      const limit = Math.min(100, Math.max(1, Number(body.limit) || 10));
      const commits = gitLogPaginated(projectPath, skip, limit);
      return NextResponse.json({ commits });
    }

    if (body.action === "show-commit") {
      const hash = body.hash;
      if (!hash || typeof hash !== "string") {
        return NextResponse.json({ error: "hash is required" }, { status: 400 });
      }
      try {
        const diff = gitShowCommit(projectPath, hash);
        return NextResponse.json({ diff });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to show commit";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    if (body.action === "fetch") {
      gitFetch(projectPath);
      const syncStatus = getGitSyncStatus(projectPath);
      return NextResponse.json(syncStatus);
    }

    if (body.action === "push") {
      const result = gitPush(projectPath);
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      const syncStatus = getGitSyncStatus(projectPath);
      return NextResponse.json(syncStatus);
    }

    if (body.action === "pull") {
      const result = gitPull(projectPath);
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      const syncStatus = getGitSyncStatus(projectPath);
      return NextResponse.json(syncStatus);
    }

    if (body.action === "commit") {
      const { title, description } = body;
      if (!title || typeof title !== "string") {
        return NextResponse.json({ error: "title is required" }, { status: 400 });
      }
      try {
        const { gitCommit } = await import("@/lib/worktree");
        const message = description
          ? `${title.trim()}\n\n${description.trim()}`
          : title.trim();
        gitCommit(projectPath, message);
        const syncStatus = getGitSyncStatus(projectPath);
        return NextResponse.json({ success: true, ...syncStatus });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Commit failed";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    if (body.action === "generate-commit-message") {
      try {
        const diff = gitDiffFull(projectPath);
        if (!diff || !diff.trim()) {
          return NextResponse.json({ title: "", description: "" });
        }
        const { claudeOneShot } = await import("@/lib/claude-cli");
        const prompt = `You are a commit message generator. Given the following git diff, produce a concise commit message.

Respond with ONLY a JSON object with two fields:
- "title": A single-line commit title (max 72 chars, imperative mood, no period at end)
- "description": A brief description of what changed (1-3 sentences, or empty string if the title is sufficient)

Do not include markdown formatting, code fences, or anything else. Just the JSON object.

Git diff:
${diff.slice(0, 12000)}`;
        const raw = await claudeOneShot(prompt);
        // Parse the JSON response, handling potential markdown wrapping
        let cleaned = raw.trim();
        if (cleaned.startsWith("```")) {
          cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
        }
        const parsed = JSON.parse(cleaned);
        return NextResponse.json({
          title: parsed.title || "",
          description: parsed.description || "",
        });
      } catch (err) {
        console.error("[git] generate-commit-message failed:", err);
        return NextResponse.json({ title: "", description: "", error: "Generation failed" });
      }
    }

    if (body.action === "create-branch") {
      const name = body.name;
      if (!name || typeof name !== "string") {
        return NextResponse.json({ error: "name is required" }, { status: 400 });
      }
      // Validate branch name
      if (/\s/.test(name) || /\.\./.test(name) || /[~^:\\?*\[]/.test(name) || name.startsWith("-") || name.endsWith(".lock") || name.endsWith("/")) {
        return NextResponse.json({ error: "Invalid branch name" }, { status: 400 });
      }
      try {
        const { execSync } = await import("child_process");
        execSync(`git -C '${projectPath}' checkout -b '${name}'`, { timeout: 15_000 });
        const result = getCurrentBranch(projectPath);
        return NextResponse.json({ current: result.branch, detached: result.detached });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create branch";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    if (body.action === "task-commits") {
      const taskId = body.taskId;
      if (!taskId || typeof taskId !== "string") {
        return NextResponse.json({ error: "taskId is required" }, { status: 400 });
      }
      const task = await getTask(id, taskId);
      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      const commits = task.commitHashes?.length
        ? gitCommitsByHash(projectPath, task.commitHashes)
        : [];
      return NextResponse.json({ commits });
    }

    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }

  // Branch switch (existing behavior)
  const { branch } = body;
  if (!branch || typeof branch !== "string") {
    return NextResponse.json(
      { error: "branch or action is required" },
      { status: 400 },
    );
  }

  if (!isGitRepo(projectPath)) {
    return NextResponse.json(
      { error: "Project is not a git repository" },
      { status: 400 },
    );
  }

  try {
    checkoutBranch(projectPath, branch);
    const result = getCurrentBranch(projectPath);

    // Report proq/* name, not proq/*/preview name
    let currentName = result.branch;
    if (isPreviewBranch(result.branch)) {
      currentName = sourceProqBranch(result.branch);
    }

    return NextResponse.json({
      current: currentName,
      detached: result.detached,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH — refresh preview branch to pick up new agent commits */
export async function PATCH(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const projectPath = resolveProjectPath(project.path);

  if (!isGitRepo(projectPath)) {
    return NextResponse.json(
      { error: "Project is not a git repository" },
      { status: 400 },
    );
  }

  const current = getCurrentBranch(projectPath);

  if (!isPreviewBranch(current.branch)) {
    return NextResponse.json({
      current: current.branch,
      detached: current.detached,
      updated: false,
    });
  }

  const updated = refreshPreviewBranch(projectPath, current.branch);

  return NextResponse.json({
    current: sourceProqBranch(current.branch),
    detached: false,
    updated,
  });
}
