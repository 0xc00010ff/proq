import { onTaskEvent } from "@/lib/task-events";
import { subscribeWatcher, unsubscribeWatcher } from "@/lib/file-watcher";
import { getProject } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const project = await getProject(id);
  if (!project) {
    return new Response("project not found", { status: 404 });
  }

  let subscribed = false;
  try {
    await subscribeWatcher(id, project.path);
    subscribed = true;
  } catch (err) {
    console.error(`[file-events] failed to start watcher for ${id}:`, err);
  }

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
        if (event.type !== 'file_change') return;
        if (event.projectId !== id) return;
        send(JSON.stringify({ type: 'file_change', path: event.path, kind: event.kind }));
      });

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        if (subscribed) {
          unsubscribeWatcher(id).catch((err) =>
            console.error(`[file-events] failed to stop watcher for ${id}:`, err),
          );
          subscribed = false;
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", cleanup);
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
