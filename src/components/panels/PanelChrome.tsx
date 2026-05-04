'use client';

import React from 'react';
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
 * Uniform chrome for every panel: a fixed-height sub-nav row containing the
 * panel-type switcher (left) followed by view-supplied controls, then the
 * view's content fills the remaining height.
 */
export function PanelChrome({ currentKind, onChangeKind, subnavContent, children }: PanelChromeProps) {
  const slotCtx = usePanelSlot();
  const beginResize = slotCtx?.beginLowerResize;
  return (
    <div className="h-full flex flex-col bg-surface-deep min-h-0 min-w-0">
      <div className="h-10 flex items-stretch shrink-0 bg-surface-secondary border-b border-border-default overflow-hidden">
        <PanelTypeSwitcher current={currentKind} onChange={onChangeKind} />
        <div
          className={`flex-1 flex items-stretch min-w-0 overflow-hidden ${beginResize ? 'cursor-row-resize' : ''}`}
          onMouseDown={beginResize}
        >
          {subnavContent}
        </div>
      </div>
      <div className="flex-1 min-h-0 min-w-0 relative">{children}</div>
    </div>
  );
}
