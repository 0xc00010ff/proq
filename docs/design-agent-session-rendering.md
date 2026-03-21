# Agent Session Rendering Architecture: Design Document

## 1. Problem Analysis

### The Three State Systems

The root cause of recurring blank-panel/stale-state bugs is that three independent systems track whether the agent is running, and they can disagree:

**A. Task DB (`agentStatus`)** — the persistent field on the Task object
- Set to `"queued"` or `"starting"` by `initForDispatch()` / `processQueue()`
- Set to `"running"` by `processQueue()` after `dispatchTask()` succeeds
- Cleared to `null` by `wireProcess` close handler, or by `mergeAndComplete()` / `resetToTodo()`

**B. In-memory session (`session.status`)** — the `AgentRuntimeSession` object
- Created as `"running"` in `startSession()`
- Set to `"done"` or `"error"` by `processStreamEvent()` when a `result` event arrives
- Set to `"done"` or `"error"` by `wireProcess` close handler (if not already set by result event)
- Set to `"aborted"` by `stopSession()`
- The session object is deleted entirely by `clearSession()` (called on abort, delete, merge-complete)

**C. Client-side (`sessionDone: boolean`)** — reverse-engineered by `useAgentSession`
- Set to `true` when `replay` message has `live: false` and blocks > 0
- Set to `true` when a `block` message has `status.subtype` of `complete`/`error`/`abort`
- Set to `false` when a `block` message has `status.subtype === 'init'` or `type === 'user'`
- Complex inference logic for `replay` with `live: true` — scans blocks for last status, checks if a user block follows it
- On empty replay with `live: false`: stays `false` (pending client mechanism)

### State Desync Paths

Here are the concrete paths where these three sources disagree:

1. **Race between session creation and client connection.** Client connects via WebSocket before `startSession()` creates the session object. Server returns `{ replay, blocks: [], live: false }`. Client sees empty blocks, no live session. The `pendingClients` mechanism was added to patch this — client gets re-attached when the session starts and receives a second `replay`. But the client is in a liminal state (no blocks, not done, not connected to live session) during the gap.

2. **`result` event vs process `close`.** `processStreamEvent` sets `session.status = "done"` on the `result` event and appends a `status/complete` block. Then `wireProcess` close handler fires and sees `session.status === "done"`, so it skips appending another status block. But the close handler is what persists blocks to disk and updates the Task DB. If a client connects between `result` and `close`, it gets a live session with a `complete` status block but `agentStatus` is still `"running"` in the DB. The client correctly infers `sessionDone = true` from blocks, but the task card still shows "running".

3. **Agent ends on AskUserQuestion/ExitPlanMode.** The process is killed with SIGTERM. The close handler detects `intentionalKill` and the session ends, but the agent is conceptually "waiting for input" — not done. The DB moves to `verify` with `agentStatus: null`. But the in-memory session status is `"done"`. The client sees a `complete` status block and marks `sessionDone = true`. The input bar should be enabled (session is waiting), and it is — but only because `sessionDone` enables the send button. The logic is accidentally correct but fragile.

4. **Follow-up on a cleared session.** `continueSession()` reconstructs a session from DB when no in-memory session exists. It creates a new session object with `status: "done"`, then sets it to `"running"`. But between creating the session and the process starting, a client connecting would see a live session with historical blocks and `status: "running"` — but no process is producing output yet. No blocks arrive until the CLI starts streaming, which can take seconds.

5. **Server restart.** All in-memory sessions are lost. Task DB still has `agentStatus: "running"` but no session exists. Client connects, gets `{ replay, blocks: [], live: false }`. If no blocks are persisted on disk yet (agent was mid-stream), client shows blank panel. The `pendingClients` mechanism doesn't help because no `startSession()` will ever be called for this task.

### Client Inference Complexity

The core of the client complexity is in `useAgentSession.ts` lines 75-103:

```typescript
// replay handler — client must figure out what state we're in
if (msg.live === false && msg.blocks.length > 0) {
  setSessionDone(true);                    // historical, done
} else if (msg.live === false) {
  // empty, pending — keep "Starting session..." visible
} else if (msg.blocks.length === 0) {
  // live but empty — just started
} else {
  // live with blocks — scan for status blocks to infer if done
  const statusBlocks = msg.blocks.filter(...)
  const lastStatus = statusBlocks[statusBlocks.length - 1];
  const hasUserAfter = msg.blocks.slice(lastStatusIdx + 1).some(b => b.type === 'user');
  const isDone = lastStatus && lastStatus.subtype !== 'init' && !hasUserAfter;
  setSessionDone(isDone);
}
```

This is a 4-way branch that reverse-engineers server state from block contents. Every new edge case (empty blocks between turns, agent waiting for input, session reconstructed from DB) requires another conditional.

---

## 2. Proposed Design

### Core Principle: Server Tells Client the Phase

