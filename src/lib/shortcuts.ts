/**
 * Keyboard Shortcut Registry
 *
 * All WEB-LAYER shortcuts are defined here as data. This is the single source
 * of truth for shortcut definitions, display formatting, and conflict detection.
 *
 * Electron-native shortcuts (Cmd+N, Cmd+[, Cmd+], standard Edit/View/Window
 * menus) live in desktop/src/main/index.ts and are not duplicated here.
 */

export type ShortcutScope = 'global' | 'modal' | 'code' | 'chat';

export interface ShortcutDef {
  id: string;
  key: string;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  scope: ShortcutScope;
  label: string;
  /** Skip when focus is in INPUT/TEXTAREA/SELECT */
  ignoreInputFocus?: boolean;
}

export const SHORTCUTS: ShortcutDef[] = [
  // -- Global --
  { id: 'undo-delete',  key: 'z',          meta: true,               scope: 'global', label: 'Undo delete',     ignoreInputFocus: true },
  { id: 'tab-prev',     key: 'ArrowLeft',  meta: true, alt: true,    scope: 'global', label: 'Previous tab' },
  { id: 'tab-next',     key: 'ArrowRight', meta: true, alt: true,    scope: 'global', label: 'Next tab' },
  { id: 'tab-1',        key: '1',          meta: true,               scope: 'global', label: 'Agents tab' },
  { id: 'tab-2',        key: '2',          meta: true,               scope: 'global', label: 'Project tab' },
  { id: 'tab-3',        key: '3',          meta: true,               scope: 'global', label: 'Live tab' },
  { id: 'tab-4',        key: '4',          meta: true,               scope: 'global', label: 'Code tab' },
  { id: 'toggle-workbench', key: 'j',     meta: true,               scope: 'global', label: 'Toggle workbench' },

  // -- Modal --
  { id: 'close-modal',  key: 'Escape',                               scope: 'modal',  label: 'Close' },
  { id: 'start-task',   key: 'Enter',      meta: true,               scope: 'modal',  label: 'Start task' },

  // -- Code tab --
  { id: 'file-palette',  key: 'p',          meta: true,               scope: 'code',   label: 'Go to file' },
  { id: 'global-search', key: 'f',          meta: true, shift: true,  scope: 'code',   label: 'Search in files' },
];

/** Lookup a shortcut definition by id */
export function getShortcut(id: string): ShortcutDef | undefined {
  return SHORTCUTS.find(s => s.id === id);
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: '\u2190', ArrowRight: '\u2192', ArrowUp: '\u2191', ArrowDown: '\u2193',
  Escape: 'Esc', Enter: '\u21B5', ' ': 'Space',
};

/** Format a shortcut for display, e.g. "\u2318\u2325\u2190" */
export function formatShortcut(def: ShortcutDef): string {
  const parts: string[] = [];
  if (def.meta)  parts.push(isMac ? '\u2318' : 'Ctrl');
  if (def.alt)   parts.push(isMac ? '\u2325' : 'Alt');
  if (def.shift) parts.push('\u21E7');
  parts.push(KEY_LABELS[def.key] ?? def.key.toUpperCase());
  return parts.join('');
}

// Dev-time conflict detection
if (process.env.NODE_ENV === 'development') {
  const seen = new Map<string, string>();
  for (const s of SHORTCUTS) {
    const combo = `${s.meta ? 'M' : ''}${s.alt ? 'A' : ''}${s.shift ? 'S' : ''}+${s.key}@${s.scope}`;
    if (seen.has(combo)) {
      console.warn(`[shortcuts] Conflict: "${s.id}" and "${seen.get(combo)}" share ${combo}`);
    }
    seen.set(combo, s.id);
  }
}
