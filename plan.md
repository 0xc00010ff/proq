# Plan: Rename Parallel → Worktrees + New Parallel Mode

## Summary

Introduce a third execution mode **"Worktrees"** that inherits all current parallel-mode behavior (isolated git worktrees per task, preview before merge). Repurpose the **"Parallel"** name for a new mode: multiple tasks run concurrently on the **same branch** (like sequential but without queuing). Add description alt-text to each mode in the dropdown, and show an info modal when selecting Parallel or Worktrees.

## Changes

### 1. Types (`src/lib/types.ts`)
- Change `ExecutionMode` from `'sequential' | 'parallel'` to `'sequential' | 'parallel' | 'worktrees'`
- Update `ProqSettings.executionMode` to match

### 2. API Route (`src/app/api/projects/[id]/execution-mode/route.ts`)
- Add `'worktrees'` to the validation check

### 3. Agent Dispatch (`src/lib/agent-dispatch.ts`)
- **`dispatchTask()`**: Change `executionMode === 'parallel'` worktree creation check → `executionMode === 'worktrees'`
- **`getInitialAgentStatus()`**: Both `'parallel'` and `'worktrees'` return `"starting"` (no queuing)
- **`processQueue()`**: Both `'parallel'` and `'worktrees'` launch all pending tasks. Only `'sequential'` gates.

### 4. Frontend — Execution Mode Dropdowns (3 locations)
Files: `KanbanBoard.tsx`, `ListView.tsx`, `GridView.tsx`

Each dropdown gets three items instead of two:
- **Sequential** — `ListOrderedIcon` — alt: "One task at a time, queued in order"
- **Parallel** — `LayersIcon` — alt: "Multiple tasks at once on the same branch"
- **Worktrees** — `GitBranchIcon` — alt: "Each task gets its own branch, preview before merge"

The trigger button shows the icon + label for the current mode.

### 5. Frontend — Page State & Handlers (`src/app/projects/[id]/page.tsx`)
- Rename `showParallelModal` → `showModeInfoModal` and track which mode is pending: `'parallel' | 'worktrees' | null`
- `handleExecutionModeChange`: Show info modal for both `parallel` and `worktrees` (not just parallel)
- `applyParallelMode` → generalize to `applyPendingMode()` that applies whichever mode was pending
- Update `ParallelModeModal` usage to be a reusable info modal with mode-specific content

### 6. Modal (`src/components/ParallelModeModal.tsx`)
Rename to `ExecutionModeModal.tsx` (or keep file, add mode prop). Accept a `mode: 'parallel' | 'worktrees'` prop:

**Parallel mode content:**
- Tasks run simultaneously on the same branch
- No queuing — all in-progress tasks launch immediately
- Best when tasks touch different files and won't conflict

**Worktrees mode content (current parallel content, refined):**
- Each task runs on its own isolated git worktree
- Preview changes via the Preview button before merging
- When marked Done, branch auto-merges into main

### 7. DB Layer (`src/lib/db.ts`)
- No structural change needed — `setExecutionMode` already stores arbitrary strings. Just need to ensure `getExecutionMode` default is still `'sequential'`.

## Files Modified
1. `src/lib/types.ts`
2. `src/app/api/projects/[id]/execution-mode/route.ts`
3. `src/lib/agent-dispatch.ts`
4. `src/components/KanbanBoard.tsx`
5. `src/components/ListView.tsx`
6. `src/components/GridView.tsx`
7. `src/app/projects/[id]/page.tsx`
8. `src/components/ParallelModeModal.tsx` → becomes `ExecutionModeInfoModal` (or add mode prop)
