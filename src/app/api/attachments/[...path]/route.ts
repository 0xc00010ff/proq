import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const SUPERVISOR_ATTACHMENTS_DIR = path.join(DATA_DIR, "supervisor", "attachments");
const LEGACY_ATTACHMENTS_DIR = path.join(DATA_DIR, "attachments");
const PROJECTS_DIR = path.join(DATA_DIR, "projects");

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

  // Resolve file path: check if first segment is a project ID
  // URL patterns:
  //   /api/attachments/{projectId}/{attId}/{filename} → data/projects/{projectId}/attachments/{attId}/{filename}
  //   /api/attachments/{attId}/{filename}             → data/supervisor/attachments/{attId}/{filename}
  //                                                   → data/attachments/{attId}/{filename} (legacy fallback)
  let filePath: string;
  const projectAttDir = path.join(PROJECTS_DIR, segments[0], "attachments");
  if (segments.length >= 3 && existsSync(projectAttDir)) {
    filePath = path.join(projectAttDir, ...segments.slice(1));
  } else {
    // Try supervisor dir first, fall back to legacy data/attachments/
    const supervisorPath = path.join(SUPERVISOR_ATTACHMENTS_DIR, ...segments);
    const legacyPath = path.join(LEGACY_ATTACHMENTS_DIR, ...segments);
    filePath = existsSync(path.resolve(supervisorPath)) ? supervisorPath : legacyPath;
  }

  // Path traversal protection
  const resolved = path.resolve(filePath);
  const resolvedData = path.resolve(DATA_DIR);
  if (!resolved.startsWith(resolvedData)) {
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
