import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getAllProjects } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { path: dirPath } = body;

  if (!dirPath) {
    return NextResponse.json(
      { error: "path is required" },
      { status: 400 }
    );
  }

  const resolved = path.resolve(dirPath);

  // Validate path belongs to a registered project
  const projects = await getAllProjects();
  const isAllowed = projects.some((p) => resolved.startsWith(p.path));
  if (!isAllowed) {
    return NextResponse.json({ error: "path not allowed" }, { status: 403 });
  }

  try {
    await fs.mkdir(resolved, { recursive: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to create directory: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
