import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const ATTACHMENTS_DIR = path.join(DATA_DIR, "attachments");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".xml": "text/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".tsx": "text/plain",
  ".ts": "text/plain",
  ".jsx": "text/plain",
  ".py": "text/plain",
  ".rs": "text/plain",
  ".go": "text/plain",
  ".rb": "text/plain",
  ".sh": "text/plain",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "text/plain",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const segments = (await params).path;
  const filePath = path.join(ATTACHMENTS_DIR, ...segments);

  // Path traversal protection
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(ATTACHMENTS_DIR))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!existsSync(resolved)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = readFileSync(resolved);
  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
