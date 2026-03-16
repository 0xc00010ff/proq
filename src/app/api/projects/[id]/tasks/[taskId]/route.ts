import { NextResponse } from "next/server";
import { getTask, getProject, updateTask, deleteTask, getSettings, getProjectDefaultBranch } from "@/lib/db";
import type { Task } from "@/lib/types";
import { abortTask, processQueue, getInitialAgentStatus, scheduleCleanup, cancelCleanup, notify } from "@/lib/agent-dispatch";
import { autoTitle } from "@/lib/auto-title";
import { clearSession } from "@/lib/agent-provider";
import { emitTaskUpdate } from "@/lib/task-events";
import { mergeWorktree, removeWorktree, ensureNotOnTaskBranch, ensureOnMainForMerge, popAutoStash } from "@/lib/worktree";

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

  // Set needsAttention when summary is updated and task is (moving to) verify
  const effectiveStatus = body.status || prevStatus;
  if (body.summary !== undefined && effectiveStatus === "verify") {
    await updateTask(id, taskId, { needsAttention: true });
    updated.needsAttention = true;
    emitTaskUpdate(id, taskId, { needsAttention: true });
  }

  // Handle status transitions
  if (prevStatus && body.status && prevStatus !== body.status) {
    // Auto-title on status change (e.g. starting a task) — draft modal handles its own auto-title
    if (!updated.title && updated.description?.trim()) {
      autoTitle(id, taskId, updated.description);
    }
    if (body.status === "in-progress" && prevStatus !== "in-progress") {
      cancelCleanup(taskId);
      if (prevStatus !== "verify" && prevStatus !== "done") {
        const settings = await getSettings();
        const agentStatus = await getInitialAgentStatus(id, taskId);
        const renderMode = updated.renderMode || settings.agentRenderMode || 'structured';
        await updateTask(id, taskId, { agentStatus, renderMode });
        updated.agentStatus = agentStatus;
        updated.renderMode = renderMode;
      }
    } else if (body.status === "todo" && prevStatus !== "todo") {
      cancelCleanup(taskId);
      // Remove worktree if task had one (no merge — work is discarded)
      if (prevTask?.worktreePath || prevTask?.branch) {
        const proj = await getProject(id);
        if (proj) {
          const projectPath = proj.path.replace(/^~/, process.env.HOME || "~");
          const defaultBr = await getProjectDefaultBranch(id);
          try {
            ensureNotOnTaskBranch(projectPath, prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`, defaultBr);
          } catch { /* best effort */ }
          removeWorktree(projectPath, prevTask.id.slice(0, 8));
          popAutoStash(projectPath, prevTask.baseBranch || defaultBr);
        }
      }
      const resetFields = { agentStatus: null as Task["agentStatus"], summary: "", nextSteps: "", agentLog: "", needsAttention: undefined as boolean | undefined, worktreePath: undefined as string | undefined, branch: undefined as string | undefined, baseBranch: undefined as string | undefined, mergeConflict: undefined as Task["mergeConflict"], renderMode: undefined as Task["renderMode"], agentBlocks: undefined as Task["agentBlocks"], sessionId: undefined as Task["sessionId"] };
      await updateTask(id, taskId, resetFields);
      Object.assign(updated, resetFields);
      if (prevStatus === "in-progress") {
        await abortTask(id, taskId);
      }
    } else if (prevStatus === "in-progress" && body.status === "verify") {
      // Deferred merge: keep worktree alive for branch preview
      // No merge here — branch stays available for preview until "done"
      // Emit SSE so client updates immediately (agent-initiated via MCP)
      const sseChanges: Record<string, unknown> = { status: "verify" };
      if (body.agentStatus !== undefined) sseChanges.agentStatus = body.agentStatus;
      if (body.summary !== undefined) sseChanges.summary = body.summary;
      if (body.nextSteps !== undefined) sseChanges.nextSteps = body.nextSteps;
      emitTaskUpdate(id, taskId, sseChanges);
      notify(`✅ *${(updated.title || updated.description.slice(0, 40)).replace(/"/g, '\\"')}* → verify`);
    } else if (prevStatus === "in-progress" && body.status === "done") {
      // Merge worktree when skipping verify
      if (prevTask?.worktreePath || prevTask?.branch) {
        const proj = await getProject(id);
        if (proj) {
          const projectPath = proj.path.replace(/^~/, process.env.HOME || "~");
          const mergeBranch = prevTask.baseBranch || await getProjectDefaultBranch(id);
          try {
            ensureOnMainForMerge(projectPath, prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`, mergeBranch);
          } catch { /* best effort */ }
          const result = mergeWorktree(projectPath, prevTask.id.slice(0, 8));
          popAutoStash(projectPath, mergeBranch);
          if (result.success) {
            await updateTask(id, taskId, { worktreePath: undefined, branch: undefined, baseBranch: undefined, mergeConflict: undefined, agentStatus: null, needsAttention: undefined });
          } else {
            // Can't complete with conflict — stay in verify
            await updateTask(id, taskId, {
              status: "verify",
              mergeConflict: {
                error: result.error || "Merge conflict",
                files: result.conflictFiles || [],
                branch: prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`,
                diff: result.diff,
              },
            });
            const fresh = await getTask(id, taskId);

            if (fresh) return NextResponse.json(fresh);
            return NextResponse.json(updated);
          }
        }
      }
      await updateTask(id, taskId, { agentStatus: null, needsAttention: undefined });
      scheduleCleanup(id, taskId);
      clearSession(taskId);
      notify(`✅ *${(updated.title || updated.description.slice(0, 40)).replace(/"/g, '\\"')}* → done`);
    } else if (body.status === "verify" && prevStatus === "done") {
      // Moving back from done to verify — cancel any pending cleanup so
      // the user can continue chatting without the cleanup timer interfering.
      cancelCleanup(taskId);
    } else if (body.status === "done" && prevStatus === "verify") {
      // Merge worktree branch into base on completion
      if (prevTask?.worktreePath || prevTask?.branch) {
        const proj = await getProject(id);
        if (proj) {
          const projectPath = proj.path.replace(/^~/, process.env.HOME || "~");
          const mergeBranch = prevTask.baseBranch || await getProjectDefaultBranch(id);
          try {
            ensureOnMainForMerge(projectPath, prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`, mergeBranch);
          } catch { /* best effort */ }
          if (prevTask.worktreePath || prevTask.branch) {
            const result = mergeWorktree(projectPath, prevTask.id.slice(0, 8));
            popAutoStash(projectPath, mergeBranch);
            if (!result.success) {
              await updateTask(id, taskId, {
                status: "verify",
                mergeConflict: {
                  error: result.error || "Merge conflict",
                  files: result.conflictFiles || [],
                  branch: prevTask.branch || `proq/${prevTask.id.slice(0, 8)}`,
                  diff: result.diff,
                },
              });
              const fresh = await getTask(id, taskId);

              if (fresh) return NextResponse.json(fresh);
              return NextResponse.json(updated);
            }
            await updateTask(id, taskId, { worktreePath: undefined, branch: undefined, baseBranch: undefined, mergeConflict: undefined, agentStatus: null, needsAttention: undefined });
          } else {
            popAutoStash(projectPath, mergeBranch);
          }
        }
      }
      await updateTask(id, taskId, { agentStatus: null, needsAttention: undefined });
      scheduleCleanup(id, taskId);
      clearSession(taskId);
    }

    await processQueue(id);

    // Re-read task to include any agentStatus changes from processQueue
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
      const defaultBr = await getProjectDefaultBranch(id);
      try {
        ensureNotOnTaskBranch(projectPath, task.branch || `proq/${task.id.slice(0, 8)}`, defaultBr);
      } catch { /* best effort */ }
      removeWorktree(projectPath, task.id.slice(0, 8));
      popAutoStash(projectPath, task.baseBranch || defaultBr);
    }
  }

  // Clean up SDK session if present (default structured mode)
  if (task?.renderMode !== "cli") {
    clearSession(taskId);
  }

  // If deleted task was in-progress, abort and process queue for next
  if (task?.status === "in-progress") {
    await abortTask(id, taskId);
    await processQueue(id);
  }

  return NextResponse.json({ success: true });
}
