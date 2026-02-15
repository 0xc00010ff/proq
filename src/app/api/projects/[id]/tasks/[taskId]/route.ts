import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { getTask, updateTask, deleteTask } from "@/lib/db";
import { dispatchTask, abortTask } from "@/lib/agent-dispatch";

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
      terminalTabId = await dispatchTask(params.id, params.taskId, updated.title, updated.description);
    } else if (prevTask.status === "in-progress" && body.status === "todo") {
      await updateTask(params.id, params.taskId, { locked: false });
      updated.locked = false;
      abortTask(params.id, params.taskId);
    } else if (prevTask.status === "in-progress" && body.status === "verify") {
      // Agent completed — notify Slack
      try {
        const title = updated.title.replace(/"/g, '\\"');
        execSync(
          `${OPENCLAW} message send --channel slack --target C0AEY4GBCGM --message "✅ *${title}* → verify"`,
          { timeout: 10_000 }
        );
      } catch (e) {
        console.error(`[task-patch] slack verify notify failed:`, e);
      }
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
