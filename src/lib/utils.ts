import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { AgentBlock } from "./types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function parseLines(str: string | undefined | null): string[] {
  return str?.split('\n').filter(Boolean) || [];
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07)/g, '');
}

export const isElectron =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

export function resolveProjectPath(p: string): string {
  return p.replace(/^~/, process.env.HOME || "~");
}

/**
 * Environment for child processes (agents, shells, PTYs). Strips vars that
 * leak from the Electron host or the Next.js server and would break dev
 * toolchains in the child — most notably NODE_ENV, which Electron sets to
 * "production" and which disables Fast Refresh in Vite dev servers.
 */
export function childProcessEnv(extras: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {
    ...(process.env as Record<string, string | undefined>),
    PROQ_API: `http://localhost:${process.env.PORT || 1337}`,
    ...extras,
  };
  delete env.NODE_ENV;
  delete env.CLAUDECODE;
  delete env.PORT;
  return env as unknown as NodeJS.ProcessEnv;
}

/**
 * Escape a prompt so it isn't misinterpreted as a CLI flag when passed to `-p`.
 * A leading hyphen/dash causes the argument parser to treat the value as an option.
 */
export function escapePrompt(text: string): string {
  return text.replace(/^-/, ' -');
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'project';
}

/**
 * Find user messages the CLI never saw because the session was stopped
 * before the agent could respond. Walks backward from the end of blocks,
 * collecting user messages until it hits actual agent content (text,
 * thinking, tool_use, tool_result). The final user block is excluded
 * since that's the current message being sent via -p.
 */
export function getUnseenUserMessages(blocks: AgentBlock[]): string[] {
  const unseen: string[] = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === "user") unseen.unshift(b.text);
    else if (b.type === "text" || b.type === "thinking" || b.type === "tool_use" || b.type === "tool_result") break;
  }
  if (unseen.length > 0) unseen.pop();
  return unseen;
}

/**
 * Wrap a prompt with any unseen user messages so the agent has context
 * for messages it missed due to session interruptions.
 */
export function wrapPromptWithUnseen(promptText: string, blocks: AgentBlock[]): string {
  const unseen = getUnseenUserMessages(blocks);
  if (unseen.length === 0) return promptText;

  const missed = unseen.map(m => `- "${m}"`).join("\n");
  return `Prior messages you haven't seen (the session was interrupted before you could respond):\n${missed}\n\nCurrent message:\n${promptText}`;
}
