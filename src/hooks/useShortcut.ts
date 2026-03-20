import { useEffect } from 'react';
import { getShortcut, type ShortcutDef } from '@/lib/shortcuts';

function matches(e: KeyboardEvent, def: ShortcutDef): boolean {
  if (e.key !== def.key) return false;
  if (!!def.meta !== (e.metaKey || e.ctrlKey)) return false;
  if (!!def.alt !== e.altKey) return false;
  if (!!def.shift !== e.shiftKey) return false;
  return true;
}

/**
 * Bind a handler to a registered shortcut by id.
 * The shortcut definition (key combo, modifiers) comes from the registry.
 * Pass `enabled = false` to temporarily disable.
 */
export function useShortcut(
  id: string,
  handler: (e: KeyboardEvent) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const def = getShortcut(id);
    if (!def) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[useShortcut] Unknown shortcut id: "${id}"`);
      }
      return;
    }

    const listener = (e: KeyboardEvent) => {
      if (def.ignoreInputFocus) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      }
      if (matches(e, def)) {
        e.preventDefault();
        handler(e);
      }
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [id, handler, enabled]);
}
