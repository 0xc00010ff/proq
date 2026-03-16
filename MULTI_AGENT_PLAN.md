# Multi-Agent Support Plan: Claude Code + Codex

## Overview

This document maps every place the codebase is hard-coded to Claude Code and lays out the changes required to make the system provider-agnostic, supporting Claude Code (current) and OpenAI Codex (new) as swappable backends.

---

## Hard-coded Claude Code dependencies (current state)

### 1. `src/lib/claude-bin.ts` — Claude binary detection
Entirely dedicated to finding the `claude` CLI binary. Searches nvm, homebrew, PATH. Used by every dispatch path.

### 2. `src/lib/claude-cli.ts` — One-shot Claude invocation
`claudeOneShot()` spawns `claude -p <prompt> --model haiku`. Used by auto-title generation.

### 3. `src/lib/agent-session.ts` — Structured (SDK) task agent
The main "structured" dispatch path. Deeply Claude-specific:
- Spawns `claude` with flags: `--output-format stream-json`, `--include-partial-messages`, `--verbose`, `--dangerously-skip-permissions`, `--permission-mode plan`, `--model`, `--append-system-prompt`, `--mcp-config`, `--allowedTools`, `--resume`, `-p`
- Parses Claude's `stream-json` line-delimited format (event types `system`, `assistant`, `user`, `result`, `stream_event`)
- Claude-specific tools: `ExitPlanMode`, `AskUserQuestion` detected by name in blocks and used to branch behavior
- Session continuity via `--resume <sessionId>` (Claude-specific)
- Cost tracking via `total_cost_usd` in result event (Claude-specific field)

### 4. `src/lib/agent-dispatch.ts` — Dispatch orchestrator
- `writeMcpConfig()` — writes a JSON file telling `claude` to connect to the proq MCP stdio server. MCP is Claude Code-specific.
- `buildProqSystemPrompt()` — references `AskUserQuestion` and `ExitPlanMode` tools by name (Claude-only tools)
- CLI mode: constructs a `claude` command line with `--permission-mode plan`, `--dangerously-skip-permissions`, `--allowedTools mcp__proq__*`, etc.
- CLI mode: uses `proq-bridge.js` to wrap the Claude CLI process in a PTY-over-unix-socket

### 5. `src/lib/supervisor-runtime.ts` — Supervisor agent
Spawns `claude` with `--resume`, same stream-json parsing. Claude-only.

### 6. `src/lib/agent-tab-runtime.ts` — Workbench agent tabs
Same pattern — spawns `claude`, uses MCP config, parses Claude stream format. Claude-only.

### 7. `src/lib/auto-title.ts` — Auto task title generation
Calls `claudeOneShot()` directly. Coupled to Claude.

### 8. `src/lib/types.ts` — Type definitions
- `ProqSettings.claudeBin` — Claude-specific field
- `ProqSettings.defaultModel` — model strings are currently Claude models (haiku, sonnet, opus)
- `ProqSettings.codingAgent` — field exists but is unused/hardcoded to `"claude-code"`
- `AgentRenderMode = 'cli' | 'structured'` — "cli" specifically means Claude CLI mode
- `AgentBlock` type includes `thinking` (Claude extended thinking) and `stream_delta` (Claude streaming)
- `Task.sessionId` — used for `--resume` (Claude concept, but the field is generic enough to reuse)

### 9. `src/app/settings/page.tsx` — Settings UI
- "Coding agent" field is disabled and hard-coded to show "Claude Code"
- "Claude binary" field is always shown
- "Agent render mode" UI copy ("Chat" vs "CLI") is framed around Claude
- `defaultModel` picker uses Claude model names

### 10. `src/lib/db.ts` — Settings storage
Default settings: `claudeBin: "claude"`, `codingAgent: "claude-code"`.

### 11. MCP infrastructure (`proq-mcp.js`, `proq-workbench-mcp.js`, `proq-mcp-general.js`)
The proq tool layer (read_task, update_task, commit_changes, etc.) is exposed to agents via MCP (Model Context Protocol), which is a Claude Code-specific mechanism. Codex uses OpenAI's function calling API instead.

