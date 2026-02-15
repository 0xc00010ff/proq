import { NextResponse } from "next/server";
import { spawnPty } from "@/lib/pty-server";

export async function POST(request: Request) {
  const { tabId, cmd, cwd } = await request.json();

  if (!tabId) {
    return NextResponse.json({ error: "tabId is required" }, { status: 400 });
  }

  spawnPty(tabId, cmd, cwd);
  return NextResponse.json({ tabId });
}
