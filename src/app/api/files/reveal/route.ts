import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import path from "path";
import { getAllProjects } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { path: targetPath } = body;

  if (!targetPath) {
    return NextResponse.json(
      { error: "path is required" },
      { status: 400 }
    );
  }

  const resolved = path.resolve(targetPath);

  // Validate path belongs to a registered project
  const projects = await getAllProjects();
  const isAllowed = projects.some((p) => resolved.startsWith(p.path));
  if (!isAllowed) {
    return NextResponse.json({ error: "path not allowed" }, { status: 403 });
  }

  exec(`open -R ${JSON.stringify(resolved)}`);
  return NextResponse.json({ ok: true });
}
