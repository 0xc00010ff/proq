import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { getTask, updateTask, deleteTask, getProject } from "@/lib/db";
import { dispatchTask, abortTask, shouldDispatch, dispatchNextQueued } from "@/lib/agent-dispatch";

const OPENCLAW = "/opt/homebrew/bin/openclaw";

type Params = { params: { id: string; taskId: string } };

export async function PATCH(request: Request, { params }: Params) {
  const body = await request.json();

  // Check for status transitions before applying update
  const prevTask = await getTask(params.id, params.taskId);

  const updated = await updateTask(params.id, params.taskId, body);
  if (!updated) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let terminalTabId: string | undefined;

  // Dispatch/abort on status change
  if (prevTask && body.status && prevTask.status !== body.status) {
    if (body.status === "in-progress" && prevTask.status !== "in-progress") {
      await updateTask(params.id, params.taskId, { locked: true });
      updated.locked = true;
      if (await shouldDispatch(params.id)) {
        terminalTabId = await dispatchTask(params.id, params.taskId, updated.title, updated.description, updated.mode);
      }
    } else if (body.status === "todo" && prevTask.status !== "todo") {
      // Reset session data when moved back to todo from any status
      const resetFields = { locked: false, findings: "", humanSteps: "", agentLog: "" };
      await updateTask(params.id, params.taskId, resetFields);
      Object.assign(updated, resetFields);
      if (prevTask.status === "in-progress") {
        abortTask(params.id, params.taskId).catch((e) =>
          console.error(`[task-patch] abortTask failed:`, e)
        );
      }
    } else if (prevTask.status === "in-progress" && (body.status === "verify" || body.status === "done")) {
      // Agent completed — notify Slack
      try {
        const title = updated.title.replace(/"/g, '\\"');
        execSync(
          `${OPENCLAW} message send --channel slack --target C0AEY4GBCGM --message "✅ *${title}* → ${body.status}"`,
          { timeout: 10_000 }
        );
      } catch (e) {
        console.error(`[task-patch] slack verify notify failed:`, e);
      }
      // Auto-dispatch next queued task in sequential mode
      dispatchNextQueued(params.id).catch(e =>
        console.error(`[task-patch] auto-dispatch next failed:`, e)
      );
    }
  }

  return NextResponse.json({ ...updated, terminalTabId });
}

export async function DELETE(_request: Request, { params }: Params) {
  const deleted = await deleteTask(params.id, params.taskId);
  if (!deleted) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