### 12. `src/app/api/projects/[id]/git/route.ts` — Commit message generation
Uses `claudeOneShot()` to generate LLM-assisted commit messages. Directly coupled to Claude.

### 13. `src/app/api/files/read/route.ts` — File access allowlist
Hardcodes `~/.claude/` as an explicitly allowed directory for agent file access. No equivalent for Codex config paths.

### 14. `src/lib/agent-dispatch.ts` — `buildProqSystemPrompt()`
References `AskUserQuestion` and `ExitPlanMode` by their Claude-specific tool names in the system prompt text injected into every agent invocation.

---

## How Codex works (the target)

OpenAI Codex CLI (and the OpenAI Responses API) differs significantly from Claude Code:

| Concern | Claude Code | Codex |
|---|---|---|
| Invocation | Spawn `claude` CLI subprocess | OpenAI SDK (`openai.responses.create`) |
| Streaming format | `stream-json` line-delimited events | OpenAI SSE / async iterator |
| Tool integration | MCP stdio server, `--mcp-config` | OpenAI `tools` array (function definitions) |
| Session continuity | `--resume <sessionId>` | `previous_response_id` |
| Permission model | `--dangerously-skip-permissions`, `--permission-mode plan` | No equivalent — prompt-based |
| Plan mode tool | `ExitPlanMode` (built-in) | Custom function `exit_plan_mode` |
| Question tool | `AskUserQuestion` (built-in) | Custom function `ask_user_question` |
| Cost data | `total_cost_usd` in result event | `usage` in response object |
| Thinking blocks | `type: 'thinking'` | Reasoning via `o1`/`o3` — not a separate block type |
| Model namespace | claude-opus-4, claude-haiku-4-5, etc. | gpt-4o, o3, o4-mini, etc. |

---

## Plan: what needs to change

### Phase 1: Types and settings (foundational)

**`src/lib/types.ts`**
- Add `agentProvider: 'claude' | 'codex'` to `ProqSettings`
- Add `openaiApiKey?: string` to `ProqSettings` (or rely on `OPENAI_API_KEY` env var — env is preferable)
- Add `codexModel?: string` to `ProqSettings` for the Codex model override
- Rename or supplement `claudeBin` — either keep as `claudeBin` (Claude-only field, shown conditionally) or generalize. Keeping it scoped to Claude is cleaner.
- `AgentRenderMode` stays as-is — "cli" mode is Claude CLI-only; Codex only supports "structured"

**`src/lib/db.ts`**
- Add `agentProvider: 'claude'` to `DEFAULT_SETTINGS` (preserves existing behavior)
- Add `codexModel: ''` to defaults

---

### Phase 2: Provider abstraction layer (new file)

Create **`src/lib/agent-provider.ts`** — a thin router that reads `settings.agentProvider` and dispatches to the right implementation. Exports the same interface as the current `agent-session.ts`:

```ts
export async function startSession(projectId, taskId, prompt, cwd, options): Promise<void>
export async function continueSession(projectId, taskId, text, cwd, ...): Promise<void>
export function stopSession(taskId): void
export function isSessionRunning(taskId): boolean
export function getSession(taskId): AgentRuntimeSession | null
export function attachClient(taskId, ws): void
export function detachClient(taskId, ws): void
export function clearSession(taskId): void
```

`agent-dispatch.ts` currently imports from `agent-session.ts` directly. After this refactor it imports from `agent-provider.ts` instead.

---

### Phase 3: Claude session (isolate existing code)

**`src/lib/agent-session.ts`** stays mostly as-is but becomes "Claude-only". The provider router calls it when `agentProvider === 'claude'`. Minor cleanup:
- Make it clear this is Claude-specific (rename to `claude-session.ts` if desired, or leave as-is)
- No behavioral changes needed

**`src/lib/supervisor-runtime.ts`** — Supervisor stays Claude-only for now. It is a meta-level agent that manages proq itself, not individual project tasks. It can be extended to use Codex later as a separate concern.

**`src/lib/agent-tab-runtime.ts`** — Workbench agent tabs. Branch on `agentProvider` the same way as task dispatch. Low priority for initial Codex support.

---

### Phase 4: Codex session (new file)

