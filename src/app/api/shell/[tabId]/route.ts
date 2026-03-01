import { NextResponse } from "next/server";
import { killPty } from "@/lib/pty-server";

type Params = { params: Promise<{ tabId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const { tabId } = await params;
  killPty(tabId);
  return NextResponse.json({ success: true });
}
