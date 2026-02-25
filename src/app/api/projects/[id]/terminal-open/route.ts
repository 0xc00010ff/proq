import { NextResponse } from "next/server";
import { getTerminalOpen, setTerminalOpen, getTerminalHeight, setTerminalHeight } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const open = await getTerminalOpen(id);
  const height = await getTerminalHeight(id);
  return NextResponse.json({ open, height });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json();
  if (body.open !== undefined) {
    await setTerminalOpen(id, Boolean(body.open));
  }
  if (typeof body.height === 'number') {
    await setTerminalHeight(id, body.height);
  }
  const open = await getTerminalOpen(id);
  const height = await getTerminalHeight(id);
  return NextResponse.json({ open, height });
}