Create **`src/lib/codex-session.ts`**. This is the most significant new code.

**Session management**: same `sessions` Map on `globalThis` pattern, same `AgentRuntimeSession` type.

**Invocation**: use `openai.responses.create()` with `stream: true` (OpenAI Responses API). Requires `openai` npm package.

```ts
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const stream = await openai.responses.create({
  model: settings.codexModel || 'o4-mini',
  input: prompt,
  tools: [...proqTools, ...codexTools],
  stream: true,
  previous_response_id: sessionId || undefined,
});
```

**Tool integration** (replacing MCP): Instead of an MCP stdio server, register proq tools as OpenAI function definitions and handle tool calls in the session runtime directly:

```ts
const PROQ_TOOLS = [
  { type: 'function', name: 'read_task', description: '...', parameters: {...} },
  { type: 'function', name: 'update_task', description: '...', parameters: {...} },
  { type: 'function', name: 'commit_changes', description: '...', parameters: {...} },
  { type: 'function', name: 'ask_user_question', description: '...', parameters: {...} },
  { type: 'function', name: 'exit_plan_mode', description: '...', parameters: {...} },
];
```

When the model calls a tool, the session runtime executes the tool logic (same logic as the MCP server), then feeds the result back via `openai.responses.create({ previous_response_id, input: [{ type: 'tool_result', ... }] })`. This is an agentic loop inside the session runtime.

**Stream parsing**: OpenAI Responses API SSE events map to `AgentBlock` types:
- `response.output_text.delta` → `{ type: 'stream_delta', text }`
- `response.output_item.added` where item is `type: 'message'` → text blocks
- `response.output_item.added` where item is `type: 'function_call'` → `{ type: 'tool_use', ... }`
- Tool result fed back → `{ type: 'tool_result', ... }`
- `response.completed` → `{ type: 'status', subtype: 'complete', costUsd, turns }`
- `response.failed` → `{ type: 'status', subtype: 'error', error }`

**Session continuity**: `previous_response_id` from `response.id` stored in `task.sessionId`. Used on `continueSession`.

**`ExitPlanMode` / `AskUserQuestion` equivalents**: The `exit_plan_mode` and `ask_user_question` functions are registered as tools. When the model calls them, the runtime handles them the same way `ExitPlanMode`/`AskUserQuestion` are detected in `agent-session.ts` — detect by function name, emit special blocks, stop the loop.

**`thinking` blocks**: OpenAI reasoning models use `type: 'reasoning'` in the response output. Map to `{ type: 'thinking', thinking: '...' }` for rendering compatibility.

---

### Phase 5: Dispatch layer updates

**`src/lib/agent-dispatch.ts`**:
- `dispatchTask()`: after path/worktree setup, branch on `agentProvider`:
  - `claude`: existing path (CLI mode or SDK mode via `startSession`)
  - `codex`: always goes through `startCodexSession()` — no CLI/tmux mode for Codex
- `writeMcpConfig()` remains Claude-only (not called for Codex)
- `buildProqSystemPrompt()`: make Claude-specific tool references conditional. For Codex, the system prompt should not mention `AskUserQuestion` or `ExitPlanMode` by those names — instead reference the `ask_user_question` and `exit_plan_mode` function names.
- `abortTask()`: branch on provider — for Codex, call `stopCodexSession()`
- `isSessionAlive()`: check Codex sessions too (via `codex-session.ts`)

---

### Phase 6: Auto-title abstraction

**`src/lib/auto-title.ts`** currently calls `claudeOneShot()`. Needs a provider-agnostic `llmOneShot()`:

Create **`src/lib/llm-oneshot.ts`**:
```ts
export async function llmOneShot(prompt: string): Promise<string>
```

- If `agentProvider === 'claude'`: delegate to `claudeOneShot()` (existing code)
- If `agentProvider === 'codex'`: call OpenAI chat completions with a cheap model (gpt-4o-mini)

Update `auto-title.ts` to import `llmOneShot` instead of `claudeOneShot`.

---

### Phase 7: Settings UI

