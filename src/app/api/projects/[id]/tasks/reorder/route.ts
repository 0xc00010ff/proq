import { NextResponse } from "next/server";
import { reorderTasks, getProject, getAllTasks, updateTask } from "@/lib/db";
import { dispatchTask, abortTask, shouldDispatch, scheduleCleanup, cancelCleanup } from "@/lib/agent-dispatch";

type Params = { params: { id: string } };

export async function PUT(request: Request, { params }: Params) {
  const project = await getProject(params.id);
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
  const previousTasks = await getAllTasks(params.id);
  const prevStatusMap = new Map(previousTasks.map((t) => [t.id, t.status]));

  await reorderTasks(params.id, items);

  // Detect status transitions and fire dispatch/abort
  const dispatched: { taskId: string; terminalTabId: string; title: string }[] = [];

  for (const item of items) {
    const prevStatus = prevStatusMap.get(item.id);
    const newStatus = item.status;
    if (!newStatus || prevStatus === newStatus) continue;

    if (newStatus === "in-progress" && prevStatus !== "in-progress") {
      cancelCleanup(item.id);
      const task = previousTasks.find((t) => t.id === item.id);
      await updateTask(params.id, item.id, { locked: true });
      if (await shouldDispatch(params.id)) {
        const terminalTabId = await dispatchTask(params.id, item.id, task?.title ?? "", task?.description ?? "", task?.mode);
        if (terminalTabId) {
          dispatched.push({ taskId: item.id, terminalTabId, title: task?.title ?? "" });
        }
      }
    } else if (newStatus === "todo" && prevStatus !== "todo") {
      cancelCleanup(item.id);
      // Reset session data when moved back to todo from any status
      await updateTask(params.id, item.id, { locked: false, findings: "", humanSteps: "", agentLog: "" });
      if (prevStatus === "in-progress") {
        abortTask(params.id, item.id).catch((e) =>
          console.error(`[reorder] abortTask failed for ${item.id}:`, e)
        );
      }
    } else if (newStatus === "verify" || newStatus === "done") {
      if (prevStatus === "in-progress") {
        scheduleCleanup(params.id, item.id);
      }
    }
  }

  return NextResponse.json({ success: true, dispatched });
}
