import { NextResponse } from "next/server";
import { renameSync, existsSync } from "fs";
import path from "path";
import { getProject, updateProject } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const { name } = await request.json();

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const trimmedName = name.trim();
  const oldPath = project.path.replace(/\/+$/, "");
  const parentDir = path.dirname(oldPath);
  const newPath = path.join(parentDir, trimmedName);

  // Rename directory on disk if the path is actually changing
  if (newPath !== oldPath) {
    if (!existsSync(oldPath)) {
      return NextResponse.json(
        { error: "Source directory does not exist" },
        { status: 400 }
      );
    }
    if (existsSync(newPath)) {
      return NextResponse.json(
        { error: "A directory with that name already exists" },
        { status: 409 }
      );
    }

    try {
      renameSync(oldPath, newPath);
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to rename directory: ${(err as Error).message}` },
        { status: 500 }
      );
    }
  }

  // Update project name and path in the database
  const updated = await updateProject(id, { name: trimmedName, path: newPath });
  if (!updated) {
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }

  return NextResponse.json(updated);
}
