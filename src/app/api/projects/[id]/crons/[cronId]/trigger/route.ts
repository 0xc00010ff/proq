import { NextResponse } from "next/server";
import { getProject, getCronJobs, createTask, getTask, updateTask, updateCronJob } from "@/lib/db";
import { initForDispatch } from "@/lib/task-lifecycle";
import { processQueue } from "@/lib/agent-dispatch";
import { emitTaskCreated, emitTaskUpdate } from "@/lib/task-events";
import { computeNextRun } from "@/lib/cron-scheduler";

type Params = { params: Promise<{ id: string; cronId: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { id, cronId } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const cronJobs = await getCronJobs(id);
  const job = cronJobs.find((j) => j.id === cronId);
  if (!job) {
    return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
  }

  // Create task in todo
  const task = await createTask(id, {
    title: job.name,
    description: job.prompt,
    mode: job.mode ?? "auto",
    agentId: job.agentId,
  });
  await updateTask(id, task.id, { cronJobId: job.id });
  task.cronJobId = job.id;

  emitTaskCreated(id, task as unknown as Record<string, unknown>);

  // Update cron job tracking
  const nextRun = computeNextRun(job.schedule);
  await updateCronJob(id, job.id, {
    lastRunAt: new Date().toISOString(),
    lastTaskId: task.id,
    runCount: job.runCount + 1,
    nextRunAt: nextRun,
  });

  // Grace period: 5s in todo before dispatch
  setTimeout(async () => {
    try {
      const current = await getTask(id, task.id);
      if (!current || current.status !== "todo") return;

      await updateTask(id, task.id, { status: "in-progress" });
      const changes = await initForDispatch(id, task.id, { ...current, status: "in-progress" }, "todo");
      if (changes.agentStatus) {
        emitTaskUpdate(id, task.id, { status: "in-progress", ...changes });
      }
      await processQueue(id);
    } catch (err) {
      console.error(`[cron] manual trigger dispatch failed for "${job.name}":`, err);
    }
  }, 5_000);

  return NextResponse.json({ task, message: "Task created, will dispatch in 5 seconds" }, { status: 201 });
}
