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
 * before the agent could respond. Scans backward from the end of blocks
 * to find the last point where the agent actually finished ("complete",
 * "error", or "interrupted" — NOT "abort"), then returns any user
 * messages after that point, excluding the final one (the current message).
 */
export function getUnseenUserMessages(blocks: AgentBlock[]): string[] {
  let lastRespondedIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === "status" && (b.subtype === "complete" || b.subtype === "error" || b.subtype === "interrupted")) {
      lastRespondedIdx = i;
      break;
    }
  }

  const userMessages: string[] = [];
  for (let i = lastRespondedIdx + 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "user") {
      userMessages.push(b.text);
    }
  }

  // Remove the last one — that's the current message being sent via -p
  if (userMessages.length > 0) {
    userMessages.pop();
  }

  return userMessages;
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
