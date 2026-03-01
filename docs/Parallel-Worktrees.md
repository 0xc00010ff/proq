# Parallel Mode & Worktrees

This is the deep dive on parallel execution and git worktrees. For a usage-level overview, see [Getting Started](./Getting-Started.md). For broader architecture context, see [Architecture](./Architecture.md).

## Overview

In parallel mode, proq runs multiple agents simultaneously on the same project. Each task gets its own isolated git worktree on a dedicated branch (`proq/<shortId>`), so agents never interfere with each other. Merging is deferred until the human marks the task "done," and a preview branch mechanism lets the user inspect work before merging.

Sequential mode doesn't use worktrees at all -- every task runs directly in the project directory, one at a time.

## How Worktrees Are Created

When a task moves to in-progress in parallel mode, `dispatchTask()` in `agent-dispatch.ts` calls `createWorktree(projectPath, shortId)`:

```
project-root/
  .proq-worktrees/
    a1b2c3d4/          <-- isolated working copy
      src/
      package.json
      ...
```

- A new branch `proq/a1b2c3d4` is created from the current HEAD of main.
- The worktree directory is `.proq-worktrees/<shortId>/`.
- `.proq-worktrees/` is added to `.gitignore` automatically.
- The task object stores `worktreePath` and `branch` for later reference.

Plan-mode and answer-mode tasks skip worktree creation since they don't modify files.

## Agent Execution

The agent runs inside the worktree, not the main project directory:

```
tmux new-session -d -s 'mc-a1b2c3d4' -c '/path/to/project/.proq-worktrees/a1b2c3d4'
```

The agent commits its work to the `proq/a1b2c3d4` branch. When finished, it curls back to the API to move itself to verify. In parallel mode, multiple tmux sessions run concurrently in their own worktrees.

## Task Lifecycle

```
todo ── in-progress ── verify ── done
         │                │         │
         │ worktree       │ keep    │ merge into
         │ created        │ alive   │ main, remove
         │                │ for     │ worktree
         │                │ preview │
```

### in-progress

- Worktree + branch created (parallel only).
- Agent dispatched in worktree directory.
- `dispatch` cycles through `"queued"` -> `"starting"` -> `"running"`.

### in-progress -> verify

- **No merge happens.** The worktree and branch stay alive.
- The branch becomes available for preview via the TopBar branch switcher and the "Preview" button in the task modal.

### verify -> done (Merge & Complete)

1. If the user is previewing this task's branch, switch back to main first.
2. Delete any `proq/<shortId>/preview` branch.
3. `git merge 'proq/<shortId>' --no-ff` into main.
4. On success: remove worktree, delete branch, clear task fields, schedule cleanup.
5. On conflict: task stays in verify with `mergeConflict` set (see Conflicts below).

### in-progress -> done (skip verify)

Same as above -- merge immediately. If conflict, the task lands in verify instead.

### any -> todo (discard)

- If the user is on this task's branch, switch to main.
- Remove the worktree and branch. No merge -- work is discarded.
- If the task was in-progress, abort the tmux session.

### delete

Same as discard -- clean up worktree/branch, abort if running.

## Preview Branches

Git won't let two worktrees check out the same branch, so the user can't `git checkout proq/a1b2c3d4` in the main project directory while the worktree holds it. Instead, proq creates a **preview branch**:

```
proq/a1b2c3d4            <-- worktree branch (agent commits here)
proq-preview/a1b2c3d4    <-- preview branch (user views here)
```

### How it works

When the user clicks "Preview" or selects a `proq/*` branch from the TopBar dropdown, `checkoutBranch()`:

1. Stashes any uncommitted changes (`proq-auto-stash`).
2. Resolves the commit hash at the tip of `proq/a1b2c3d4`.
3. Creates `proq-preview/a1b2c3d4` pointing at that commit.
4. Checks out the preview branch normally.
5. If leaving a different preview branch, deletes the old one.

### Refresh on poll

The dashboard polls `PATCH /api/projects/<id>/git` every 5 seconds. If the user is on a preview branch and the source `proq/*` branch has advanced (agent committed), the preview branch is fast-forwarded:

```
git merge --ff-only 'proq/a1b2c3d4'
```

The dev server picks up the new files via hot-reload.

### Transparency

Preview branches are an implementation detail. The git API:

- Filters `proq-preview/*` from the branch list.
- Reports `proq/a1b2c3d4` as the current branch even when actually on `proq-preview/a1b2c3d4`.

The user sees "I'm on proq/a1b2c3d4" and never needs to know about the preview branch.

## Branch Switcher (TopBar)

The TopBar shows a branch indicator between the project name and the tab switcher. Clicking it opens a dropdown with all local branches:

- **main** is always listed first.
- **proq/\*** branches are listed next, annotated with their task title.
- Other branches appear below.
- Preview branches are hidden.

Selecting a branch calls `POST /api/projects/<id>/git` with `{ branch: "proq/a1b2c3d4" }`. The branch switcher works in both sequential and parallel modes -- in sequential mode it's just a plain branch switcher.

