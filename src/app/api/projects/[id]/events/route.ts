import { onTaskEvent } from "@/lib/task-events";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // stream closed
        }
      };

      // Heartbeat every 30s to keep the connection alive
      const heartbeat = setInterval(() => send("heartbeat"), 30_000);

      // Listen for task events on this project
      const unsubscribe = onTaskEvent((event) => {
        if (event.projectId !== id) return;
        if (event.type === 'project_update') {
          send(JSON.stringify({ type: 'project_update', changes: event.changes }));
        } else if (event.type === 'created') {
          send(JSON.stringify({ type: 'created', task: event.task }));
        } else {
          send(JSON.stringify({ taskId: event.taskId, changes: event.changes }));
        }
      });

      // Clean up on client disconnect
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
