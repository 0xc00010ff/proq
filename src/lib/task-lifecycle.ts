/**
 * Shared task status-transition side effects.
 *
 * Both the PATCH (single-task) and PUT (reorder/drag-drop) routes call these
 * helpers so that merge, cleanup, and reset logic lives in one place.
 */
import type { Task } from "./types";
import { updateTask, getProject, getProjectDefaultBranch, deleteTaskSession, getSettings, getTask } from "./db";
import { abortTask, getInitialAgentStatus, scheduleCleanup, cancelCleanup } from "./agent-dispatch";
import { clearSession } from "./agent-session";
import { emitTaskUpdate } from "./task-events";
import { mergeWorktree, removeWorktree, ensureNotOnTaskBranch, ensureOnMainForMerge, popAutoStash } from "./worktree";
import { resolveProjectPath } from "./utils";

/** Fields reset when a task returns to todo. */
const TODO_RESET_FIELDS = {
  agentStatus: null as Task["agentStatus"],
  summary: "",
  nextSteps: "",
  agentLog: "",
  needsAttention: undefined as boolean | undefined,
  worktreePath: undefined as string | undefined,
  branch: undefined as string | undefined,
  baseBranch: undefined as string | undefined,
  mergeConflict: undefined as Task["mergeConflict"],
  renderMode: undefined as Task["renderMode"],
  sessionId: undefined as Task["sessionId"],
};

function taskBranchName(task: Task): string {
  return task.branch || `proq/${task.id.slice(0, 8)}`;
}

// ── Transition helpers ──────────────────────────────────────────────

/** → in-progress: cancel cleanup, set initial agentStatus + renderMode. */
export async function initForDispatch(
  projectId: string,
  taskId: string,
  task: Task,
  prevStatus: Task["status"],
): Promise<Partial<Task>> {
  cancelCleanup(taskId);
  if (prevStatus !== "verify" && prevStatus !== "done") {
    const settings = await getSettings();
    const agentStatus = await getInitialAgentStatus(projectId, taskId);
    const renderMode = task.renderMode || settings.agentRenderMode || "structured";
    await updateTask(projectId, taskId, { agentStatus, renderMode });
    emitTaskUpdate(projectId, taskId, { agentStatus });
    return { agentStatus, renderMode };
  }
  return {};
}

/** → todo: tear down worktree, reset fields, abort if was running. */
export async function resetToTodo(
  projectId: string,
  taskId: string,
  prevTask: Task,
): Promise<typeof TODO_RESET_FIELDS> {
  cancelCleanup(taskId);

  if (prevTask.worktreePath || prevTask.branch) {
    const proj = await getProject(projectId);
    if (proj) {
      const projectPath = resolveProjectPath(proj.path);
      const defaultBr = await getProjectDefaultBranch(projectId);
      try {
        ensureNotOnTaskBranch(projectPath, taskBranchName(prevTask), defaultBr);
      } catch { /* best effort */ }
      removeWorktree(projectPath, prevTask.id.slice(0, 8));
      popAutoStash(projectPath, prevTask.baseBranch || defaultBr);
    }
  }

  await updateTask(projectId, taskId, TODO_RESET_FIELDS);
  await deleteTaskSession(projectId, taskId);

  if (prevTask.status === "in-progress") {
    await abortTask(projectId, taskId);
  }

  return TODO_RESET_FIELDS;
}

/** Remove worktree/branch for a task being deleted (no merge). */
export async function cleanupDeletedTask(
  projectId: string,
  task: Task,
): Promise<void> {
  if (task.worktreePath || task.branch) {
    const proj = await getProject(projectId);
    if (proj) {
      const projectPath = resolveProjectPath(proj.path);
      const defaultBr = await getProjectDefaultBranch(projectId);
      try {
        ensureNotOnTaskBranch(projectPath, taskBranchName(task), defaultBr);
      } catch { /* best effort */ }
      removeWorktree(projectPath, task.id.slice(0, 8));
      popAutoStash(projectPath, task.baseBranch || defaultBr);
    }
  }

  if (task.renderMode !== "cli") {
    clearSession(task.id);
  }

  await deleteTaskSession(projectId, task.id);

  if (task.status === "in-progress") {
    await abortTask(projectId, task.id);
  }
}

export type MergeResult =
  | { success: true }
  | { success: false; task: Task };

/**
 * Merge a task's worktree branch into its base branch and clean up.
 *
 * On conflict the task is moved back to verify with mergeConflict info.
 * Returns `{ success: false, task }` so the caller can return the updated task.
 *
 * `moveToVerify` is an optional callback for the reorder route, which needs
 * to call `moveTask()` instead of just `updateTask()`.
 */
export async function mergeAndComplete(
  projectId: string,
  taskId: string,
  prevTask: Task,
  moveToVerify?: () => Promise<void>,
): Promise<MergeResult> {
  if (prevTask.worktreePath || prevTask.branch) {
    const proj = await getProject(projectId);
    if (proj) {
      const projectPath = resolveProjectPath(proj.path);
      const mergeBranch = prevTask.baseBranch || await getProjectDefaultBranch(projectId);
      try {
        ensureOnMainForMerge(projectPath, taskBranchName(prevTask), mergeBranch);
      } catch { /* best effort */ }

      const result = mergeWorktree(projectPath, prevTask.id.slice(0, 8));
      popAutoStash(projectPath, mergeBranch);

      if (!result.success) {
        if (moveToVerify) await moveToVerify();
        await updateTask(projectId, taskId, {
          status: "verify",
          mergeConflict: {
            error: result.error || "Merge conflict",
            files: result.conflictFiles || [],
            branch: taskBranchName(prevTask),
            diff: result.diff,
          },
        });
        const fresh = await getTask(projectId, taskId);
        return { success: false, task: fresh! };
      }

      await updateTask(projectId, taskId, {
        worktreePath: undefined,
        branch: undefined,
        baseBranch: undefined,
        mergeConflict: undefined,
        agentStatus: null,
        needsAttention: undefined,
      });
    }
  }

  await updateTask(projectId, taskId, { agentStatus: null, needsAttention: undefined });
  scheduleCleanup(projectId, taskId);
  clearSession(taskId);

  return { success: true };
}
