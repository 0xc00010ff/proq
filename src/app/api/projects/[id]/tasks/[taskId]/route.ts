import { NextResponse } from "next/server";
import { getTask, getProject, updateTask, deleteTask, getSettings } from "@/lib/db";
import type { Task } from "@/lib/types";
import { abortTask, processQueue, getInitialDispatch, scheduleCleanup, cancelCleanup, notify } from "@/lib/agent-dispatch";
import { autoTitle } from "@/lib/auto-title";
import { clearSession, injectBlock } from "@/lib/pretty-runtime";
import { mergeWorktree, removeWorktree, getCurrentBranch, checkoutBranch, isPreviewBranch, sourceProqBranch, deletePreviewBranch, popAutoStash } from "@/lib/worktree";

/** Check if the main project directory is currently on a task's branch (or its preview) and switch to main if so */
function ensureNotOnTaskBranch(projectPath: string, taskBranch: string): void {
  const cur = getCurrentBranch(projectPath);
  const isOnTask = cur.branch === taskBranch
    || (isPreviewBranch(cur.branch) && sourceProqBranch(cur.branch) === taskBranch);
  if (isOnTask) {
    checkoutBranch(projectPath, "main", { skipStashPop: true });
  }
  // Also clean up any leftover preview branch for this task
  deletePreviewBranch(projectPath, taskBranch);
}

type Params = { params: Promise<{ id: string; taskId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id, taskId } = await params;
  const task = await getTask(id, taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json(task);
}

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

  // Auto-title: fire-and-forget background process when description exists but title is empty
  if (!updated.title && updated.description?.trim()) {
    autoTitle(id, taskId, updated.description);
  }

  // Inject task_update block into live pretty session when findings are updated
  if (body.findings != null && updated.renderMode === "pretty") {
    injectBlock(taskId, {
      type: "task_update",
      findings: body.findings,
      humanSteps: body.humanSteps,
      timestamp: new Date().toISOString(),
    });
  }

  // Handle status transitions
  if (prevStatus && body.status && prevStatus !== body.status) {
    if (body.status === "in-progress" && prevStatus !== "in-progress") {
      cancelCleanup(taskId);
      if (prevStatus !== "verify") {
        const settings = await getSettings();
        const dispatch = await getInitialDispatch(id, taskId);
        const renderMode = updated.renderMode || settings.agentRenderMode || 'terminal';
        await updateTask(id, taskId, { dispatch, renderMode });
        updated.dispatch = dispatch;
        updated.renderMode = renderMode;
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
          popAutoStash(projectPath);
        }
      }
      const resetFields = { dispatch: null as Task["dispatch"], findings: "", humanSteps: "", agentLog: "", worktreePath: undefined as string | undefined, branch: undefined as string | undefined, mergeConflict: undefined as Task["mergeConflict"], renderMode: undefined as Task["renderMode"], prettyLog: undefined as Task["prettyLog"], sessionId: undefined as Task["sessionId"] };
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
          popAutoStash(projectPath);
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
      clearSession(taskId);
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
            popAutoStash(projectPath);
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
          } else {
            popAutoStash(projectPath);
          }
        }
      }
      scheduleCleanup(id, taskId);
      clearSession(taskId);
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
      popAutoStash(projectPath);
    }
  }

  // Clean up pretty session if present
  if (task?.renderMode === "pretty") {
    clearSession(taskId);
  }

  // If deleted task was in-progress, abort and process queue for next
  if (task?.status === "in-progress") {
    await abortTask(id, taskId);
    await processQueue(id);
  }

  return NextResponse.json({ success: true });
}
