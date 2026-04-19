import path from 'path';
import chokidar, { FSWatcher } from 'chokidar';
import {
  IGNORED_NAMES,
  loadGitignorePatterns,
  matchesGitignore,
} from './file-tree-filter';
import { emitFileChange, FileChangeKind } from './task-events';

interface WatcherEntry {
  watcher: FSWatcher;
  projectPath: string;
  refCount: number;
  debounce: Map<string, ReturnType<typeof setTimeout>>;
  gitignorePatterns: string[];
}

const g = globalThis as unknown as {
  __proqFileWatchers?: Map<string, WatcherEntry>;
};
if (!g.__proqFileWatchers) g.__proqFileWatchers = new Map();

const watchers = g.__proqFileWatchers;

const DEBOUNCE_MS = 100;

function shouldIgnore(entry: WatcherEntry, fullPath: string): boolean {
  const rel = path.relative(entry.projectPath, fullPath);
  if (!rel || rel.startsWith('..')) return false;
  const segments = rel.split(path.sep);
  for (const seg of segments) {
    if (IGNORED_NAMES.has(seg)) return true;
    if (matchesGitignore(seg, entry.gitignorePatterns)) return true;
  }
  return false;
}

function scheduleEmit(
  entry: WatcherEntry,
  projectId: string,
  filePath: string,
  kind: FileChangeKind,
) {
  const key = `${kind}:${filePath}`;
  const existing = entry.debounce.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    entry.debounce.delete(key);
    emitFileChange(projectId, filePath, kind);
  }, DEBOUNCE_MS);
  entry.debounce.set(key, timer);
}

async function startWatcher(projectId: string, projectPath: string): Promise<WatcherEntry> {
  const gitignorePatterns = await loadGitignorePatterns(projectPath);

  const entry: WatcherEntry = {
    watcher: null as unknown as FSWatcher,
    projectPath,
    refCount: 0,
    debounce: new Map(),
    gitignorePatterns,
  };

  const watcher = chokidar.watch(projectPath, {
    ignoreInitial: true,
    persistent: true,
    ignorePermissionErrors: true,
    awaitWriteFinish: {
      stabilityThreshold: 50,
      pollInterval: 20,
    },
    ignored: (p: string) => shouldIgnore(entry, p),
  });

  entry.watcher = watcher;

  const kinds: FileChangeKind[] = ['add', 'change', 'unlink', 'addDir', 'unlinkDir'];
  for (const kind of kinds) {
    watcher.on(kind, async (eventPath: string) => {
      // Reload gitignore patterns if .gitignore itself changed.
      if (
        (kind === 'change' || kind === 'add' || kind === 'unlink') &&
        eventPath === path.join(projectPath, '.gitignore')
      ) {
        entry.gitignorePatterns = await loadGitignorePatterns(projectPath);
      }
      scheduleEmit(entry, projectId, eventPath, kind);
    });
  }

  watcher.on('error', (err) => {
    console.error(`[file-watcher] ${projectId}:`, err);
  });

  return entry;
}

export async function subscribeWatcher(projectId: string, projectPath: string): Promise<void> {
  let entry = watchers.get(projectId);
  if (!entry) {
    entry = await startWatcher(projectId, projectPath);
    watchers.set(projectId, entry);
  }
  entry.refCount += 1;
}

export async function unsubscribeWatcher(projectId: string): Promise<void> {
  const entry = watchers.get(projectId);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount > 0) return;
  watchers.delete(projectId);
  for (const t of entry.debounce.values()) clearTimeout(t);
  entry.debounce.clear();
  await entry.watcher.close();
}
