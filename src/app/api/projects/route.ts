import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { getAllProjects, createProject } from "@/lib/db";
import { safeParseBody } from "@/lib/api-utils";

function resolvePath(p: string): string {
  return p.replace(/^~/, process.env.HOME || "~");
}

export async function GET() {
  const projects = await getAllProjects();
  const enriched = projects.map((p) => ({
    ...p,
    pathValid: existsSync(resolvePath(p.path)),
  }));
  return NextResponse.json(enriched);
}

export async function POST(request: Request) {
  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;
  const { name, path, serverUrl } = body;

  if (!name || !path) {
    return NextResponse.json(
      { error: "name and path are required" },
      { status: 400 }
    );
  }

  const project = await createProject({ name, path, serverUrl });
  return NextResponse.json(
    { ...project, pathValid: existsSync(resolvePath(path)) },
    { status: 201 }
  );
}
