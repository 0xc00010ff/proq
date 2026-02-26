import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import {
  getCurrentBranch,
  listBranches,
  checkoutBranch,
  refreshPreviewBranch,
  isPreviewBranch,
  sourceProqBranch,
  isGitRepo,
} from "@/lib/worktree";

type Params = { params: Promise<{ id: string }> };

function resolveProjectPath(path: string): string {
  return path.replace(/^~/, process.env.HOME || "~");
}

/** GET — current branch + all local branches */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const projectPath = resolveProjectPath(project.path);

  if (!isGitRepo(projectPath)) {
    return NextResponse.json({ current: null, detached: false, branches: [] });
  }

  const current = getCurrentBranch(projectPath);
  const allBranches = listBranches(projectPath);

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
  });
}

/** POST — switch branch */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { branch } = await request.json();
  if (!branch || typeof branch !== "string") {
    return NextResponse.json(
      { error: "branch is required" },
      { status: 400 },
    );
  }

  const projectPath = resolveProjectPath(project.path);

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
