import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/db";
import { invalidateClaudeBinCache } from "@/lib/claude-bin";
import { safeParseBody } from "@/lib/api-utils";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;
  if ("claudeBin" in body) {
    invalidateClaudeBinCache();
  }
  const updated = await updateSettings(body);
  return NextResponse.json(updated);
}
