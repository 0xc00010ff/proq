'use client';

import React, { createContext, useContext } from 'react';
import type { PanelSlotId } from '@/lib/types';

interface PanelSlotContextValue {
  slot: PanelSlotId;
  /** Begin a mouse-driven resize of the upper/lower divider. Only set on the lower slot. */
  beginLowerResize?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const Ctx = createContext<PanelSlotContextValue | null>(null);

export function PanelSlotProvider({
  slot,
  beginLowerResize,
  children,
}: {
  slot: PanelSlotId;
  beginLowerResize?: (e: React.MouseEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={{ slot, beginLowerResize }}>{children}</Ctx.Provider>;
}

export function usePanelSlot(): PanelSlotContextValue | null {
  return useContext(Ctx);
}
