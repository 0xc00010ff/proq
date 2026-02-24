import { NextRequest, NextResponse } from "next/server";
import {
  getSupervisorChatLog,
  addSupervisorMessage,
  clearSupervisorChatLog,
} from "@/lib/db";
import { runSupervisor, type SupervisorChunk } from "@/lib/supervisor";
import type { ToolCall } from "@/lib/types";

export async function GET() {
  const chatLog = await getSupervisorChatLog();
  return NextResponse.json({ chatLog });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const message = body.message as string | undefined;
  if (!message?.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // Save user message
  await addSupervisorMessage({ role: "user", message: message.trim() });

  // Get history for context
  const history = await getSupervisorChatLog();

  // Create abort controller tied to request
  const abortController = new AbortController();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Run async work without blocking the stream from becoming ready
      (async () => {
        let fullText = "";
        const toolCalls: ToolCall[] = [];

        try {
          for await (const chunk of runSupervisor(
            history.slice(0, -1), // exclude the user message we just added
            message.trim(),
            abortController.signal,
          )) {
            // Accumulate for persistence
            if (chunk.type === "text_delta") {
              fullText += chunk.text;
            } else if (chunk.type === "tool_call") {
              toolCalls.push({ action: chunk.action, detail: chunk.detail });
            } else if (chunk.type === "result" && !fullText) {
              fullText = chunk.text;
            }

            // Stream to client
            controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
          }
        } catch (err) {
          const errorChunk: SupervisorChunk = {
            type: "error",
            error: String(err),
          };
          controller.enqueue(encoder.encode(JSON.stringify(errorChunk) + "\n"));
        }

        // Persist the supervisor response
        if (fullText.trim() || toolCalls.length > 0) {
          await addSupervisorMessage({
            role: "proq",
            message: fullText.trim() || "(tool calls only)",
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          });
        }

        controller.close();
      })().catch((err) => {
        controller.error(err);
      });
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function DELETE() {
  await clearSupervisorChatLog();
  return NextResponse.json({ ok: true });
}
