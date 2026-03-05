import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/db";
import { invalidateClaudeBinCache } from "@/lib/claude-bin";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  const body = await request.json();
  if ("claudeBin" in body) {
    invalidateClaudeBinCache();
  }
  const updated = await updateSettings(body);
  return NextResponse.json(updated);
}
