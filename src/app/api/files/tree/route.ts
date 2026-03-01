import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getAllProjects } from "@/lib/db";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

const IGNORED_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  ".DS_Store",
  "dist",
  "build",
  ".cache",
  "__pycache__",
  ".pytest_cache",
  "coverage",
  ".nyc_output",
  ".parcel-cache",
  ".proq-worktrees",
  "Thumbs.db",
]);

async function loadGitignorePatterns(projectRoot: string): Promise<string[]> {
  try {
    const content = await fs.readFile(
      path.join(projectRoot, ".gitignore"),
      "utf-8"
    );
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.replace(/\/$/, ""));
  } catch {
    return [];
  }
}

function matchesGitignore(name: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p.includes("*")) {
      const regex = new RegExp(
        "^" + p.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
      );
      return regex.test(name);
    }
    return name === p;
  });
}

async function buildTree(
  dirPath: string,
  projectRoot: string,
  gitignorePatterns: string[],
  depth: number,
  maxDepth: number
): Promise<TreeNode[]> {
  if (depth >= maxDepth) return [];

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: TreeNode[] = [];

  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    if (matchesGitignore(entry.name, gitignorePatterns)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const children = await buildTree(
        fullPath,
        projectRoot,
        gitignorePatterns,
        depth + 1,
        maxDepth
      );
      nodes.push({ name: entry.name, path: fullPath, type: "dir", children });
    } else {
      nodes.push({ name: entry.name, path: fullPath, type: "file" });
    }
  }

  return nodes;
}

export async function GET(req: NextRequest) {
  const dirPath = req.nextUrl.searchParams.get("path");
  const maxDepth = parseInt(req.nextUrl.searchParams.get("depth") || "20", 10);

  if (!dirPath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const resolved = path.resolve(dirPath);

  // Validate path belongs to a registered project
  const projects = await getAllProjects();
  const isAllowed = projects.some((p) => resolved.startsWith(p.path));
  if (!isAllowed) {
    return NextResponse.json({ error: "path not allowed" }, { status: 403 });
  }

  const gitignorePatterns = await loadGitignorePatterns(resolved);
  const tree = await buildTree(resolved, resolved, gitignorePatterns, 0, maxDepth);

  return NextResponse.json(tree);
}
