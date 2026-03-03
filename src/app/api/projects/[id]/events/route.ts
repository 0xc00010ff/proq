import { onTaskUpdate } from "@/lib/task-events";

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

      // Listen for targeted task updates on this project
      const unsubscribe = onTaskUpdate((update) => {
        if (update.projectId === id) {
          send(JSON.stringify({ taskId: update.taskId, changes: update.changes }));
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
