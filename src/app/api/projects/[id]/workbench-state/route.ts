import { NextResponse } from "next/server";
import { getWorkbenchState, setWorkbenchState } from "@/lib/db";
import { safeParseBody } from "@/lib/api-utils";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const state = await getWorkbenchState(id);
  return NextResponse.json(state);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;
  await setWorkbenchState(id, body);
  const state = await getWorkbenchState(id);
  return NextResponse.json(state);
}
