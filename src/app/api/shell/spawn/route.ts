import { NextResponse } from "next/server";
import { spawnShellSession } from "@/lib/pty-server";
import { safeParseBody } from "@/lib/api-utils";

export async function POST(request: Request) {
  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;
  const { tabId, cmd, cwd } = body;

  if (!tabId) {
    return NextResponse.json({ error: "tabId is required" }, { status: 400 });
  }

  const ok = spawnShellSession(tabId, cmd, cwd);
  if (!ok) {
    return NextResponse.json({ error: "Failed to spawn terminal" }, { status: 500 });
  }
  return NextResponse.json({ tabId });
}
