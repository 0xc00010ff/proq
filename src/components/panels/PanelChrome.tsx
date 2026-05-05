'use client';

import React, { createContext, useContext, useState } from 'react';
import type { PanelKind } from '@/lib/types';
import { PanelTypeSwitcher } from './PanelTypeSwitcher';
import { usePanelSlot } from './panel-slot-context';

interface PanelChromeProps {
  /** The current view kind for this slot (drives the switcher icon). */
  currentKind: PanelKind;
  /** Called when the user picks a different view from the switcher menu. */
  onChangeKind: (kind: PanelKind) => void;
  /** Sub-nav controls owned by the active view (URL bar, tabs, etc.). Optional. */
  subnavContent?: React.ReactNode;
  /** Inner content of the panel. */
  children: React.ReactNode;
}

/**
 * DOM element of the panel's sub-nav slot, exposed so deep descendants can
 * portal their toolbar into the chrome row instead of stacking another bar.
 */
const PanelSubnavSlotCtx = createContext<HTMLElement | null>(null);
export function usePanelSubnavSlot(): HTMLElement | null {
  return useContext(PanelSubnavSlotCtx);
}

/**
 * Uniform chrome for every panel: a fixed-height sub-nav row containing the
 * panel-type switcher (left) followed by view-supplied controls, then the
 * view's content fills the remaining height.
 */
export function PanelChrome({ currentKind, onChangeKind, subnavContent, children }: PanelChromeProps) {
  const slotCtx = usePanelSlot();
  const beginResize = slotCtx?.beginLowerResize;
  const [subnavSlotEl, setSubnavSlotEl] = useState<HTMLElement | null>(null);
  return (
    <PanelSubnavSlotCtx.Provider value={subnavSlotEl}>
      <div className="h-full flex flex-col bg-surface-deep min-h-0 min-w-0">
        <div className="h-10 flex items-stretch shrink-0 bg-surface-secondary border-b border-border-default overflow-hidden">
          <PanelTypeSwitcher current={currentKind} onChange={onChangeKind} />
          <div
            ref={setSubnavSlotEl}
            className={`flex-1 flex items-stretch min-w-0 overflow-hidden ${beginResize ? 'cursor-grab active:cursor-grabbing' : ''}`}
            onMouseDown={beginResize}
          >
            {subnavContent}
          </div>
        </div>
        <div className="flex-1 min-h-0 min-w-0 relative">{children}</div>
      </div>
    </PanelSubnavSlotCtx.Provider>
  );
}
