import { NextResponse } from "next/server";
import { moveTask, getProject, getTask, updateTask, getSettings, getProjectDefaultBranch, deleteTaskAgentBlocks } from "@/lib/db";
import { abortTask, processQueue, getInitialAgentStatus, scheduleCleanup, cancelCleanup } from "@/lib/agent-dispatch";
import { mergeWorktree, removeWorktree, ensureNotOnTaskBranch, ensureOnMainForMerge, popAutoStash } from "@/lib/worktree";
import type { TaskStatus } from "@/lib/types";
import { safeParseBody } from "@/lib/api-utils";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;
  const { taskId, toColumn, toIndex } = body as {
    taskId: string;
    toColumn: TaskStatus;
    toIndex: number;
  };

  if (!taskId || !toColumn || toIndex == null) {
    return NextResponse.json(
      { error: "taskId, toColumn, and toIndex are required" },
      { status: 400 }
    );
  }

  // Snapshot previous status before move
  const prevTask = await getTask(id, taskId);
  const prevStatus = prevTask?.status;

  const moved = await moveTask(id, taskId, toColumn, toIndex);
  if (!moved) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Handle status transitions
  if (prevStatus && prevStatus !== toColumn) {
    if (toColumn === "in-progress" && prevStatus !== "in-progress") {
      cancelCleanup(taskId);
      if (prevStatus !== "verify" && prevStatus !== "done") {
        const settings = await getSettings();
        const agentStatus = await getInitialAgentStatus(id, taskId);
        const renderMode = prevTask?.renderMode || settings.agentRenderMode || 'structured';
        await updateTask(id, taskId, { agentStatus, renderMode });
      }
    } else if (toColumn === "todo" && prevStatus !== "todo") {
      cancelCleanup(taskId);
      // Remove worktree if task had one (no merge — work is discarded)
      if (prevTask?.worktreePath || prevTask?.branch) {
        const projectPath = project!.path.replace(/^~/, process.env.HOME || "~");
        const defaultBr = await getProjectDefaultBranch(id);
        try {
          ensureNotOnTaskBranch(projectPath, prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`, defaultBr);
        } catch { /* best effort */ }
        removeWorktree(projectPath, prevTask.id.slice(0, 8));
        popAutoStash(projectPath, prevTask.baseBranch || defaultBr);
      }
      await updateTask(id, taskId, { agentStatus: null, summary: "", nextSteps: "", agentLog: "", worktreePath: undefined, branch: undefined, baseBranch: undefined, mergeConflict: undefined, renderMode: undefined, sessionId: undefined });
      await deleteTaskAgentBlocks(taskId);
      if (prevStatus === "in-progress") {
        await abortTask(id, taskId);
      }
    } else if (toColumn === "verify" && prevStatus === "in-progress") {
      // Deferred merge: keep worktree alive for branch preview
      // No merge here — branch stays available for preview until "done"
    } else if (toColumn === "done" && prevStatus === "in-progress") {
      // Merge worktree when skipping verify
      if (prevTask?.worktreePath || prevTask?.branch) {
        const projectPath = project!.path.replace(/^~/, process.env.HOME || "~");
        const mergeBranch = prevTask.baseBranch || await getProjectDefaultBranch(id);
        try {
          ensureOnMainForMerge(projectPath, prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`, mergeBranch);
        } catch { /* best effort */ }
        const result = mergeWorktree(projectPath, prevTask.id.slice(0, 8));
        popAutoStash(projectPath, mergeBranch);
        if (result.success) {
          await updateTask(id, taskId, { worktreePath: undefined, branch: undefined, baseBranch: undefined, mergeConflict: undefined, agentStatus: null });
        } else {
          // Can't move to done with conflict — land in verify
          await moveTask(id, taskId, "verify", 0);
          await updateTask(id, taskId, {
            mergeConflict: {
              error: result.error || "Merge conflict",
              files: result.conflictFiles || [],
              branch: prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`,
              diff: result.diff,
            },
          });
          await processQueue(id);

          return NextResponse.json({ success: false, error: result.error });
        }
      }
      await updateTask(id, taskId, { agentStatus: null });
      scheduleCleanup(id, taskId);
    } else if (toColumn === "verify" && prevStatus === "done") {
      cancelCleanup(taskId);
    } else if (toColumn === "done" && prevStatus === "verify") {
      // Merge worktree branch into base on completion
      if (prevTask?.worktreePath || prevTask?.branch) {
        const projectPath = project!.path.replace(/^~/, process.env.HOME || "~");
        const mergeBranch = prevTask.baseBranch || await getProjectDefaultBranch(id);
        try {
          ensureOnMainForMerge(projectPath, prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`, mergeBranch);
        } catch { /* best effort */ }
        if (prevTask.worktreePath || prevTask.branch) {
          const result = mergeWorktree(projectPath, prevTask.id.slice(0, 8));
          popAutoStash(projectPath, mergeBranch);
          if (!result.success) {
            await moveTask(id, taskId, "verify", 0);
            await updateTask(id, taskId, {
              mergeConflict: {
                error: result.error || "Merge conflict",
                files: result.conflictFiles || [],
                branch: prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`,
                diff: result.diff,
              },
            });
            await processQueue(id);

            return NextResponse.json({ success: false, error: result.error });
          }
          await updateTask(id, taskId, { worktreePath: undefined, branch: undefined, baseBranch: undefined, mergeConflict: undefined, agentStatus: null });
        } else {
          popAutoStash(projectPath, mergeBranch);
        }
      }
      await updateTask(id, taskId, { agentStatus: null });
      scheduleCleanup(id, taskId);
    }
  }

  await processQueue(id);

  return NextResponse.json({ success: true });
}
