import { NextResponse } from "next/server";
import { getTerminalTabs, setTerminalTabs } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const { tabs, activeTabId } = await getTerminalTabs(id);
  return NextResponse.json({ tabs, activeTabId });
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json();
  const tabs = Array.isArray(body.tabs) ? body.tabs : [];
  const activeTabId = body.activeTabId || undefined;
  await setTerminalTabs(id, tabs, activeTabId);
  return NextResponse.json({ tabs, activeTabId });
}
