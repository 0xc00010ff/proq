import { NextResponse } from "next/server";
import { getTask, getProject, updateTask } from "@/lib/db";
import { mergeMainIntoWorktree } from "@/lib/worktree";

type Params = { params: Promise<{ id: string; taskId: string }> };

/**
 * POST /api/projects/[id]/tasks/[taskId]/resolve
 *
 * Prepares the worktree for conflict resolution by merging main into the
 * task branch (leaving conflict markers). Returns a suggested prompt that
 * the frontend pre-populates into the chat input for the user to send.
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

  const projectPath = project.path.replace(/^~/, process.env.HOME || "~");
  const shortId = taskId.slice(0, 8);

  // Merge main into the worktree so conflict markers appear in the working tree
  const mergeResult = mergeMainIntoWorktree(projectPath, shortId);
  if (!mergeResult.success) {
    return NextResponse.json({ error: mergeResult.error || "Failed to merge main into worktree" }, { status: 500 });
  }

  // Build a conflict resolution prompt for the chat input
  const conflictFiles = task.mergeConflict.files;

  let prompt = `Resolve the merge conflicts. Main has been merged into this branch and conflict markers are in the working tree.\n\n`;

  if (conflictFiles.length > 0) {
    prompt += `Conflicting files:\n${conflictFiles.map(f => `- ${f}`).join("\n")}\n\n`;
  }

  prompt += `Check \`git status\`, resolve all conflict markers, stage the files, and complete the merge commit. Make sure the code builds correctly after resolution.`;

  // Clear the merge conflict from the task — it's now in the worktree for the agent to resolve
  // Move task back to in-progress so the agent session is active
  await updateTask(id, taskId, {
    status: "in-progress",
    mergeConflict: undefined,
  });

  return NextResponse.json({ success: true, prompt });
}
