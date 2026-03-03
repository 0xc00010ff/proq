import { useEffect, useRef } from 'react';

export interface TaskUpdateEvent {
  taskId: string;
  changes: Record<string, unknown>;
}

/**
 * Subscribe to SSE task-update events for a project.
 * Each event carries {taskId, changes} — the callback merges
 * those fields into local state. No fetching involved.
 */
export function useTaskEvents(
  projectId: string | undefined,
  onUpdate: (event: TaskUpdateEvent) => void,
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!projectId) return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;

      es = new EventSource(`/api/projects/${projectId}/events`);

      es.onmessage = (event) => {
        if (event.data === 'heartbeat') return;
        try {
          const parsed: TaskUpdateEvent = JSON.parse(event.data);
          if (parsed.taskId && parsed.changes) {
            onUpdateRef.current(parsed);
          }
        } catch {
          // ignore unparseable events
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 3_000);
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [projectId]);
}
