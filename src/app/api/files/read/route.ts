import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { getAllProjects } from "@/lib/db";

const EXT_TO_LANGUAGE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".sql": "sql",
  ".graphql": "graphql",
  ".toml": "toml",
  ".env": "plaintext",
  ".txt": "plaintext",
  ".dockerfile": "dockerfile",
  ".gitignore": "plaintext",
  ".svg": "xml",
};

// Binary image formats we preview as an <img> rather than reading as text.
// SVG is intentionally excluded — it's text/XML and stays editable in Monaco.
const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".avif",
  ".apng",
]);

function getLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (EXT_TO_LANGUAGE[ext]) return EXT_TO_LANGUAGE[ext];

  const basename = path.basename(filePath).toLowerCase();
  if (basename === "dockerfile") return "dockerfile";
  if (basename === "makefile") return "plaintext";
  if (basename.startsWith(".env")) return "plaintext";

  return "plaintext";
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const resolved = path.resolve(filePath);

  // Validate path belongs to a registered project or ~/.claude/ (plan files)
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

    // Images aren't read as text — the client previews them via /api/files/raw.
    // Skip the read (and the text size limit) and just report the format + size.
    const ext = path.extname(resolved).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      return NextResponse.json({
        content: "",
        language: "image",
        path: resolved,
        size: stat.size,
      });
    }

    if (stat.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "file too large (max 5MB)" },
        { status: 413 }
      );
    }

    const content = await fs.readFile(resolved, "utf-8");
    const language = getLanguage(resolved);

    return NextResponse.json({ content, language, path: resolved });
  } catch {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }
}
