'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  PanelKind,
  PanelLayout,
  PanelSlotId,
  PanelView,
  ViewType,
} from '@/lib/types';
import { canHideSlot, defaultPanelLayout, defaultViewForKind } from '@/lib/panels';

const PERSIST_DEBOUNCE_MS = 400;

/**
 * Manages a project's three-panel layout: visibility, view kind per slot,
 * inline view-state edits (e.g. kanban viewType), and debounced persistence.
 */
export function usePanelLayout(projectId: string, initial: PanelLayout) {
  const [layout, setLayout] = useState<PanelLayout>(initial ?? defaultPanelLayout());

  // Re-hydrate when navigating between projects.
  const lastProjectId = useRef(projectId);
  useEffect(() => {
    if (lastProjectId.current !== projectId) {
      lastProjectId.current = projectId;
      setLayout(initial ?? defaultPanelLayout());
    }
  }, [projectId, initial]);

  // Debounced persist on any change after the initial mount.
  const dirtyRef = useRef(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!dirtyRef.current) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    const snapshot = layout;
    persistTimer.current = setTimeout(() => {
      fetch(`/api/projects/${projectId}/panels`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      }).catch(() => {});
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [layout, projectId]);

  const update = useCallback((next: PanelLayout) => {
    dirtyRef.current = true;
    setLayout(next);
  }, []);

  const setSlotVisible = useCallback(
    (slot: PanelSlotId, visible: boolean) => {
      setLayout((cur) => {
        if (cur[slot].visible === visible) return cur;
        // Refuse to hide the last visible slot.
        if (!visible && !canHideSlot(cur, slot)) return cur;
        dirtyRef.current = true;
        return { ...cur, [slot]: { ...cur[slot], visible } };
      });
    },
    [],
  );

  const setSlotKind = useCallback(
    (slot: PanelSlotId, kind: PanelKind) => {
      setLayout((cur) => {
        if (cur[slot].view.kind === kind) return cur;
        dirtyRef.current = true;
        return {
          ...cur,
          [slot]: { ...cur[slot], view: defaultViewForKind(kind) },
        };
      });
    },
    [],
  );

  const setSlotView = useCallback(
    (slot: PanelSlotId, view: PanelView) => {
      setLayout((cur) => {
        if (cur[slot].view === view) return cur;
        dirtyRef.current = true;
        return { ...cur, [slot]: { ...cur[slot], view } };
      });
    },
    [],
  );

  /** Update kanban's viewType for whichever slot currently holds the kanban. */
  const setKanbanViewType = useCallback((viewType: ViewType) => {
    setLayout((cur) => {
      let changed = false;
      const next: PanelLayout = { ...cur };
      for (const slot of ['upperLeft', 'upperRight', 'lower'] as PanelSlotId[]) {
        const ps = cur[slot];
        if (ps.view.kind === 'kanban' && ps.view.viewType !== viewType) {
          next[slot] = { ...ps, view: { kind: 'kanban', viewType } };
          changed = true;
        }
      }
      if (!changed) return cur;
      dirtyRef.current = true;
      return next;
    });
  }, []);

  return {
    layout,
    update,
    setSlotVisible,
    setSlotKind,
    setSlotView,
    setKanbanViewType,
  };
}
