// Targeted task-update event bus. Server-initiated changes only.
// Attached to globalThis for HMR safety.

export interface TaskUpdate {
  projectId: string;
  taskId: string;
  changes: Record<string, unknown>;
}

const g = globalThis as unknown as {
  __proqTaskListeners?: Set<(update: TaskUpdate) => void>;
};
if (!g.__proqTaskListeners) g.__proqTaskListeners = new Set();

const listeners = g.__proqTaskListeners;

export function emitTaskUpdate(projectId: string, taskId: string, changes: Record<string, unknown>) {
  const update: TaskUpdate = { projectId, taskId, changes };
  for (const fn of listeners) {
    try {
      fn(update);
    } catch {
      // listener error — ignore
    }
  }
}

export function onTaskUpdate(fn: (update: TaskUpdate) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
