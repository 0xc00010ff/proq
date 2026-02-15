import { NextResponse } from "next/server";
import { killPty } from "@/lib/pty-server";

type Params = { params: { tabId: string } };

export async function DELETE(_request: Request, { params }: Params) {
  killPty(params.tabId);
  return NextResponse.json({ success: true });
}