Instead of the client inferring state from blocks, the server sends an explicit `phase` field with every message. The client renders what it's told.

### New: Session Phase Enum

Replace the three-way state with a single authoritative phase that the server computes and includes in every WebSocket message:

```typescript
type SessionPhase =
  | "starting"     // Session object exists or will exist, no blocks yet
  | "streaming"    // Agent is producing output
  | "waiting"      // Agent ended a turn, waiting for human input (AskUserQuestion, ExitPlanMode)
  | "done"         // Session complete (success, error, or abort)
  | "idle"         // No session, no agent — historical blocks from disk (verify/done tasks)
```

### Change 1: Add `phase` to WebSocket protocol

Every server→client message gains a top-level `phase` field:

```typescript
// Updated AgentWsServerMsg
type AgentWsServerMsg =
  | { type: 'replay'; blocks: AgentBlock[]; phase: SessionPhase }
  | { type: 'block';  block: AgentBlock;    phase: SessionPhase }
  | { type: 'stream_delta'; text: string }   // no phase needed, always "streaming"
  | { type: 'phase';  phase: SessionPhase }  // phase-only update (no new block)
  | { type: 'error';  error: string };
```

The `live: boolean` field is removed — `phase` subsumes it.

### Change 2: Server computes phase from session state

Add a `getSessionPhase()` function in `agent-session.ts`:

```typescript
function getSessionPhase(session: AgentRuntimeSession | null, hasStoredBlocks: boolean): SessionPhase {
  if (!session) {
    return hasStoredBlocks ? "idle" : "starting";
  }
  if (session.status === "running") {
    return session.blocks.length === 0 ? "starting" : "streaming";
  }
  // session.status is "done" or "error" or "aborted"
  // Check if the session ended on a question/plan — that means "waiting"
  if (session.waitingForInput) {
    return "waiting";
  }
  return "done";
}
```

### Change 3: Add `waitingForInput` flag to AgentRuntimeSession

Instead of scanning blocks client-side to detect AskUserQuestion/ExitPlanMode, the server sets this flag:

```typescript
interface AgentRuntimeSession {
  // ...existing fields...
  waitingForInput?: boolean;  // true when agent ended on AskUserQuestion or ExitPlanMode
}
```

Set in `wireProcess` close handler when `endedOnQuestion || endedOnPlanExit` is detected (this logic already exists at line 132-160 of `agent-session.ts`). Cleared when `continueSession()` is called.

### Change 4: Broadcast phase transitions

When the session phase changes, broadcast a `{ type: 'phase', phase }` message to all connected clients. This happens in:

- `startSession()`: after creating session → broadcast `"starting"`
- `processStreamEvent()`: on first content block → broadcast `"streaming"` (only on transition from starting)
- `wireProcess` close handler: → broadcast `"waiting"` or `"done"`
- `continueSession()`: → broadcast `"streaming"` (new turn starting)

To avoid adding broadcast calls everywhere, wrap the session status transitions in a helper that detects phase changes and broadcasts:

```typescript
function setSessionStatus(session: AgentRuntimeSession, newStatus: AgentRuntimeSession['status'], waitingForInput?: boolean) {
  session.status = newStatus;
  if (waitingForInput !== undefined) session.waitingForInput = waitingForInput;
  const phase = computePhase(session);
  broadcast(session, { type: 'phase', phase });
}
```

### Change 5: Simplify client `useAgentSession`

The entire 4-way branch in the replay handler collapses to:

```typescript
if (msg.type === 'replay') {
  setBlocks(msg.blocks);
  setPhase(msg.phase);
} else if (msg.type === 'block') {
  setBlocks(prev => [...prev, msg.block]);
  setPhase(msg.phase);
} else if (msg.type === 'phase') {
  setPhase(msg.phase);
} else if (msg.type === 'stream_delta') {
  appendDelta(msg.text);
}
```

The `sessionDone` boolean is replaced by the `phase` value. The StructuredPane derives everything from phase:

```typescript
const isRunning = phase === 'starting' || phase === 'streaming';
const isWaiting = phase === 'waiting';
const isDone = phase === 'done' || phase === 'idle';
const showThinking = phase === 'streaming' && !streamingText && /* last block is tool_result/text/user */;
const showStarting = phase === 'starting' && blocks.length === 0;
```

### Change 6: Remove pending client mechanism

With explicit phases, the pending client hack is unnecessary:

**Current flow (buggy):**
1. Client connects before session exists
2. Server returns `{ replay, blocks: [], live: false }`
3. Client enters ambiguous state — is this a task that hasn't started or one with no blocks?
4. Server registers client as "pending"
5. When session starts, server promotes pending clients and sends another replay

**New flow:**
1. Client connects before session exists
2. Server checks: is `agentStatus` queued/starting/running for this task? → phase is `"starting"`
3. Server returns `{ type: 'replay', blocks: [], phase: 'starting' }`
4. Client immediately shows "Starting session..." — no ambiguity
5. When session starts and first block arrives, server broadcasts `{ type: 'block', block, phase: 'streaming' }` to all attached clients

