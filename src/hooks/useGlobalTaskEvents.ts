import { useEffect, useRef } from 'react';

export interface GlobalTaskUpdateEvent {
  type: 'update';
  projectId: string;
  taskId: string;
  changes: Record<string, unknown>;
}

export interface GlobalTaskCreatedEvent {
  type: 'created';
  projectId: string;
  task: Record<string, unknown>;
}

export interface GlobalProjectUpdateEvent {
  type: 'project_update';
  projectId: string;
  changes: Record<string, unknown>;
}

export type GlobalSSEEvent = GlobalTaskUpdateEvent | GlobalTaskCreatedEvent | GlobalProjectUpdateEvent;

/**
 * Subscribe to the global SSE stream for task events across all projects.
 * Used by ProjectsProvider to keep sidebar task counts fresh.
 */
export function useGlobalTaskEvents(
  onEvent: (event: GlobalSSEEvent) => void,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;

      es?.close();
      es = new EventSource('/api/events');

      es.onmessage = (event) => {
        if (event.data === 'heartbeat') return;
        try {
          const parsed = JSON.parse(event.data);
          onEventRef.current(parsed as GlobalSSEEvent);
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
  }, []);
}
