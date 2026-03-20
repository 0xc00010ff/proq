import { NextResponse } from "next/server";
import { moveTask, getProject, getTask } from "@/lib/db";
import { processQueue, cancelCleanup } from "@/lib/agent-dispatch";
import type { TaskStatus } from "@/lib/types";
import { safeParseBody } from "@/lib/api-utils";
import { initForDispatch, resetToTodo, mergeAndComplete } from "@/lib/task-lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;
  const { taskId, toColumn, toIndex } = body as {
    taskId: string;
    toColumn: TaskStatus;
    toIndex: number;
  };

  if (!taskId || !toColumn || toIndex == null) {
    return NextResponse.json(
      { error: "taskId, toColumn, and toIndex are required" },
      { status: 400 }
    );
  }

  // Snapshot previous status before move
  const prevTask = await getTask(id, taskId);
  const prevStatus = prevTask?.status;

  const moved = await moveTask(id, taskId, toColumn, toIndex);
  if (!moved) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Handle status transitions
  if (prevStatus && prevStatus !== toColumn) {
    if (toColumn === "in-progress" && prevStatus !== "in-progress") {
      if (prevTask) await initForDispatch(id, taskId, prevTask, prevStatus);
    } else if (toColumn === "todo" && prevStatus !== "todo") {
      if (prevTask) await resetToTodo(id, taskId, prevTask);
    } else if (toColumn === "verify" && prevStatus === "in-progress") {
      // Deferred merge: keep worktree alive for branch preview
    } else if (toColumn === "done" && (prevStatus === "in-progress" || prevStatus === "verify")) {
      const result = await mergeAndComplete(id, taskId, prevTask!, async () => {
        await moveTask(id, taskId, "verify", 0);
      });
      if (!result.success) {
        await processQueue(id);
        return NextResponse.json({ success: false, error: "Merge conflict" });
      }
    } else if (toColumn === "verify" && prevStatus === "done") {
      cancelCleanup(taskId);
    }
  }

  await processQueue(id);

  return NextResponse.json({ success: true });
}
