import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { projectAttachmentsDir } from "@/lib/db";

const DATA_DIR = path.join(process.cwd(), "data");

export async function POST(req: Request) {
  const formData = await req.formData();
  const files = formData.getAll("files") as File[];
  const projectId = formData.get("projectId") as string | null;

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const results = await Promise.all(
    files.map(async (file) => {
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      // Project-scoped attachments go in the project directory;
      // non-project uploads (supervisor) go in data/supervisor/attachments/
      const baseDir = projectId
        ? projectAttachmentsDir(projectId)
        : path.join(DATA_DIR, "supervisor", "attachments");
      const dir = path.join(baseDir, id);
      mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, file.name);
      const buffer = Buffer.from(await file.arrayBuffer());
      writeFileSync(filePath, buffer);
      return {
        id,
        name: file.name,
        size: file.size,
        type: file.type,
        filePath,
      };
    })
  );

  return NextResponse.json(results);
}
