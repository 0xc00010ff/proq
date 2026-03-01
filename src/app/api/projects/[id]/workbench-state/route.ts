import { NextResponse } from "next/server";
import { getWorkbenchState, setWorkbenchState } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const state = await getWorkbenchState(id);
  return NextResponse.json(state);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json();
  await setWorkbenchState(id, body);
  const state = await getWorkbenchState(id);
  return NextResponse.json(state);
}
