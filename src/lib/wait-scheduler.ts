/**
 * In-session sleep scheduler.
 *
 * Owns a per-task registry of pending wakeups. When a timer fires, the agent
 * session is resumed via continueSession() with a synthetic followup
 * describing the wakeup. State is persisted on the Task row (`pendingWait`)
 * so wakeups survive proq restarts.
 *
 * Backs the `mcp__proq__sleep` tool — the only entry point today.
 */
import { getAllProjects, getAllTasks, getTask, getProject, updateTask } from "./db";
import { resolveProjectPath } from "./utils";
import { emitTaskUpdate } from "./task-events";
import { continueSession } from "./agent-session";
import type { PendingWait } from "./types";

const MAX_SLEEP_SECONDS = 86_400; // 1 day
const MIN_SLEEP_SECONDS = 5;

// ── Singleton attached to globalThis to survive HMR ──
const g = globalThis as unknown as {
  __proqWaitTimers?: Map<string, NodeJS.Timeout>;
};
if (!g.__proqWaitTimers) g.__proqWaitTimers = new Map();
const timers = g.__proqWaitTimers;

function clearTimer(taskId: string) {
  const t = timers.get(taskId);
  if (t) {
    clearTimeout(t);
    timers.delete(taskId);
  }
}

/** Build the synthetic followup the resumed agent will see. */
function buildWakeupMessage(wait: PendingWait): string {
  const note = wait.message ? ` Note: ${JSON.stringify(wait.message)}.` : "";
  return `⏰ Wakeup after ${wait.seconds}s.${note}`;
}

/** Resolve the cwd a continueSession should run in (worktree or project root). */
async function resolveCwd(projectId: string, taskId: string): Promise<string | undefined> {
  const task = await getTask(projectId, taskId);
  if (task?.worktreePath) return task.worktreePath;
  const project = await getProject(projectId);
  return project ? resolveProjectPath(project.path) : undefined;
}

async function fire(projectId: string, taskId: string) {
  timers.delete(taskId);

  const task = await getTask(projectId, taskId);
  const wait = task?.pendingWait;
  if (!task || !wait) {
    // Already cancelled / consumed.
    return;
  }

  // Done tasks don't get woken up. Clear the stale wait silently.
  if (task.status !== "in-progress" && task.status !== "verify") {
    await updateTask(projectId, taskId, { pendingWait: undefined });
    return;
  }

  // Clear pendingWait BEFORE resume so a re-entrant register-during-fire
  // can't be clobbered, and so the UI sees the wakeup state immediately.
  await updateTask(projectId, taskId, { pendingWait: undefined });

  const cwd = await resolveCwd(projectId, taskId);
  if (!cwd) {
    console.error(`[wait-scheduler] no cwd for task ${taskId.slice(0, 8)}; dropping wakeup`);
    return;
  }

  // Move task back to in-progress so the UI shows "Agent working" again.
  await updateTask(projectId, taskId, { status: "in-progress", agentStatus: "running" });
  emitTaskUpdate(projectId, taskId, { status: "in-progress", agentStatus: "running", pendingWait: undefined });

  try {
    await continueSession(projectId, taskId, buildWakeupMessage(wait), cwd);
    console.log(`[wait-scheduler] woke task ${taskId.slice(0, 8)} after ${wait.seconds}s`);
  } catch (err) {
    // Most common cause: agent is still mid-turn. Log and move on.
    console.error(
      `[wait-scheduler] failed to resume task ${taskId.slice(0, 8)}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

function arm(projectId: string, taskId: string, fireAt: number) {
  clearTimer(taskId);
  const delay = Math.max(0, fireAt - Date.now());
  const handle = setTimeout(() => {
    void fire(projectId, taskId);
  }, delay);
  timers.set(taskId, handle);
}

/**
 * Register (or replace) a sleep wakeup for the given task. Returns the
 * persisted PendingWait so the API route can echo it back.
 */
export async function registerSleep(
  projectId: string,
  taskId: string,
  seconds: number,
  message?: string,
): Promise<PendingWait> {
  if (!Number.isFinite(seconds)) {
    throw new Error("seconds must be a number");
  }
  const clamped = Math.min(MAX_SLEEP_SECONDS, Math.max(MIN_SLEEP_SECONDS, Math.floor(seconds)));

  const task = await getTask(projectId, taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const wait: PendingWait = {
    kind: "sleep",
    seconds: clamped,
    message: message?.trim() || undefined,
    fireAt: Date.now() + clamped * 1000,
    scheduledAt: new Date().toISOString(),
  };

  await updateTask(projectId, taskId, { pendingWait: wait });
  emitTaskUpdate(projectId, taskId, { pendingWait: wait });
  arm(projectId, taskId, wait.fireAt);
  return wait;
}

/**
 * Cancel any pending wait for this task. Safe to call when nothing is pending.
 * Called from manual followups, task abort, and replace-on-register.
 */
export async function cancelWait(projectId: string, taskId: string): Promise<void> {
  clearTimer(taskId);
  const task = await getTask(projectId, taskId);
  if (task?.pendingWait) {
    await updateTask(projectId, taskId, { pendingWait: undefined });
    emitTaskUpdate(projectId, taskId, { pendingWait: undefined });
  }
}

/**
 * Re-arm timers from disk on server boot. Sleeps that should have fired
 * during downtime fire immediately.
 */
export async function bootstrap(): Promise<void> {
  try {
    const projects = await getAllProjects();
    let armed = 0;
    for (const project of projects) {
      const columns = await getAllTasks(project.id);
      for (const status of ["in-progress", "verify"] as const) {
        for (const task of columns[status]) {
          if (task.pendingWait?.kind === "sleep") {
            arm(project.id, task.id, task.pendingWait.fireAt);
            armed++;
          }
        }
      }
    }
    if (armed > 0) {
      console.log(`[wait-scheduler] bootstrapped ${armed} pending wait(s)`);
    }
  } catch (err) {
    console.error("[wait-scheduler] bootstrap failed:", err);
  }
}
