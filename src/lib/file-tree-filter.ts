import fs from 'fs/promises';
import path from 'path';

export const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  '.DS_Store',
  'dist',
  'build',
  '.cache',
  '__pycache__',
  '.pytest_cache',
  'coverage',
  '.nyc_output',
  '.parcel-cache',
  '.proq-worktrees',
  'Thumbs.db',
]);

export async function loadGitignorePatterns(projectRoot: string): Promise<string[]> {
  try {
    const content = await fs.readFile(path.join(projectRoot, '.gitignore'), 'utf-8');
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.replace(/\/$/, ''));
  } catch {
    return [];
  }
}

export function matchesGitignore(name: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p.includes('*')) {
      const regex = new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return regex.test(name);
    }
    return name === p;
  });
}
