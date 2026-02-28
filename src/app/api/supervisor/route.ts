import { NextResponse } from "next/server";
import { clearSupervisorSessionData } from "@/lib/supervisor-runtime";

export async function DELETE() {
  await clearSupervisorSessionData();
  return NextResponse.json({ ok: true });
}
