# Agent Session Rendering Architecture

## The Model

A task has two things the UI cares about:

1. **Blocks** — the conversation history. Persistent. Grows over time.
2. **`active: boolean`** — is the agent working right now?

When you click into a task, you immediately see the blocks (where we left off). If the agent is active, new blocks stream in. If not, you can type a message to make it active again.

Everything else — dispatch queues, process lifecycle, session objects — is server-internal plumbing. The client doesn't need to know about it.

## The Bug Class

The client doesn't get told whether the agent is active. It receives `{ blocks, live: boolean }` on connect and then infers the answer by scanning block contents for status subtypes. This inference has edge cases (empty blocks, agent between turns, server restart, client connecting before session exists) that keep producing blank-panel and stale-state bugs.

Three systems independently track "is the agent active" and can disagree:

| System | Where | Values |
|--------|-------|--------|
| Task DB `agentStatus` | Persistent | `queued` / `starting` / `running` / `null` |
| In-memory `session.status` | Server RAM | `running` / `done` / `error` / `aborted` |
| Client `sessionDone` | Browser | Inferred from block contents |

The client's inference logic (`useAgentSession.ts:75-103`) is a 4-way branch that reverse-engineers server state. Every new edge case requires another conditional.

## The Fix

**The server sends `active: boolean` with every WebSocket message.** The client reads it directly and stops inferring.

### Server side

The server already knows the answer. It has the session object (or doesn't) and knows whether the process is alive:

```typescript
// agent-session-server.ts — on client connect
function isActive(session: AgentRuntimeSession | null, task: Task | null): boolean {
  if (session?.status === 'running') return true;
  // No session but agent is dispatched/starting — will be active soon
  if (task?.agentStatus === 'queued' || task?.agentStatus === 'starting' || task?.agentStatus === 'running') return true;
  return false;
}
```

Include `active` on every `replay` and `block` message:

```typescript
// On connect:
ws.send({ type: 'replay', blocks: session?.blocks ?? storedBlocks, active })

// On new block:
broadcast(session, { type: 'block', block, active: session.status === 'running' })
```

When the session ends (process close handler), broadcast one final update:

```typescript
broadcast(session, { type: 'active', active: false })
```

When `continueSession()` starts a new turn:

```typescript
broadcast(session, { type: 'active', active: true })
```

### Client side

The `useAgentSession` hook replaces all inference with direct reads:

```typescript
// Before: 30 lines of block scanning
// After:
if (msg.type === 'replay') {
  setBlocks(msg.blocks);
  setActive(msg.active);
} else if (msg.type === 'block') {
  setBlocks(prev => [...prev, msg.block]);
  setActive(msg.active);
} else if (msg.type === 'active') {
  setActive(msg.active);
} else if (msg.type === 'stream_delta') {
  appendDelta(msg.text);
}
```

StructuredPane uses `active` directly:

```typescript
const showThinking = active && !streamingText && blocks.length > 0;
const showStarting = active && blocks.length === 0;
// Input bar: active ? stop button : send button
```

### What gets removed

- **`pendingClients` mechanism** — when no session exists but the task is dispatched, the server sends `{ replay, blocks: [], active: true }`. Client shows "Starting session..." immediately. When the session starts and blocks arrive, they flow through the normal WebSocket. No two-phase promotion dance needed.
- **Client block-scanning inference** — the 4-way branch and all the `sessionDone` conditionals.
- **`live: boolean` on replay messages** — `active` replaces it.
- **`prefetchedBlocks` HTTP fetch for verify tasks** — the WebSocket replay already returns the blocks. One path instead of two.
- **`initialBlocks` prop threading** through TaskAgentDetail → StructuredPane → useAgentSession.

### What stays the same

- Task DB `agentStatus` and `processQueue()` — unchanged (dispatch is separate from rendering)
- `wireProcess` close handler, `startSession`, `continueSession` internals — unchanged
- All features: follow-ups, plan approval, AskUserQuestion/ExitPlanMode, CLI mode, branch preview
- The `AgentBlock[]` model and streaming deltas
- The `session.status` field on `AgentRuntimeSession` — still used server-side for process lifecycle

## Files Changed

| File | What |
|------|------|
| `types.ts` | Add `active` to `AgentWsServerMsg`, add `'active'` message type, remove `live` |
| `agent-session.ts` | Broadcast `{ type: 'active', active }` on session start/end. Include `active` in block broadcasts. |
| `agent-session-server.ts` | Compute `active` on connect from session + task state. Send with replay. Remove `addPendingClient`. |
| `useAgentSession.ts` | Replace inference with `setActive(msg.active)`. Remove block scanning. |
| `StructuredPane.tsx` | `sessionDone` → `active` (inverted). |
| `TaskAgentDetail.tsx` | Remove `prefetchedBlocks` fetch and `initialBlocks` prop. |

~6 files, net deletion of complexity. The server surfaces what it already knows. The client renders what it's told.
