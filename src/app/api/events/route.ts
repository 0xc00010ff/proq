import { onTaskEvent } from "@/lib/task-events";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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

      const heartbeat = setInterval(() => send("heartbeat"), 30_000);

      const unsubscribe = onTaskEvent((event) => {
        if (event.type === "project_update") {
          send(JSON.stringify({ type: "project_update", projectId: event.projectId, changes: event.changes }));
        } else if (event.type === "created") {
          send(JSON.stringify({ type: "created", projectId: event.projectId, task: event.task }));
        } else if (event.type === "update") {
          send(JSON.stringify({ type: "update", projectId: event.projectId, taskId: event.taskId, changes: event.changes }));
        }
        // file_change events are not forwarded on this global task stream.
      });

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
