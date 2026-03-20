// Targeted task event bus. Server-initiated changes only.
// Attached to globalThis for HMR safety.

export interface TaskUpdate {
  type: 'update';
  projectId: string;
  taskId: string;
  changes: Record<string, unknown>;
}

export interface TaskCreated {
  type: 'created';
  projectId: string;
  task: Record<string, unknown>;
}

export interface ProjectUpdate {
  type: 'project_update';
  projectId: string;
  changes: Record<string, unknown>;
}

export type TaskEvent = TaskUpdate | TaskCreated | ProjectUpdate;

const g = globalThis as unknown as {
  __proqTaskListeners?: Set<(event: TaskEvent) => void>;
};
if (!g.__proqTaskListeners) g.__proqTaskListeners = new Set();

const listeners = g.__proqTaskListeners;

function emit(event: TaskEvent) {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {
      // listener error — ignore
    }
  }
}

export function emitTaskUpdate(projectId: string, taskId: string, changes: Record<string, unknown>) {
  emit({ type: 'update', projectId, taskId, changes });
}

export function emitTaskCreated(projectId: string, task: Record<string, unknown>) {
  emit({ type: 'created', projectId, task });
}

export function emitProjectUpdate(projectId: string, changes: Record<string, unknown>) {
  emit({ type: 'project_update', projectId, changes });
}

export function onTaskEvent(fn: (event: TaskEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** @deprecated Use onTaskEvent instead */
export const onTaskUpdate = onTaskEvent;
