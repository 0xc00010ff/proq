import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { getSettings, updateSettings } from "@/lib/db";
import { invalidateClaudeBinCache } from "@/lib/claude-bin";
import { safeParseBody } from "@/lib/api-utils";

let _version: string | null = null;
function getVersion(): string {
  if (!_version) {
    try {
      const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
      _version = pkg.version;
    } catch {
      _version = "unknown";
    }
  }
  return _version!;
}

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ ...settings, version: getVersion() });
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
