import { NextResponse } from "next/server";
import { getTask, getTaskReport, writeTaskReport } from "@/lib/db";
import { safeParseBody } from "@/lib/api-utils";
import type { TaskReport } from "@/lib/types";

type Params = { params: Promise<{ id: string; taskId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id, taskId } = await params;
  const task = await getTask(id, taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  const report = await getTaskReport(id, taskId);
  if (!report) {
    return NextResponse.json({ error: "No report found" }, { status: 404 });
  }
  return NextResponse.json(report);
}

export async function PUT(request: Request, { params }: Params) {
  const { id, taskId } = await params;
  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;

  const task = await getTask(id, taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const report: TaskReport = {
    taskId: body.taskId || taskId,
    title: body.title || "",
    summary: body.summary || "",
    nextSteps: body.nextSteps,
    commitHashes: body.commitHashes,
    timestamp: body.timestamp || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writeTaskReport(id, taskId, report);
  return NextResponse.json(report);
}
