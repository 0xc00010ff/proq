import { NextResponse } from "next/server";
import { moveTask, getProject, getTask, updateTask } from "@/lib/db";
import { abortTask, processQueue, getInitialDispatch, scheduleCleanup, cancelCleanup } from "@/lib/agent-dispatch";
import { mergeWorktree, removeWorktree } from "@/lib/worktree";
import type { TaskStatus } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json();
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
      cancelCleanup(taskId);
      if (prevStatus !== "verify") {
        const dispatch = await getInitialDispatch(id, taskId);
        await updateTask(id, taskId, { dispatch });
      }
    } else if (toColumn === "todo" && prevStatus !== "todo") {
      cancelCleanup(taskId);
      // Remove worktree if task had one (no merge — work is discarded)
      if (prevTask?.worktreePath) {
        const projectPath = project!.path.replace(/^~/, process.env.HOME || "~");
        removeWorktree(projectPath, prevTask.id.slice(0, 8));
      }
      await updateTask(id, taskId, { dispatch: null, findings: "", humanSteps: "", agentLog: "", worktreePath: undefined, branch: undefined });
      if (prevStatus === "in-progress") {
        await abortTask(id, taskId);
      }
    } else if (toColumn === "done" && (prevStatus === "in-progress" || prevStatus === "verify")) {
      // Merge worktree if task has one
      if (prevTask?.worktreePath) {
        const projectPath = project!.path.replace(/^~/, process.env.HOME || "~");
        const result = mergeWorktree(projectPath, prevTask.id.slice(0, 8));
        if (!result.success) {
          // Revert to verify, explain the conflict
          await moveTask(id, taskId, "verify", 0);
          await updateTask(id, taskId, { findings: result.error });
          await processQueue(id);
          return NextResponse.json({ success: false, error: result.error });
        }
        await updateTask(id, taskId, { worktreePath: undefined, branch: undefined });
      }
      scheduleCleanup(id, taskId);
    }
  }

  await processQueue(id);

  return NextResponse.json({ success: true });
}
