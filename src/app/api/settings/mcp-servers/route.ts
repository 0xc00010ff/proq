import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import os from "os";
import type { McpServerInfo } from "@/lib/types";

function parseServers(mcpServers: Record<string, unknown>): McpServerInfo[] {
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

export async function GET() {
  try {
    const claudeJson = JSON.parse(
      readFileSync(join(os.homedir(), ".claude.json"), "utf-8")
    );
    const servers = parseServers(claudeJson.mcpServers || {});
    return NextResponse.json({ servers });
  } catch {
    return NextResponse.json({ servers: [] });
  }
}
