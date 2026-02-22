import { NextResponse } from "next/server";
import { getTask, getProject, updateTask, deleteTask } from "@/lib/db";
import type { Task } from "@/lib/types";
import { abortTask, processQueue, getInitialDispatch, scheduleCleanup, cancelCleanup, notify } from "@/lib/agent-dispatch";
import { mergeWorktree, removeWorktree } from "@/lib/worktree";

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
      if (prevTask?.worktreePath) {
        const proj = await getProject(id);
        if (proj) {
          const projectPath = proj.path.replace(/^~/, process.env.HOME || "~");
          removeWorktree(projectPath, prevTask.id.slice(0, 8));
        }
      }
      const resetFields = { dispatch: null as Task["dispatch"], findings: "", humanSteps: "", agentLog: "", worktreePath: undefined as string | undefined, branch: undefined as string | undefined };
      await updateTask(id, taskId, resetFields);
      Object.assign(updated, resetFields);
      if (prevStatus === "in-progress") {
        await abortTask(id, taskId);
      }
    } else if (prevStatus === "in-progress" && (body.status === "verify" || body.status === "done")) {
      if (body.status === "done") {
        scheduleCleanup(id, taskId);
      }
      notify(`✅ *${(updated.title || updated.description.slice(0, 40)).replace(/"/g, '\\"')}* → ${body.status}`);
    } else if (body.status === "done" && prevStatus === "verify") {
      // Merge worktree if task has one
      if (prevTask?.worktreePath) {
        const proj = await getProject(id);
        if (proj) {
          const projectPath = proj.path.replace(/^~/, process.env.HOME || "~");
          const result = mergeWorktree(projectPath, prevTask.id.slice(0, 8));
          if (!result.success) {
            // Keep task in verify, explain the conflict
            await updateTask(id, taskId, { status: "verify", findings: result.error });
            const fresh = await getTask(id, taskId);
            if (fresh) return NextResponse.json(fresh);
            return NextResponse.json(updated);
          }
          // Merge succeeded — clear worktree fields
          await updateTask(id, taskId, { worktreePath: undefined, branch: undefined });
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

  // If deleted task was in-progress, abort and process queue for next
  if (task?.status === "in-progress") {
    await abortTask(id, taskId);
    await processQueue(id);
  }

  return NextResponse.json({ success: true });
}
