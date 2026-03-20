/**
 * Provider router — reads agentProvider from settings and delegates to either
 * agent-session.ts (Claude) or codex-session.ts (Codex).
 *
 * All callers that previously imported from agent-session should now import
 * from here instead, so provider switching is transparent.
 */

import { getSettings } from "./db";
import type { TaskAttachment } from "./types";
import type WebSocket from "ws";

// ── Session start / continue ──────────────────────────────────────────────────

export async function startSession(
  projectId: string,
  taskId: string,
  prompt: string,
  cwd: string,
  options?: {
    proqSystemPrompt?: string;
    mcpConfig?: string;
    permissionMode?: string;
  },
): Promise<void> {
  const settings = await getSettings();
  if (settings.agentProvider === "codex") {
    const { startSession: codexStart } = await import("./codex-session");
    return codexStart(projectId, taskId, prompt, cwd, options);
  }
  const { startSession: claudeStart } = await import("./agent-session");
  return claudeStart(projectId, taskId, prompt, cwd, options);
}

export async function continueSession(
  projectId: string,
  taskId: string,
  text: string,
  cwd: string,
  ws?: WebSocket,
  attachments?: TaskAttachment[],
  options?: { planApproved?: boolean },
): Promise<void> {
  // If a codex session is actively in memory, continue with codex
  const { getSession: getCodexSession } = await import("./codex-session");
  if (getCodexSession(taskId)) {
    const { continueSession: codexContinue } = await import("./codex-session");
    return codexContinue(projectId, taskId, text, cwd, ws, attachments, options);
  }
  // If a claude session is actively in memory, continue with claude
  const { getSession: getClaudeSession } = await import("./agent-session");
  if (getClaudeSession(taskId)) {
    const { continueSession: claudeContinue } = await import("./agent-session");
    return claudeContinue(projectId, taskId, text, cwd, ws, attachments, options);
  }
  // No active session in memory — route based on current settings provider
  const settings = await getSettings();
  if (settings.agentProvider === "codex") {
    const { continueSession: codexContinue } = await import("./codex-session");
    return codexContinue(projectId, taskId, text, cwd, ws, attachments, options);
  }
  const { continueSession: claudeContinue } = await import("./agent-session");
  return claudeContinue(projectId, taskId, text, cwd, ws, attachments, options);
}

// ── Session control ───────────────────────────────────────────────────────────

export async function stopSession(taskId: string): Promise<void> {
  const { getSession: getCodexSession, stopSession: codexStop } = await import("./codex-session");
  if (getCodexSession(taskId)) {
    codexStop(taskId);
    return;
  }
  const { stopSession: claudeStop } = await import("./agent-session");
  claudeStop(taskId);
}

export function clearSession(taskId: string): void {
  (
    globalThis as unknown as {
      __proqCodexSessions?: Map<string, unknown>;
    }
  ).__proqCodexSessions?.delete(taskId);
  (
    globalThis as unknown as {
      __proqAgentRuntimeSessions?: Map<string, unknown>;
    }
  ).__proqAgentRuntimeSessions?.delete(taskId);
}

// ── Session query ─────────────────────────────────────────────────────────────

// Synchronous check — reads globalThis session maps directly to avoid
// circular import issues and async overhead in hot paths.
export function isSessionRunning(taskId: string): boolean {
  const codexSessions = (
    globalThis as unknown as {
      __proqCodexSessions?: Map<string, { status: string }>;
    }
  ).__proqCodexSessions;
  if (codexSessions?.has(taskId)) {
    const s = codexSessions.get(taskId)!;
    return s.status === "running";
  }
  const claudeSessions = (
    globalThis as unknown as {
      __proqAgentRuntimeSessions?: Map<string, { status: string }>;
    }
  ).__proqAgentRuntimeSessions;
  if (claudeSessions?.has(taskId)) {
    const s = claudeSessions.get(taskId)!;
    return s.status === "running";
  }
  return false;
}

type AnySession = { blocks: unknown[]; clients: Set<WebSocket>; status: string };

function getCodexSessionSync(taskId: string): AnySession | null {
  return (
    (globalThis as unknown as { __proqCodexSessions?: Map<string, AnySession> })
      .__proqCodexSessions?.get(taskId) ?? null
  );
}

function getClaudeSessionSync(taskId: string): AnySession | null {
  return (
    (globalThis as unknown as { __proqAgentRuntimeSessions?: Map<string, AnySession> })
      .__proqAgentRuntimeSessions?.get(taskId) ?? null
  );
}

export function getSession(taskId: string): AnySession | null {
  return getCodexSessionSync(taskId) ?? getClaudeSessionSync(taskId);
}

export function attachClient(taskId: string, ws: WebSocket): void {
  getSession(taskId)?.clients.add(ws);
}

export function detachClient(taskId: string, ws: WebSocket): void {
  getSession(taskId)?.clients.delete(ws);
}
