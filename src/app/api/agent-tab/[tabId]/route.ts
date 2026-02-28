import { NextResponse } from "next/server";
import { clearAgentTabSession } from "@/lib/agent-tab-runtime";

type Params = { params: Promise<{ tabId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const { tabId } = await params;
  clearAgentTabSession(tabId);
  return NextResponse.json({ success: true });
}
