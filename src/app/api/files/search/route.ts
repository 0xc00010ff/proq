import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";
import { getAllProjects } from "@/lib/db";

const MAX_MATCHES = 500;
const TIMEOUT_MS = 5000;

interface Match {
  line: number;
  text: string;
  column: number;
}

interface FileResult {
  file: string;
  matches: Match[];
}

function parseGitGrepOutput(
  output: string,
  query: string,
  caseSensitive: boolean
): { results: FileResult[]; totalMatches: number; truncated: boolean } {
  const byFile = new Map<string, Match[]>();
  let totalMatches = 0;
  let truncated = false;

  for (const line of output.split("\n")) {
    if (!line) continue;
    // git grep -n output: file:line:content
    const firstColon = line.indexOf(":");
    if (firstColon === -1) continue;
    const secondColon = line.indexOf(":", firstColon + 1);
    if (secondColon === -1) continue;

    const file = line.slice(0, firstColon);
    const lineNum = parseInt(line.slice(firstColon + 1, secondColon), 10);
    if (isNaN(lineNum)) continue;
    const text = line.slice(secondColon + 1).slice(0, 200);

    // Find column of first match
    const searchIn = caseSensitive ? text : text.toLowerCase();
    const searchFor = caseSensitive ? query : query.toLowerCase();
    const column = Math.max(0, searchIn.indexOf(searchFor));

    if (totalMatches >= MAX_MATCHES) {
      truncated = true;
      break;
    }

    const matches = byFile.get(file) || [];
    matches.push({ line: lineNum, text, column });
    byFile.set(file, matches);
    totalMatches++;
  }

  const results: FileResult[] = [];
  for (const [file, matches] of byFile) {
    results.push({ file, matches });
  }

  return { results, totalMatches, truncated };
}

function searchWithGitGrep(
  projectPath: string,
  query: string,
  caseSensitive: boolean,
  regex: boolean
): Promise<{ results: FileResult[]; totalMatches: number; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const args = [
      "grep",
      "-n",      // line numbers
      "-I",      // skip binary files
      "--no-color",
    ];
    if (!caseSensitive) args.push("-i");
    if (regex) {
      args.push("-E"); // extended regex
    } else {
      args.push("-F"); // fixed string
    }
    args.push("--", query);

    execFile("git", args, { cwd: projectPath, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      // git grep returns exit code 1 when no matches found — not an error
      if (err && (err as NodeJS.ErrnoException).code !== undefined && (err as { killed?: boolean }).killed) {
        return reject(new Error("Search timed out"));
      }
      const output = stdout || "";
      resolve(parseGitGrepOutput(output, query, caseSensitive));
    });
  });
}

function searchWithGrep(
  projectPath: string,
  query: string,
  caseSensitive: boolean,
  regex: boolean
): Promise<{ results: FileResult[]; totalMatches: number; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const args = [
      "-rn",     // recursive + line numbers
      "-I",      // skip binary files
      "--exclude-dir=node_modules",
      "--exclude-dir=.git",
      "--exclude-dir=.next",
      "--exclude-dir=dist",
      "--exclude-dir=build",
      "--exclude-dir=.cache",
      "--exclude-dir=coverage",
      "--exclude-dir=.proq-worktrees",
    ];
    if (!caseSensitive) args.push("-i");
    if (!regex) {
      args.push("-F"); // fixed string
    } else {
      args.push("-E"); // extended regex
    }
    args.push("--", query, ".");

    execFile("grep", args, { cwd: projectPath, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err && (err as { killed?: boolean }).killed) {
        return reject(new Error("Search timed out"));
      }
      const output = stdout || "";
      // grep output is ./file:line:content — strip leading ./
      const cleaned = output.replace(/^\.\//gm, "");
      resolve(parseGitGrepOutput(cleaned, query, caseSensitive));
    });
  });
}

async function isGitRepo(projectPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectPath, timeout: 2000 }, (err) => {
      resolve(!err);
    });
  });
}

export async function GET(req: NextRequest) {
  const projectPath = req.nextUrl.searchParams.get("path");
  const query = req.nextUrl.searchParams.get("q");
  const caseSensitive = req.nextUrl.searchParams.get("caseSensitive") === "true";
  const regex = req.nextUrl.searchParams.get("regex") === "true";

  if (!projectPath || !query) {
    return NextResponse.json({ error: "path and q are required" }, { status: 400 });
  }

  // Validate path belongs to a registered project
  const resolved = path.resolve(projectPath);
  const projects = await getAllProjects();
  const isAllowed = projects.some((p) => resolved.startsWith(p.path));
  if (!isAllowed) {
    return NextResponse.json({ error: "path not allowed" }, { status: 403 });
  }

  try {
    const gitRepo = await isGitRepo(resolved);
    const result = gitRepo
      ? await searchWithGitGrep(resolved, query, caseSensitive, regex)
      : await searchWithGrep(resolved, query, caseSensitive, regex);

    // Convert relative paths to absolute
    result.results = result.results.map((r) => ({
      ...r,
      file: path.join(resolved, r.file),
    }));

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Search failed" },
      { status: 500 }
    );
  }
}
