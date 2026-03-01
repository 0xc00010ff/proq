import { NextResponse } from "next/server";
import { getTask, getProject, updateTask, getSettings } from "@/lib/db";
import { dispatchTask, cancelCleanup } from "@/lib/agent-dispatch";
import { mergeMainIntoWorktree } from "@/lib/worktree";
import { clearSession } from "@/lib/agent-session";

type Params = { params: Promise<{ id: string; taskId: string }> };

/**
 * POST /api/projects/[id]/tasks/[taskId]/resolve
 *
 * Re-dispatches a task with merge conflict resolution instructions.
 * Unlike the old "re-dispatch" flow (todo → in-progress), this:
 * - Keeps the task in-progress with its existing worktree/branch
 * - Merges main into the worktree branch so the agent sees conflict markers
 * - Dispatches a new agent with instructions to resolve conflicts
 * - Preserves all previous findings and history
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

  // Merge main into the worktree so the agent can resolve conflicts
  const mergeResult = mergeMainIntoWorktree(projectPath, shortId);
  if (!mergeResult.success) {
    return NextResponse.json({ error: mergeResult.error || "Failed to merge main into worktree" }, { status: 500 });
  }

  // Build a conflict resolution prompt with details
  const conflictFiles = task.mergeConflict.files;
  const diff = task.mergeConflict.diff;

  let resolvePrompt = `# Resolve merge conflicts\n\n`;
  resolvePrompt += `The branch \`${task.branch}\` has conflicts with \`main\`. Main has been merged into this branch and conflict markers are present in the working tree.\n\n`;

  if (conflictFiles.length > 0) {
    resolvePrompt += `## Conflicting files\n${conflictFiles.map(f => `- ${f}`).join("\n")}\n\n`;
  }

  if (diff) {
    resolvePrompt += `## Diff details\n\`\`\`\n${diff.slice(0, 8000)}\n\`\`\`\n\n`;
  }

  resolvePrompt += `## Instructions\n`;
  resolvePrompt += `1. Check \`git status\` to see the current state of the merge\n`;
  resolvePrompt += `2. For each conflicting file, resolve the conflict markers (\`<<<<<<<\`, \`=======\`, \`>>>>>>>\`) by keeping the correct code\n`;
  resolvePrompt += `3. Stage the resolved files with \`git add\`\n`;
  resolvePrompt += `4. Complete the merge commit with \`git commit --no-edit\` (the merge message is already set)\n`;
  resolvePrompt += `5. Make sure the code builds/compiles correctly after resolution\n`;
  resolvePrompt += `6. Report your findings when done\n`;

  // Clear the old agent session, cancel any cleanup timer
  clearSession(taskId);
  cancelCleanup(taskId);

  // Move task to in-progress and dispatch — preserve findings/history
  const settings = await getSettings();
  const renderMode = task.renderMode || settings.agentRenderMode || "structured";
  await updateTask(id, taskId, {
    status: "in-progress",
    dispatch: "starting",
    mergeConflict: undefined,
    renderMode,
    agentBlocks: undefined,
    sessionId: undefined,
  });

  // Dispatch agent on the existing worktree with conflict resolution prompt
  const terminalTabId = await dispatchTask(
    id,
    taskId,
    `Resolve conflicts: ${task.title || ""}`.trim(),
    resolvePrompt,
    task.mode,
    undefined,
    renderMode,
  );

  if (terminalTabId) {
    await updateTask(id, taskId, { dispatch: "running" });
  } else {
    await updateTask(id, taskId, { dispatch: "queued" });
  }

  return NextResponse.json({ success: true });
}
