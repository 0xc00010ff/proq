import { execSync } from "child_process";
import { NextResponse } from "next/server";
import { getTask, getProject, updateTask, getProjectDefaultBranch } from "@/lib/db";

type Params = { params: Promise<{ id: string; taskId: string }> };

/**
 * POST /api/projects/[id]/tasks/[taskId]/resolve
 *
 * Prepares the worktree for conflict resolution by cleaning up any stale
 * merge state. Returns a prompt telling the agent to run `git merge`
 * themselves so they can see and resolve real conflicts.
 *
 * Does NOT dispatch a new agent — the user sends the follow-up message
 * themselves via the existing StructuredPane session.
 */
export async function POST(_request: Request, { params }: Params) {
  const { id, taskId } = await params;
  const task = await getTask(id, taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!task.mergeConflict) {
    return NextResponse.json({ error: "Task has no merge conflict" }, { status: 400 });
  }

  if (!task.worktreePath || !task.branch) {
    return NextResponse.json({ error: "Task has no worktree to resolve conflicts in" }, { status: 400 });
  }

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const baseBranch = task.baseBranch || await getProjectDefaultBranch(id);

  // Clean up any stale merge state in the worktree
  try {
    execSync(`git -C '${task.worktreePath}' merge --abort`, { timeout: 10_000 });
  } catch { /* no merge in progress — fine */ }

  // Build prompt telling agent to do the merge themselves
  const conflictFiles = task.mergeConflict.files;
  const diff = task.mergeConflict.diff;

  let prompt = `There was a merge conflict when trying to merge this branch into \`${baseBranch}\`. `;
  prompt += `Please run \`git merge ${baseBranch}\` to merge ${baseBranch} into this branch, then resolve the conflicts.\n\n`;

  if (conflictFiles.length > 0) {
    prompt += `Expected conflicting files:\n${conflictFiles.map(f => `- ${f}`).join("\n")}\n\n`;
  }

  if (diff) {
    prompt += `Here's the conflict diff for context:\n\`\`\`\n${diff.slice(0, 3000)}${diff.length > 3000 ? '\n... (truncated)' : ''}\n\`\`\`\n\n`;
  }

  prompt += `After resolving all conflicts, stage the files, complete the merge commit, and make sure the code builds correctly.`;

  // Clear the merge conflict from the task — agent will handle it
  // Move task back to in-progress so the agent session is active
  await updateTask(id, taskId, {
    status: "in-progress",
    mergeConflict: undefined,
  });

  return NextResponse.json({ success: true, prompt });
}
