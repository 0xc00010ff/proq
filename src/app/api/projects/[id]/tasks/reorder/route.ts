import { NextResponse } from "next/server";
import { reorderTasks, getProject, getAllTasks, updateTask } from "@/lib/db";
import { dispatchTask, abortTask, shouldDispatch, scheduleCleanup, cancelCleanup } from "@/lib/agent-dispatch";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json();
  const { items } = body as {
    items: { id: string; order: number; status?: string }[];
  };

  if (!Array.isArray(items)) {
    return NextResponse.json(
      { error: "items array is required" },
      { status: 400 }
    );
  }

  // Snapshot previous statuses before reorder
  const previousTasks = await getAllTasks(id);
  const prevStatusMap = new Map(previousTasks.map((t) => [t.id, t.status]));

  await reorderTasks(id, items);

  // Detect status transitions and fire dispatch/abort
  const dispatched: { taskId: string; terminalTabId: string; title: string }[] = [];

  for (const item of items) {
    const prevStatus = prevStatusMap.get(item.id);
    const newStatus = item.status;
    if (!newStatus || prevStatus === newStatus) continue;

    if (newStatus === "in-progress" && prevStatus !== "in-progress") {
      cancelCleanup(item.id);
      if (prevStatus !== "verify") {
        const task = previousTasks.find((t) => t.id === item.id);
        await updateTask(id, item.id, { locked: true });
        if (await shouldDispatch(id)) {
          const terminalTabId = await dispatchTask(id, item.id, task?.title ?? "", task?.description ?? "", task?.mode);
          if (terminalTabId) {
            dispatched.push({ taskId: item.id, terminalTabId, title: task?.title ?? "" });
          } else {
            // Dispatch failed — unlock so it doesn't get stuck as "queued"
            await updateTask(id, item.id, { locked: false });
          }
        }
      }
    } else if (newStatus === "todo" && prevStatus !== "todo") {
      cancelCleanup(item.id);
      // Reset session data when moved back to todo from any status
      await updateTask(id, item.id, { locked: false, findings: "", humanSteps: "", agentLog: "" });
      if (prevStatus === "in-progress") {
        abortTask(id, item.id).catch((e) =>
          console.error(`[reorder] abortTask failed for ${item.id}:`, e)
        );
      }
    } else if (newStatus === "done") {
      if (prevStatus === "in-progress" || prevStatus === "verify") {
        scheduleCleanup(id, item.id);
      }
    }
  }

  return NextResponse.json({ success: true, dispatched });
}
