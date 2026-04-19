import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getAllProjects } from "@/lib/db";
import {
  IGNORED_NAMES,
  loadGitignorePatterns,
  matchesGitignore,
} from "@/lib/file-tree-filter";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
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
