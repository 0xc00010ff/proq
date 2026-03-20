import { NextResponse } from "next/server";
import { getTask, updateTask, deleteTask } from "@/lib/db";
import { processQueue, cancelCleanup, notify } from "@/lib/agent-dispatch";
import { autoTitle } from "@/lib/auto-title";
import { emitTaskUpdate } from "@/lib/task-events";
import { safeParseBody } from "@/lib/api-utils";
import { initForDispatch, resetToTodo, mergeAndComplete, cleanupDeletedTask } from "@/lib/task-lifecycle";

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
  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;

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
      const changes = await initForDispatch(id, taskId, updated, prevStatus);
      Object.assign(updated, changes);
    } else if (body.status === "todo" && prevStatus !== "todo") {
      const resetFields = await resetToTodo(id, taskId, prevTask!);
      Object.assign(updated, resetFields);
    } else if (prevStatus === "in-progress" && body.status === "verify") {
      // Deferred merge: keep worktree alive for branch preview
      const sseChanges: Record<string, unknown> = { status: "verify" };
      if (body.agentStatus !== undefined) sseChanges.agentStatus = body.agentStatus;
      if (body.summary !== undefined) sseChanges.summary = body.summary;
      if (body.nextSteps !== undefined) sseChanges.nextSteps = body.nextSteps;
      emitTaskUpdate(id, taskId, sseChanges);
      notify(`✅ *${(updated.title || updated.description.slice(0, 40)).replace(/"/g, '\\"')}* → verify`);
    } else if (prevStatus === "in-progress" && body.status === "done") {
      const result = await mergeAndComplete(id, taskId, prevTask!);
      if (!result.success) return NextResponse.json(result.task);
      notify(`✅ *${(updated.title || updated.description.slice(0, 40)).replace(/"/g, '\\"')}* → done`);
    } else if (body.status === "verify" && prevStatus === "done") {
      cancelCleanup(taskId);
    } else if (body.status === "done" && prevStatus === "verify") {
      const result = await mergeAndComplete(id, taskId, prevTask!);
      if (!result.success) return NextResponse.json(result.task);
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

  if (task) {
    await cleanupDeletedTask(id, task);
    if (task.status === "in-progress") {
      await processQueue(id);
    }
  }

  return NextResponse.json({ success: true });
}
