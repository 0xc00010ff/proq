import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getAllProjects } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { oldPath, newPath } = body;

  if (!oldPath || !newPath) {
    return NextResponse.json(
      { error: "oldPath and newPath are required" },
      { status: 400 }
    );
  }

  const resolvedOld = path.resolve(oldPath);
  const resolvedNew = path.resolve(newPath);

  // Validate both paths belong to a registered project
  const projects = await getAllProjects();
  const oldAllowed = projects.some((p) => resolvedOld.startsWith(p.path));
  const newAllowed = projects.some((p) => resolvedNew.startsWith(p.path));
  if (!oldAllowed || !newAllowed) {
    return NextResponse.json({ error: "path not allowed" }, { status: 403 });
  }

  try {
    await fs.rename(resolvedOld, resolvedNew);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to rename: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