The key insight: when no session exists but the task is in-progress, we need to look at the Task DB `agentStatus` to determine the phase. The `attachAgentWsWithProject` function already receives `projectId` and can read the task:

```typescript
// agent-session-server.ts — updated
export async function attachAgentWsWithProject(taskId, projectId, ws) {
  const session = getSession(taskId);

  if (session) {
    const phase = computePhase(session);
    ws.send(JSON.stringify({ type: 'replay', blocks: session.blocks, phase }));
    attachClient(taskId, ws);
  } else {
    const blocks = await getTaskAgentBlocks(taskId);
    const task = await getTask(projectId, taskId);
    const isAgentExpected = task?.agentStatus === 'queued' || task?.agentStatus === 'starting' || task?.agentStatus === 'running';
    const phase: SessionPhase = isAgentExpected ? 'starting' : (blocks.length > 0 ? 'idle' : 'idle');
    ws.send(JSON.stringify({ type: 'replay', blocks, phase }));
    // Still need to attach as client so when session starts, it receives blocks
    attachClient(taskId, ws);  // attachClient creates session entry if needed, or we keep addPendingClient but rename to "pre-attach"
  }
  // ...message handlers unchanged...
}
```

We still need _some_ mechanism to deliver blocks to clients that connected before the session existed. But instead of the pendingClients two-phase dance, we simply always call `attachClient` (which creates a lightweight holding entry) and when `startSession` creates the real session, it absorbs those clients. This is structurally the same as pendingClients but cleaner — it's just "pre-attached clients" and the replay they already received told them `phase: 'starting'`.

### Change 7: TaskAgentDetail no longer needs to pre-fetch blocks for verify

Currently `TaskAgentDetail` fetches blocks via HTTP for verify tasks (`prefetchedBlocks`) because the WebSocket replay might be slow or empty. With the new design:

- The WebSocket replay already returns blocks + `phase: 'idle'` or `phase: 'waiting'`
- The client shows the correct state immediately from the replay
- The HTTP pre-fetch (`/api/projects/.../agent-blocks`) can be removed for verify tasks

For `done` tasks, the `staticLog` / `fetchedBlocks` path (HTTP-only, no WebSocket) remains unchanged — these are read-only historical views.

---

## 3. Summary of Changes

| File | Change | Scope |
|------|--------|-------|
| `types.ts` | Add `SessionPhase` type. Update `AgentWsServerMsg` to include `phase`, add `'phase'` message type, remove `live` field | Small |
| `agent-session.ts` | Add `waitingForInput` to `AgentRuntimeSession`. Add `computePhase()` helper. Add `setSessionStatus()` that broadcasts phase changes. Set `waitingForInput` in `wireProcess` close handler. Clear it in `continueSession()`. | Medium |
| `agent-session-server.ts` | Compute phase in `attachAgentWsWithProject` using `computePhase()` or task DB fallback. Send `phase` in replay. Remove `addPendingClient` (replace with plain `attachClient` + pre-attached tracking). | Medium |
| `useAgentSession.ts` | Replace `sessionDone: boolean` with `phase: SessionPhase`. Replace inference logic with direct `phase` reads from server messages. Remove all block-scanning conditionals. | Medium — big simplification |
| `StructuredPane.tsx` | Replace `sessionDone` usage with `phase` comparisons. | Small |
| `agent-session.ts` (broadcast) | Include `phase` in `broadcast` calls for `block` messages. Add `phase`-only broadcast on transitions. | Small |

### What stays the same

- The Task DB `agentStatus` field and how `processQueue()` sets it — unchanged
- The `wireProcess` close handler logic (persist blocks, update task, detect questions/plans) — unchanged, just adds `waitingForInput` flag
- All features: follow-ups, plan approval, AskUserQuestion, CLI mode, branch preview — unchanged
- The `blocks: AgentBlock[]` model — unchanged
- The `stream_delta` messages — unchanged

### What gets removed

- `pendingClients` map and `addPendingClient()` / promotion logic
- Client-side block scanning to infer `sessionDone`
- The `live: boolean` field on replay messages
- The `prefetchedBlocks` HTTP fetch in `TaskAgentDetail` for verify tasks
- The `initialBlocks` prop threading through StructuredPane → useAgentSession

---

## 4. Migration Path

This can be implemented incrementally:

1. **Add `phase` to server messages** (backward-compatible — client ignores unknown fields)
2. **Update client to read `phase`** when present, fall back to old inference when absent
3. **Remove old inference code** and `live` field once the new path is confirmed working
4. **Remove pending client mechanism** last, after verifying pre-attach works

The total change is ~6 files, ~200 lines modified, with the client getting significantly simpler (net deletion of ~30 lines of complex conditionals).
