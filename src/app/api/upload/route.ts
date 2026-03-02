import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

export async function POST(req: Request) {
  const formData = await req.formData();
  const files = formData.getAll("files") as File[];

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const results = await Promise.all(
    files.map(async (file) => {
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const dir = path.join(DATA_DIR, "attachments", id);
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
