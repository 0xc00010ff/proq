import type { PanelLayout, PanelSlotId, PanelView, PanelKind } from './types';
import { PANELS_VERSION } from './types';

/** Default sizes per slot — used by the layout factory and to reset sizes on snap-close. */
export const DEFAULT_PANEL_SIZE_PCT = {
  upperLeft: 50,
  upperRight: 50,
  lower: 40,
} as const;

/** Default layout for new projects: kanban (UL) + workbench (Lower), Live hidden. */
export function defaultPanelLayout(): PanelLayout {
  return {
    upperLeft: {
      visible: true,
      view: { kind: 'kanban', viewType: 'kanban' },
      sizePct: DEFAULT_PANEL_SIZE_PCT.upperLeft,
    },
    upperRight: {
      visible: false,
      view: { kind: 'live' },
      sizePct: DEFAULT_PANEL_SIZE_PCT.upperRight,
    },
    lower: {
      visible: true,
      view: { kind: 'agents-workbench' },
      sizePct: DEFAULT_PANEL_SIZE_PCT.lower,
    },
  };
}

/** Default view state for a given kind — used when switching a panel's type. */
export function defaultViewForKind(kind: PanelKind): PanelView {
  switch (kind) {
    case 'kanban':           return { kind: 'kanban', viewType: 'kanban' };
    case 'live':             return { kind: 'live' };
    case 'code':             return { kind: 'code' };
    case 'agents-workbench': return { kind: 'agents-workbench' };
    case 'agent-editor':     return { kind: 'agent-editor' };
  }
}

/** Returns true if at least one panel will remain visible after toggling `slot` off. */
export function canHideSlot(layout: PanelLayout, slot: PanelSlotId): boolean {
  const others: PanelSlotId[] = (['upperLeft', 'upperRight', 'lower'] as PanelSlotId[]).filter(s => s !== slot);
  return others.some(s => layout[s].visible);
}

/**
 * Resolve the layout to use, applying a one-time reset if the stored version
 * is missing or older than {@link PANELS_VERSION}. Returns `{ layout, version }`.
 */
export function resolveLayout(
  stored: PanelLayout | undefined,
  storedVersion: number | undefined,
): { layout: PanelLayout; version: number } {
  if (!stored || (storedVersion ?? 0) < PANELS_VERSION) {
    return { layout: defaultPanelLayout(), version: PANELS_VERSION };
  }
  return { layout: stored, version: storedVersion! };
}
