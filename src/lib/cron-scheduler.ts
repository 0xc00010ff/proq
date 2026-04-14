import { getAllProjects, getCronJobs, updateCronJob, createTask, getTask, updateTask } from "./db";
import { initForDispatch } from "./task-lifecycle";
import { processQueue } from "./agent-dispatch";
import { emitTaskCreated, emitTaskUpdate } from "./task-events";
import type { CronJob } from "./types";

// ── Cron expression parser ──────────────────────────────────

function parseCronField(field: string, min: number, max: number): number[] | null {
  if (field === "*") return null; // matches all
  const values: number[] = [];

  for (const part of field.split(",")) {
    // Step: */n or range/n
    const stepMatch = part.match(/^(\*|(\d+)-(\d+))\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[4]);
      const start = stepMatch[2] ? parseInt(stepMatch[2]) : min;
      const end = stepMatch[3] ? parseInt(stepMatch[3]) : max;
      for (let i = start; i <= end; i += step) values.push(i);
      continue;
    }

    // Range: n-m
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]);
      const end = parseInt(rangeMatch[2]);
      for (let i = start; i <= end; i++) values.push(i);
      continue;
    }

    // Single value
    const num = parseInt(part);
    if (!isNaN(num)) values.push(num);
  }

  return values.length > 0 ? values : null;
}

interface ParsedCron {
  minutes: number[] | null;
  hours: number[] | null;
  daysOfMonth: number[] | null;
  months: number[] | null;
  daysOfWeek: number[] | null;
}

const DOW_NAMES: Record<string, string> = {
  sun: "0", mon: "1", tue: "2", wed: "3", thu: "4", fri: "5", sat: "6",
};

const MONTH_NAMES: Record<string, string> = {
  jan: "1", feb: "2", mar: "3", apr: "4", may: "5", jun: "6",
  jul: "7", aug: "8", sep: "9", oct: "10", nov: "11", dec: "12",
};

function normalizeCronExpression(schedule: string): string {
  let s = schedule.trim().toLowerCase();

  // Friendly shortcuts
  if (s === "hourly" || s === "every hour" || s === "every 1h") return "0 * * * *";
  if (s === "daily" || s === "every day") return "0 0 * * *";
  if (s === "weekly" || s === "every week") return "0 0 * * 0";

  // "every Xm" → */X * * * *
  const everyMinMatch = s.match(/^every\s+(\d+)\s*m(?:in(?:ute)?s?)?$/);
  if (everyMinMatch) return `*/${everyMinMatch[1]} * * * *`;

  // "every Xh" → 0 */X * * *
  const everyHourMatch = s.match(/^every\s+(\d+)\s*h(?:(?:ou)?rs?)?$/);
  if (everyHourMatch) return `0 */${everyHourMatch[1]} * * *`;

  // "daily at Xam/pm" or "every day at X:XX"
  const dailyAtMatch = s.match(/^(?:daily|every\s+day)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (dailyAtMatch) {
    let hour = parseInt(dailyAtMatch[1]);
    const min = dailyAtMatch[2] ? parseInt(dailyAtMatch[2]) : 0;
    if (dailyAtMatch[3] === "pm" && hour < 12) hour += 12;
    if (dailyAtMatch[3] === "am" && hour === 12) hour = 0;
    return `${min} ${hour} * * *`;
  }

  // "every mon/tue/... at X"
  const weeklyAtMatch = s.match(/^every\s+(sun|mon|tue|wed|thu|fri|sat)\w*\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (weeklyAtMatch) {
    const dow = DOW_NAMES[weeklyAtMatch[1]];
    let hour = parseInt(weeklyAtMatch[2]);
    const min = weeklyAtMatch[3] ? parseInt(weeklyAtMatch[3]) : 0;
    if (weeklyAtMatch[4] === "pm" && hour < 12) hour += 12;
    if (weeklyAtMatch[4] === "am" && hour === 12) hour = 0;
    return `${min} ${hour} * * ${dow}`;
  }

  // Replace day-of-week names in standard cron
  for (const [name, num] of Object.entries(DOW_NAMES)) {
    s = s.replace(new RegExp(`\\b${name}\\w*`, "g"), num);
  }
  for (const [name, num] of Object.entries(MONTH_NAMES)) {
    s = s.replace(new RegExp(`\\b${name}\\w*`, "g"), num);
  }

  return s;
}

export function parseCron(schedule: string): ParsedCron | null {
  const normalized = normalizeCronExpression(schedule);
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) return null;

  return {
    minutes: parseCronField(parts[0], 0, 59),
    hours: parseCronField(parts[1], 0, 23),
    daysOfMonth: parseCronField(parts[2], 1, 31),
    months: parseCronField(parts[3], 1, 12),
    daysOfWeek: parseCronField(parts[4], 0, 6),
  };
}

function matchesCron(cron: ParsedCron, date: Date): boolean {
  const min = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay();

  if (cron.minutes && !cron.minutes.includes(min)) return false;
  if (cron.hours && !cron.hours.includes(hour)) return false;
  if (cron.daysOfMonth && !cron.daysOfMonth.includes(dom)) return false;
  if (cron.months && !cron.months.includes(month)) return false;
  if (cron.daysOfWeek && !cron.daysOfWeek.includes(dow)) return false;
  return true;
}

/** Compute next run time from a cron schedule string. */
export function computeNextRun(schedule: string, after?: Date): string | undefined {
  const cron = parseCron(schedule);
  if (!cron) return undefined;
  const start = after ? new Date(after) : new Date();
  // Start from the next minute
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  // Search up to 366 days ahead
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit; i++) {
    if (matchesCron(cron, start)) return start.toISOString();
    start.setMinutes(start.getMinutes() + 1);
  }
  return undefined;
}

