import { NextResponse } from "next/server";
import { updateSettings } from "@/lib/db";
import { detectClaudeBin, invalidateClaudeBinCache } from "@/lib/claude-bin";

export async function POST() {
  const claudeBin = await detectClaudeBin();
  const resolved = claudeBin !== "claude";

  await updateSettings({ claudeBin });
  invalidateClaudeBinCache();

  return NextResponse.json({
    claudeBin,
    resolved,
    message: resolved
      ? `Found Claude at ${claudeBin}`
      : "Could not auto-detect — using bare \"claude\" (must be on PATH)",
  });
}
