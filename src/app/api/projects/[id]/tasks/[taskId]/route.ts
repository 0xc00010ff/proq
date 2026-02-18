import { NextResponse } from "next/server";
import { getTask, updateTask, deleteTask } from "@/lib/db";
import { dispatchTask, abortTask, shouldDispatch, dispatchNextQueued, scheduleCleanup, cancelCleanup, notify } from "@/lib/agent-dispatch";

type Params = { params: Promise<{ id: string; taskId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, taskId } = await params;
  const body = await request.json();

  // Check for status transitions before applying update
  const prevTask = await getTask(id, taskId);

  const updated = await updateTask(id, taskId, body);
  if (!updated) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let terminalTabId: string | undefined;

  // Dispatch/abort on status change
  if (prevTask && body.status && prevTask.status !== body.status) {
    if (body.status === "in-progress" && prevTask.status !== "in-progress") {
      cancelCleanup(taskId);
      if (prevTask.status !== "verify") {
        await updateTask(id, taskId, { locked: true });
        updated.locked = true;
        if (await shouldDispatch(id)) {
          terminalTabId = await dispatchTask(id, taskId, updated.title, updated.description, updated.mode);
          if (!terminalTabId) {
            await updateTask(id, taskId, { locked: false });
            updated.locked = false;
          }
        }
      }
    } else if (body.status === "todo" && prevTask.status !== "todo") {
      cancelCleanup(taskId);
      // Reset session data when moved back to todo from any status
      const resetFields = { locked: false, findings: "", humanSteps: "", agentLog: "" };
      await updateTask(id, taskId, resetFields);
      Object.assign(updated, resetFields);
      if (prevTask.status === "in-progress") {
        abortTask(id, taskId).catch((e) =>
          console.error(`[task-patch] abortTask failed:`, e)
        );
      }
    } else if (prevTask.status === "in-progress" && (body.status === "verify" || body.status === "done")) {
      scheduleCleanup(id, taskId);
      notify(`✅ *${updated.title.replace(/"/g, '\\"')}* → ${body.status}`);
      // Auto-dispatch next queued task in sequential mode
      dispatchNextQueued(id).catch(e =>
        console.error(`[task-patch] auto-dispatch next failed:`, e)
      );
    }
  }

  return NextResponse.json({ ...updated, terminalTabId });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id, taskId } = await params;
  const deleted = await deleteTask(id, taskId);
  if (!deleted) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