// ── Scheduler engine ────────────────────────────────────────

const TICK_MS = 60_000;
const DISPATCH_DELAY_MS = 5_000; // grace period: task sits in todo for 5s

const g = globalThis as unknown as {
  __proqCronTimer?: NodeJS.Timeout;
  __proqCronLastFired?: Map<string, number>; // cronJobId -> epoch minute
};

async function tick() {
  const now = new Date();
  const epochMinute = Math.floor(now.getTime() / 60_000);

  if (!g.__proqCronLastFired) g.__proqCronLastFired = new Map();

  try {
    const projects = await getAllProjects();
    for (const project of projects) {
      const cronJobs = await getCronJobs(project.id);
      for (const job of cronJobs) {
        if (!job.enabled) continue;

        // Don't fire same job twice in the same minute
        if (g.__proqCronLastFired.get(job.id) === epochMinute) continue;

        const cron = parseCron(job.schedule);
        if (!cron) continue;
        if (!matchesCron(cron, now)) continue;

        g.__proqCronLastFired.set(job.id, epochMinute);
        fireCronJob(project.id, project.name, job).catch((err) => {
          console.error(`[cron] failed to fire ${job.name} for ${project.id}:`, err);
        });
      }
    }
  } catch (err) {
    console.error("[cron] tick error:", err);
  }
}

async function fireCronJob(projectId: string, projectName: string, job: CronJob) {
  console.log(`[cron] firing "${job.name}" for project ${projectId}`);

  // Create the task in todo
  const task = await createTask(projectId, {
    title: job.name,
    description: job.prompt,
    mode: job.mode ?? "auto",
    agentId: job.agentId,
  });

  // Tag with cronJobId
  await updateTask(projectId, task.id, { cronJobId: job.id });
  task.cronJobId = job.id;

  emitTaskCreated(projectId, task as unknown as Record<string, unknown>);

  // Update cron job tracking
  const nextRun = computeNextRun(job.schedule);
  await updateCronJob(projectId, job.id, {
    lastRunAt: new Date().toISOString(),
    lastTaskId: task.id,
    runCount: job.runCount + 1,
    nextRunAt: nextRun,
  });

  // Grace period: wait 5s in todo so user can cancel if they happen to be watching
  setTimeout(async () => {
    try {
      // Re-check: if task was deleted or moved by user during grace period, skip
      const current = await getTask(projectId, task.id);
      if (!current || current.status !== "todo") return;

      // Move to in-progress and dispatch
      await updateTask(projectId, task.id, { status: "in-progress" });
      const changes = await initForDispatch(projectId, task.id, { ...current, status: "in-progress" }, "todo");
      if (changes.agentStatus) {
        emitTaskUpdate(projectId, task.id, { status: "in-progress", ...changes });
      }
      await processQueue(projectId);
    } catch (err) {
      console.error(`[cron] failed to dispatch task for "${job.name}":`, err);
    }
  }, DISPATCH_DELAY_MS);
}

export function ensureCronSchedulerStarted() {
  if (g.__proqCronTimer) return;
  console.log("[cron] scheduler started (60s tick)");
  g.__proqCronTimer = setInterval(tick, TICK_MS);
  // Also run a tick immediately to catch any jobs that should fire now
  tick();
}

export function stopCronScheduler() {
  if (g.__proqCronTimer) {
    clearInterval(g.__proqCronTimer);
    g.__proqCronTimer = undefined;
    console.log("[cron] scheduler stopped");
  }
}
