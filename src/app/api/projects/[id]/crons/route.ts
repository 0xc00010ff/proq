import { NextResponse } from "next/server";
import { getProject, getCronJobs, createCronJob } from "@/lib/db";
import { ensureCronSchedulerStarted, computeNextRun } from "@/lib/cron-scheduler";
import { safeParseBody } from "@/lib/api-utils";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  ensureCronSchedulerStarted();
  const jobs = await getCronJobs(id);
  return NextResponse.json(jobs);
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;

  const { name, prompt, schedule, mode, enabled } = body;
  if (!name || !prompt || !schedule) {
    return NextResponse.json({ error: "name, prompt, and schedule are required" }, { status: 400 });
  }

  const nextRunAt = computeNextRun(schedule);
  const job = await createCronJob(id, { name, prompt, schedule, mode, enabled });
  if (nextRunAt) {
    const { updateCronJob } = await import("@/lib/db");
    await updateCronJob(id, job.id, { nextRunAt });
    job.nextRunAt = nextRunAt;
  }

  ensureCronSchedulerStarted();
  return NextResponse.json(job, { status: 201 });
}
