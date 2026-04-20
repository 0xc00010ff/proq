import { NextResponse } from "next/server";
import { getTask, updateTask } from "@/lib/db";
import { dispatchTask, isSessionAlive } from "@/lib/agent-dispatch";

type Params = { params: Promise<{ id: string; taskId: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { id, taskId } = await params;
  const task = await getTask(id, taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.status !== "in-progress" || task.agentStatus !== "queued") {
    return NextResponse.json({ error: "Task is not queued" }, { status: 400 });
  }

  if (isSessionAlive(task.id)) {
    return NextResponse.json({ error: "Task is already dispatched" }, { status: 400 });
  }

  const terminalTabId = await dispatchTask(id, taskId, task.title, task.description, task.mode);

  if (terminalTabId) {
    await updateTask(id, taskId, { agentStatus: "running" });
  }
  // else: leave as "queued"

  return NextResponse.json({ success: true, terminalTabId });
}
