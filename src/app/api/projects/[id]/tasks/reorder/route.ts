import { NextResponse } from "next/server";
import { moveTask, getProject, getTask, updateTask } from "@/lib/db";
import { abortTask, processQueue, getInitialDispatch, scheduleCleanup, cancelCleanup } from "@/lib/agent-dispatch";
import { mergeWorktree, removeWorktree, getCurrentBranch, checkoutBranch, isPreviewBranch, sourceProqBranch, deletePreviewBranch } from "@/lib/worktree";
import type { TaskStatus } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

/** Check if the main project directory is currently on a task's branch (or its preview) and switch to main if so */
function ensureNotOnTaskBranch(projectPath: string, taskBranch: string): void {
  const cur = getCurrentBranch(projectPath);
  const isOnTask = cur.branch === taskBranch
    || (isPreviewBranch(cur.branch) && sourceProqBranch(cur.branch) === taskBranch);
  if (isOnTask) {
    checkoutBranch(projectPath, "main");
  }
  deletePreviewBranch(projectPath, taskBranch);
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json();
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
      if (prevStatus !== "verify") {
        const dispatch = await getInitialDispatch(id, taskId);
        await updateTask(id, taskId, { dispatch });
      }
    } else if (toColumn === "todo" && prevStatus !== "todo") {
      cancelCleanup(taskId);
      // Remove worktree if task had one (no merge — work is discarded)
      if (prevTask?.worktreePath || prevTask?.branch) {
        const projectPath = project!.path.replace(/^~/, process.env.HOME || "~");
        try {
          ensureNotOnTaskBranch(projectPath, prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`);
        } catch { /* best effort */ }
        removeWorktree(projectPath, prevTask.id.slice(0, 8));
      }
      await updateTask(id, taskId, { dispatch: null, findings: "", humanSteps: "", agentLog: "", worktreePath: undefined, branch: undefined, mergeConflict: undefined });
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
        try {
          ensureNotOnTaskBranch(projectPath, prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`);
        } catch { /* best effort */ }
        const result = mergeWorktree(projectPath, prevTask.id.slice(0, 8));
        if (result.success) {
          await updateTask(id, taskId, { worktreePath: undefined, branch: undefined, mergeConflict: undefined });
        } else {
          // Can't move to done with conflict — land in verify
          await moveTask(id, taskId, "verify", 0);
          await updateTask(id, taskId, {
            mergeConflict: {
              error: result.error || "Merge conflict",
              files: result.conflictFiles || [],
              branch: prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`,
            },
          });
          await processQueue(id);
          return NextResponse.json({ success: false, error: result.error });
        }
      }
      scheduleCleanup(id, taskId);
    } else if (toColumn === "done" && prevStatus === "verify") {
      // Merge worktree branch into main on completion
      if (prevTask?.worktreePath || prevTask?.branch) {
        const projectPath = project!.path.replace(/^~/, process.env.HOME || "~");
        try {
          ensureNotOnTaskBranch(projectPath, prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`);
        } catch { /* best effort */ }
        if (prevTask.worktreePath) {
          const result = mergeWorktree(projectPath, prevTask.id.slice(0, 8));
          if (!result.success) {
            await moveTask(id, taskId, "verify", 0);
            await updateTask(id, taskId, {
              mergeConflict: {
                error: result.error || "Merge conflict",
                files: result.conflictFiles || [],
                branch: prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`,
              },
            });
            await processQueue(id);
            return NextResponse.json({ success: false, error: result.error });
          }
          await updateTask(id, taskId, { worktreePath: undefined, branch: undefined, mergeConflict: undefined });
        }
      }
      scheduleCleanup(id, taskId);
    }
  }

  await processQueue(id);

  return NextResponse.json({ success: true });
}
