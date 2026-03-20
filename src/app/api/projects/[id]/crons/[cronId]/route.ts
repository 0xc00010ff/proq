import { NextResponse } from "next/server";
import { getProject, updateCronJob, deleteCronJob } from "@/lib/db";
import { computeNextRun } from "@/lib/cron-scheduler";
import { safeParseBody } from "@/lib/api-utils";

type Params = { params: Promise<{ id: string; cronId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, cronId } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;

  // Recompute nextRunAt if schedule changed
  if (body.schedule) {
    body.nextRunAt = computeNextRun(body.schedule);
  }

  const updated = await updateCronJob(id, cronId, body);
  if (!updated) {
    return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id, cronId } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const deleted = await deleteCronJob(id, cronId);
  if (!deleted) {
    return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
