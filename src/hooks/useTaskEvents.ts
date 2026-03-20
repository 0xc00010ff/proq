import { useEffect, useRef } from 'react';

export interface TaskUpdateEvent {
  taskId: string;
  changes: Record<string, unknown>;
}

export interface TaskCreatedEvent {
  type: 'created';
  task: Record<string, unknown>;
}

export interface ProjectUpdateEvent {
  type: 'project_update';
  changes: Record<string, unknown>;
}

export type TaskSSEEvent = TaskUpdateEvent | TaskCreatedEvent | ProjectUpdateEvent;

/**
 * Subscribe to SSE task events for a project.
 * - Update events carry {taskId, changes} — merged into existing tasks.
 * - Created events carry {type: 'created', task} — inserted into the todo column.
 */
export function useTaskEvents(
  projectId: string | undefined,
  onUpdate: (event: TaskUpdateEvent) => void,
  onCreated?: (event: TaskCreatedEvent) => void,
  onProjectUpdate?: (event: ProjectUpdateEvent) => void,
  onReconnect?: () => void,
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const onProjectUpdateRef = useRef(onProjectUpdate);
  onProjectUpdateRef.current = onProjectUpdate;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (!projectId) return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let hasConnectedBefore = false;

    function connect() {
      if (disposed) return;

      es?.close();
      es = new EventSource(`/api/projects/${projectId}/events`);

      es.onopen = () => {
        if (hasConnectedBefore) {
          // SSE reconnected after a drop — refresh to catch missed events
          onReconnectRef.current?.();
        }
        hasConnectedBefore = true;
      };

      // Refresh shortly after first connect to catch any events that fired
      // between the page rendering cached data and SSE becoming ready
      if (!hasConnectedBefore) {
        setTimeout(() => {
          if (!disposed) onReconnectRef.current?.();
        }, 1_000);
      }

      es.onmessage = (event) => {
        if (event.data === 'heartbeat') return;
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'project_update' && parsed.changes) {
            onProjectUpdateRef.current?.(parsed as ProjectUpdateEvent);
          } else if (parsed.type === 'created' && parsed.task) {
            onCreatedRef.current?.(parsed as TaskCreatedEvent);
          } else if (parsed.taskId && parsed.changes) {
            onUpdateRef.current(parsed as TaskUpdateEvent);
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

    // Reconnect SSE when tab becomes visible — browser may have
    // throttled or dropped the connection while backgrounded, losing
    // any events emitted during that window.
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && !disposed) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        connect();
      }
    }

    connect();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [projectId]);
}
