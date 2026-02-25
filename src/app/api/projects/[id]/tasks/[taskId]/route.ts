import { NextResponse } from "next/server";
import { getTask, getProject, updateTask, deleteTask } from "@/lib/db";
import type { Task } from "@/lib/types";
import { abortTask, processQueue, getInitialDispatch, scheduleCleanup, cancelCleanup, notify } from "@/lib/agent-dispatch";
import { mergeWorktree, removeWorktree, getCurrentBranch, checkoutBranch, isPreviewBranch, sourceProqBranch, deletePreviewBranch } from "@/lib/worktree";

/** Check if the main project directory is currently on a task's branch (or its preview) and switch to main if so */
function ensureNotOnTaskBranch(projectPath: string, taskBranch: string): void {
  const cur = getCurrentBranch(projectPath);
  const isOnTask = cur.branch === taskBranch
    || (isPreviewBranch(cur.branch) && sourceProqBranch(cur.branch) === taskBranch);
  if (isOnTask) {
    checkoutBranch(projectPath, "main");
  }
  // Also clean up any leftover preview branch for this task
  deletePreviewBranch(projectPath, taskBranch);
}

type Params = { params: Promise<{ id: string; taskId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, taskId } = await params;
  const body = await request.json();

  // Snapshot previous status before updateTask mutates the same object reference
  const prevTask = await getTask(id, taskId);
  const prevStatus = prevTask?.status;

  const updated = await updateTask(id, taskId, body);
  if (!updated) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Handle status transitions
  if (prevStatus && body.status && prevStatus !== body.status) {
    if (body.status === "in-progress" && prevStatus !== "in-progress") {
      cancelCleanup(taskId);
      if (prevStatus !== "verify") {
        const dispatch = await getInitialDispatch(id, taskId);
        await updateTask(id, taskId, { dispatch });
        updated.dispatch = dispatch;
      }
    } else if (body.status === "todo" && prevStatus !== "todo") {
      cancelCleanup(taskId);
      // Remove worktree if task had one (no merge — work is discarded)
      if (prevTask?.worktreePath || prevTask?.branch) {
        const proj = await getProject(id);
        if (proj) {
          const projectPath = proj.path.replace(/^~/, process.env.HOME || "~");
          try {
            ensureNotOnTaskBranch(projectPath, prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`);
          } catch { /* best effort */ }
          removeWorktree(projectPath, prevTask.id.slice(0, 8));
        }
      }
      const resetFields = { dispatch: null as Task["dispatch"], findings: "", humanSteps: "", agentLog: "", worktreePath: undefined as string | undefined, branch: undefined as string | undefined, mergeConflict: undefined as Task["mergeConflict"] };
      await updateTask(id, taskId, resetFields);
      Object.assign(updated, resetFields);
      if (prevStatus === "in-progress") {
        await abortTask(id, taskId);
      }
    } else if (prevStatus === "in-progress" && body.status === "verify") {
      // Deferred merge: keep worktree alive for branch preview
      // No merge here — branch stays available for preview until "done"
      notify(`✅ *${(updated.title || updated.description.slice(0, 40)).replace(/"/g, '\\"')}* → verify`);
    } else if (prevStatus === "in-progress" && body.status === "done") {
      // Merge worktree when skipping verify
      if (prevTask?.worktreePath || prevTask?.branch) {
        const proj = await getProject(id);
        if (proj) {
          const projectPath = proj.path.replace(/^~/, process.env.HOME || "~");
          try {
            ensureNotOnTaskBranch(projectPath, prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`);
          } catch { /* best effort */ }
          const result = mergeWorktree(projectPath, prevTask.id.slice(0, 8));
          if (result.success) {
            await updateTask(id, taskId, { worktreePath: undefined, branch: undefined, mergeConflict: undefined });
          } else {
            // Can't complete with conflict — stay in verify
            await updateTask(id, taskId, {
              status: "verify",
              mergeConflict: {
                error: result.error || "Merge conflict",
                files: result.conflictFiles || [],
                branch: prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`,
              },
            });
            const fresh = await getTask(id, taskId);
            if (fresh) return NextResponse.json(fresh);
            return NextResponse.json(updated);
          }
        }
      }
      scheduleCleanup(id, taskId);
      notify(`✅ *${(updated.title || updated.description.slice(0, 40)).replace(/"/g, '\\"')}* → done`);
    } else if (body.status === "done" && prevStatus === "verify") {
      // Merge worktree branch into main on completion
      if (prevTask?.worktreePath || prevTask?.branch) {
        const proj = await getProject(id);
        if (proj) {
          const projectPath = proj.path.replace(/^~/, process.env.HOME || "~");
          try {
            ensureNotOnTaskBranch(projectPath, prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`);
          } catch { /* best effort */ }
          if (prevTask.worktreePath) {
            const result = mergeWorktree(projectPath, prevTask.id.slice(0, 8));
            if (!result.success) {
              await updateTask(id, taskId, {
                status: "verify",
                mergeConflict: {
                  error: result.error || "Merge conflict",
                  files: result.conflictFiles || [],
                  branch: prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`,
                },
              });
              const fresh = await getTask(id, taskId);
              if (fresh) return NextResponse.json(fresh);
              return NextResponse.json(updated);
            }
            await updateTask(id, taskId, { worktreePath: undefined, branch: undefined, mergeConflict: undefined });
          }
        }
      }
      scheduleCleanup(id, taskId);
    }

    await processQueue(id);

    // Re-read task to include any dispatch state changes from processQueue
    const fresh = await getTask(id, taskId);
    if (fresh) return NextResponse.json(fresh);
  }

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id, taskId } = await params;
  const task = await getTask(id, taskId);
  const deleted = await deleteTask(id, taskId);
  if (!deleted) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Clean up worktree/branch if present
  if (task?.worktreePath || task?.branch) {
    const proj = await getProject(id);
    if (proj) {
      const projectPath = proj.path.replace(/^~/, process.env.HOME || "~");
      try {
        ensureNotOnTaskBranch(projectPath, task.branch || `proq/${task.id.slice(0, 8)}`);
      } catch { /* best effort */ }
      removeWorktree(projectPath, task.id.slice(0, 8));
    }
  }

  // If deleted task was in-progress, abort and process queue for next
  if (task?.status === "in-progress") {
    await abortTask(id, taskId);
    await processQueue(id);
  }

  return NextResponse.json({ success: true });
}
