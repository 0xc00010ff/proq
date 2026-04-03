import { NextResponse } from "next/server";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, resolve, basename } from "path";
import os from "os";
import { getProject } from "@/lib/db";
import { resolveProjectPath } from "@/lib/utils";
import type { McpServerInfo, SkillInfo } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

function parseServers(
  mcpServers: Record<string, unknown>
): McpServerInfo[] {
  return Object.entries(mcpServers).map(([name, config]) => {
    const cfg = config as Record<string, unknown>;
    const type = (cfg.type as string) || (cfg.command ? "stdio" : "unknown");
    const info: McpServerInfo = { name, type };
    if (cfg.url) info.url = cfg.url as string;
    if (cfg.command) info.command = cfg.command as string;
    if (cfg.args) info.args = cfg.args as string[];
    return info;
  });
}

function readClaudeJson(): Record<string, unknown> | null {
  try {
    return JSON.parse(
      readFileSync(join(os.homedir(), ".claude.json"), "utf-8")
    );
  } catch {
    return null;
  }
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const projectPath = resolveProjectPath(project.path);
  const claudeJson = readClaudeJson();

  // 1. Project-local MCPs from .mcp.json
  let projectServers: McpServerInfo[] = [];
  try {
    const mcpJsonPath = join(projectPath, ".mcp.json");
    const mcpJson = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    projectServers = parseServers(mcpJson.mcpServers || {});
  } catch {
    // No .mcp.json or invalid — fine
  }

  // 2. Per-project MCPs from ~/.claude.json projects entry
  let configuredServers: McpServerInfo[] = [];
  if (claudeJson) {
    try {
      const absPath = resolve(projectPath);
      const projects = claudeJson.projects as Record<string, Record<string, unknown>> | undefined;
      if (projects) {
        const entry = projects[absPath];
        if (entry?.mcpServers) {
          configuredServers = parseServers(
            entry.mcpServers as Record<string, unknown>
          );
        }
      }
    } catch {
      // Malformed — skip
    }
  }

  // 3. Global MCPs from ~/.claude.json top-level
  let globalServers: McpServerInfo[] = [];
  if (claudeJson?.mcpServers) {
    try {
      globalServers = parseServers(
        claudeJson.mcpServers as Record<string, unknown>
      );
    } catch {
      // Malformed — skip
    }
  }

  // 4. Skills from .claude/skills/*.md
  let skills: SkillInfo[] = [];
  try {
    const skillsDir = join(projectPath, ".claude", "skills");
    if (existsSync(skillsDir)) {
      skills = readdirSync(skillsDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => ({
          name: basename(f, ".md"),
          filename: f,
        }));
    }
  } catch {
    // No skills dir or unreadable — fine
  }

  return NextResponse.json({
    globalServers,
    projectServers,
    configuredServers,
    skills,
  });
}
