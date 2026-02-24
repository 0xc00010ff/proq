import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/db";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const updated = await updateSettings(body);
  return NextResponse.json(updated);
}