**`src/app/settings/page.tsx`** Agent section:
- Make "Coding agent" a functional `<Select>` with options: `Claude Code` / `Codex`
- When `Claude Code` selected: show "Claude binary", "Agent render mode", "Show costs" (existing fields)
- When `Codex` selected: show "OpenAI API key" input (or just a note to set `OPENAI_API_KEY`), "Codex model" input, hide render mode (Codex is always structured)
- "Default model" field: change label/placeholder based on selected provider, validate format loosely

**`src/app/api/settings/detect-claude-bin/route.ts`**: stays Claude-specific, only shown when Claude is selected.

---

### Phase 8: Commit message generation abstraction

**`src/app/api/projects/[id]/git/route.ts`** calls `claudeOneShot()` to generate commit messages. Update to call `llmOneShot()` from the new `llm-oneshot.ts` (same abstraction used by auto-title).

---

### Phase 9: File access allowlist

**`src/app/api/files/read/route.ts`** hardcodes `~/.claude/` as allowed. Add `~/.codex/` (or equivalent Codex config directory) to the allowlist when `agentProvider === 'codex'`. Alternatively make the allowlist provider-aware.

---

### Phase 10: CLI mode is Claude-only

The CLI/"tmux" render mode (`renderMode: 'cli'`) uses `proq-bridge.js` to expose a PTY over a unix socket. This is inherently Claude CLI-specific. For Codex there is no CLI to wrap.

- If a task has `renderMode: 'cli'` but `agentProvider === 'codex'`, fall back to structured mode (or block the setting in UI)
- Document in settings UI that CLI mode requires Claude Code

---

### Phase 11: Provider-aware system prompt

**`buildProqSystemPrompt()` in `src/lib/agent-dispatch.ts`** currently refers to `AskUserQuestion` and `ExitPlanMode` by their Claude-specific built-in names. For Codex these must be referred to as `ask_user_question` and `exit_plan_mode` (custom function names). Add a `provider` parameter and emit the correct names conditionally.

---

## What does NOT need to change

- **Task lifecycle** (todo → in-progress → verify → done): fully provider-agnostic
- **`processQueue()` / `abortTask()`**: the queue logic is provider-agnostic; only the dispatch leaf needs branching
- **Worktree/branch management**: git operations are provider-agnostic
- **SSE event bus** (`task-events.ts`): provider-agnostic
- **Data layer** (`db.ts` schema, file structure): minimal changes (add 2 settings fields)
- **Frontend kanban/UI** (`KanbanBoard`, `TaskCard`, `TaskModal`, etc.): provider-agnostic
- **`TaskAgentDetail.tsx`** block rendering: already renders generic `AgentBlock` types; will work with Codex blocks once they map to the same format
- **MCP servers** (`proq-mcp.js`, etc.): these stay as-is for Claude. Codex doesn't use them.
- **`proq-bridge.js`**: Claude CLI mode only, stays as-is

---

## Dependency to add

```bash
npm install openai
```

The `openai` package for the Responses API. No other new dependencies needed.

---

## Migration / backward compatibility

- `agentProvider` defaults to `'claude'` — zero behavior change for existing users
- All Claude Code features (CLI mode, MCP, plan mode, --resume) remain fully intact
- Codex support is additive — toggled via settings

---

## Implementation order (suggested)

1. Types + settings schema (`types.ts`, `db.ts`) — add `agentProvider`, `codexModel`, `openaiApiKey` (or env-only)
2. Settings UI — make provider selector functional, show Claude/Codex fields conditionally
3. `codex-session.ts` — core Codex session runtime with agentic tool loop
4. `agent-provider.ts` — thin router that delegates to `claude-session` or `codex-session`
5. Update `agent-dispatch.ts`:
   - Import from `agent-provider.ts` instead of `agent-session.ts`
   - Branch `dispatchTask()` on provider for CLI vs SDK vs Codex paths
   - `buildProqSystemPrompt()` — provider-aware tool names
   - `abortTask()` / `isSessionAlive()` — handle Codex sessions
6. `llm-oneshot.ts` — provider-aware one-shot LLM wrapper
7. Update `auto-title.ts` and `git/route.ts` to use `llmOneShot()`
8. Update `files/read/route.ts` allowlist to include Codex config dir
9. Test end-to-end with a simple task on each provider
