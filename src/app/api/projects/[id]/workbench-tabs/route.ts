import { NextResponse } from "next/server";
import { getWorkbenchTabs, setWorkbenchTabs } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const scope = new URL(request.url).searchParams.get("scope") || undefined;
  const { tabs, activeTabId } = await getWorkbenchTabs(id, scope);
  return NextResponse.json({ tabs, activeTabId });
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const scope = new URL(request.url).searchParams.get("scope") || undefined;
  const body = await request.json();
  const tabs = Array.isArray(body.tabs) ? body.tabs : [];
  const activeTabId = body.activeTabId || undefined;
  await setWorkbenchTabs(id, tabs, activeTabId, scope);
  return NextResponse.json({ tabs, activeTabId });
}
