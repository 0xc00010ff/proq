import { NextResponse } from "next/server";
import { safeParseBody } from "@/lib/api-utils";
import { registerSleep, cancelWait } from "@/lib/wait-scheduler";

type Params = { params: Promise<{ id: string; taskId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, taskId } = await params;
  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;

  const seconds = Number(body.seconds);
  if (!Number.isFinite(seconds)) {
    return NextResponse.json({ error: "seconds is required" }, { status: 400 });
  }

  try {
    const wait = await registerSleep(id, taskId, seconds, body.message);
    return NextResponse.json({ pendingWait: wait });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id, taskId } = await params;
  await cancelWait(id, taskId);
  return NextResponse.json({ ok: true });
}
