import { NextResponse } from "next/server";
import { getExecutionMode, setExecutionMode, getAllTasks } from "@/lib/db";
import { dispatchTask, isTaskDispatched, getAllCleanupTimes } from "@/lib/agent-dispatch";
import type { ExecutionMode } from "@/lib/types";

type Params = { params: { id: string } };

export async function GET(_request: Request, { params }: Params) {
  const mode = await getExecutionMode(params.id);
  const tasks = await getAllTasks(params.id);
  const dispatchedTaskIds = tasks
    .filter((t) => t.status === "in-progress" && t.locked && isTaskDispatched(t.id))
    .map((t) => t.id);
  const cleanupTimes = getAllCleanupTimes();
  return NextResponse.json({ mode, dispatchedTaskIds, cleanupTimes });
}

export async function PATCH(request: Request, { params }: Params) {
  const body = await request.json();
  const mode = body.mode as ExecutionMode;

  if (mode !== "sequential" && mode !== "parallel") {
    return NextResponse.json(
      { error: "mode must be 'sequential' or 'parallel'" },
      { status: 400 }
    );
  }

  await setExecutionMode(params.id, mode);

  // If switching to parallel, dispatch any queued tasks
  if (mode === "parallel") {
    const tasks = await getAllTasks(params.id);
    const queued = tasks.filter(
      (t) => t.status === "in-progress" && t.locked && !isTaskDispatched(t.id)
    );
    for (const task of queued) {
      await dispatchTask(params.id, task.id, task.title, task.description, task.mode);
    }
  }

  return NextResponse.json({ mode });
}
