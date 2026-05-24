import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { getAllProjects } from "@/lib/db";

// Serves raw file bytes (currently used for image previews in the code viewer).
// Mirrors /api/files/read's path validation, but returns the bytes with a
// proper Content-Type instead of JSON so they can be used as an <img> source.

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".apng": "image/apng",
  ".svg": "image/svg+xml",
};

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const resolved = path.resolve(filePath);

  // Validate path belongs to a registered project or ~/.claude/
  const projects = await getAllProjects();
  const claudeDir = path.join(os.homedir(), ".claude");
  const isAllowed =
    projects.some((p) => resolved.startsWith(p.path)) ||
    resolved.startsWith(claudeDir);
  if (!isAllowed) {
    return NextResponse.json({ error: "path not allowed" }, { status: 403 });
  }

  try {
    const stat = await fs.stat(resolved);
    if (stat.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "file too large (max 25MB)" },
        { status: 413 }
      );
    }

    const buffer = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        // Project files can change on disk — revalidate rather than cache hard.
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }
}