## Task Modal Controls

When a task is in verify and has a `branch`:

- **Not previewing**: A "Preview" button appears in the worktree status bar.
- **Currently previewing**: Shows "Viewing" indicator + "Back to main" button.
- **Complete button**: Reads "Merge & Complete" instead of "Complete".

## Auto-Stash

The auto-stash system preserves uncommitted changes on main when the user switches to a task preview branch, and restores them when they return.

### Lifecycle

```
main (dirty)
  │
  ├─ checkoutBranch("proq/A")
  │   1. git status --porcelain → dirty
  │   2. Check top stash — no existing proq-auto-stash → push one
  │   3. Checkout proq-preview/A (clean working tree)
  │   4. Target is proq/* → skip pop
  │
  ├─ checkoutBranch("proq/B")    (switching between previews)
  │   1. git status → clean
  │   2. No stash needed
  │   3. Checkout proq-preview/B, delete proq-preview/A
  │   4. Target is proq/* → skip pop
  │
  └─ checkoutBranch("main")
      1. git status → clean
      2. No stash needed
      3. Checkout main, delete proq-preview/B
      4. Target is not proq/* → check top stash → "proq-auto-stash" → pop
      5. Main is dirty again ✓
```

### Key behaviors

- **Push**: Only if the working tree is dirty AND there isn't already a `proq-auto-stash` on top. This prevents stacking duplicates from repeated branch switches.
- **Pop on user switch**: When `checkoutBranch` arrives on a non-proq branch (e.g., main via the branch dropdown), it unconditionally checks the top stash and pops if it's a `proq-auto-stash`. The check is unconditional — the stash may have been pushed in a different `checkoutBranch` call.
- **Skip pop on system switch**: When the system switches to main for merge/cleanup (via `ensureNotOnTaskBranch`), it passes `{ skipStashPop: true }` to avoid dirtying the working tree before `git merge`. After the merge or worktree removal completes, `popAutoStash()` is called explicitly.
- **Stash stays parked between previews**: Switching proq/A → proq/B doesn't push or pop — the original stash remains safely on the stack until the user returns to main.
- **Error rollback**: If checkout fails and we're still on the original branch, the stash is popped immediately so the user's changes aren't lost.

## Merge Conflicts

When `mergeWorktree()` fails:

1. Conflicting files are captured via `git diff --name-only --diff-filter=U`.
2. The merge is aborted (`git merge --abort`).
3. The task's `mergeConflict` field is set with `{ error, files, branch }`.
4. The task stays in (or moves back to) verify.
5. The UI shows a conflict banner with the file list and a "View Details" button.

### Recovery

The user can click "Redispatch" in the conflict modal:

1. Task moves to todo (worktree removed, branch deleted).
2. Task moves to in-progress (fresh worktree from current main).
3. Agent runs again with the latest upstream state.

This is a full reset -- the agent starts from scratch on a new branch.

## Cleanup

After a task moves to done, `scheduleCleanup()` sets a 1-hour timer:

1. Kills the tmux session if still alive.
2. Reads the session log from the bridge socket.
3. Saves it to the task's `agentLog` field.
4. Removes socket/log files.

The timer is cancelled if the task re-enters in-progress (e.g., moved back from verify).

## Sequential Mode Comparison

| Aspect          | Sequential               | Parallel                          |
| --------------- | ------------------------ | --------------------------------- |
| Worktrees       | No                       | Yes, one per task                 |
| Branches        | No task branches         | `proq/<shortId>` per task         |
| Concurrency     | One task at a time       | All tasks dispatched immediately  |
| Agent directory | Main project dir         | `.proq-worktrees/<shortId>/`      |
| Merge timing    | N/A (commits go to main) | Deferred to done                  |
| Preview         | N/A                      | Via `proq-preview/*` branches     |
| Mode switch     | Allowed when idle        | Blocked while tasks are in-flight |

## Relevant Files

| File                                                | Role                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/lib/worktree.ts`                               | All git operations: create/remove/merge worktrees, checkout/preview/refresh branches, auto-stash |
| `src/lib/agent-dispatch.ts`                         | Task dispatch, processQueue, parallel vs sequential logic                                        |
| `src/app/api/projects/[id]/git/route.ts`            | Branch API: list, switch, refresh preview                                                        |
| `src/app/api/projects/[id]/tasks/[taskId]/route.ts` | Status transition logic, merge/discard on transitions                                            |
| `src/app/api/projects/[id]/tasks/reorder/route.ts`  | Same transitions for drag-drop moves                                                             |
| `src/components/TopBar.tsx`                         | Branch switcher dropdown                                                                         |
| `src/components/TaskAgentModal.tsx`                 | Preview/merge controls in task detail                                                            |
| `src/app/projects/[id]/page.tsx`                    | Dashboard wiring: branch state, polling, taskBranchMap                                           |
