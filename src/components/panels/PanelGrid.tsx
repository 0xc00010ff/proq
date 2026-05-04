'use client';

import React, { useCallback, useRef } from 'react';
import { Group, Panel, Separator, useGroupRef, type Layout } from 'react-resizable-panels';
import type { PanelLayout, PanelSlotId } from '@/lib/types';
import { PanelSlotProvider } from './panel-slot-context';

interface PanelGridProps {
  layout: PanelLayout;
  /** Called with a fresh layout (sizes updated) after the user finishes a drag. */
  onSizesChanged: (layout: PanelLayout) => void;
  /** Renders the contents of a given slot — called once per visible slot. */
  renderPanel: (slot: PanelSlotId) => React.ReactNode;
}

const MIN_PCT = 10;

/**
 * Three-slot resizable layout: UL/UR share an upper row over a full-width Lower.
 * Each slot is collapsible by hiding it from the layout — the remaining slots
 * automatically expand to fill.
 */
export function PanelGrid({ layout, onSizesChanged, renderPanel }: PanelGridProps) {
  const { upperLeft: ul, upperRight: ur, lower } = layout;

  const ulVisible = ul.visible;
  const urVisible = ur.visible;
  const upperVisible = ulVisible || urVisible;
  const lowerVisible = lower.visible;

  // Stash latest layout for callbacks to read without retriggering effects.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Imperative handle for the outer Group so the Lower panel's sub-nav
  // background can drag-resize the upper/lower divider directly.
  const outerGroupRef = useGroupRef();
  const outerGroupElRef = useRef<HTMLDivElement | null>(null);

  const beginLowerResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only react to the empty background of the sub-nav row, not its children.
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;
    const groupEl = outerGroupElRef.current;
    const groupApi = outerGroupRef.current;
    if (!groupEl || !groupApi) return;
    e.preventDefault();
    const rect = groupEl.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const lowerPct = ((rect.bottom - ev.clientY) / rect.height) * 100;
      const clamped = Math.max(MIN_PCT, Math.min(100 - MIN_PCT, lowerPct));
      groupApi.setLayout({ upper: 100 - clamped, lower: clamped });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const final = groupApi.getLayout();
      const lowerSize = final.lower;
      const cur = layoutRef.current;
      if (typeof lowerSize === 'number' && Math.abs((cur.lower.sizePct ?? 0) - lowerSize) >= 0.01) {
        onSizesChanged({ ...cur, lower: { ...cur.lower, sizePct: lowerSize } });
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [onSizesChanged, outerGroupRef]);

  const handleOuterLayoutChanged = useCallback(
    (next: Layout) => {
      const lowerSize = next.lower;
      if (typeof lowerSize !== 'number') return;
      const cur = layoutRef.current;
      if (Math.abs((cur.lower.sizePct ?? 0) - lowerSize) < 0.01) return;
      onSizesChanged({
        ...cur,
        lower: { ...cur.lower, sizePct: lowerSize },
      });
    },
    [onSizesChanged],
  );

  const handleUpperLayoutChanged = useCallback(
    (next: Layout) => {
      const ulSize = next.upperLeft;
      const urSize = next.upperRight;
      const cur = layoutRef.current;
      if (typeof ulSize === 'number' && typeof urSize === 'number') {
        if (
          Math.abs(cur.upperLeft.sizePct - ulSize) < 0.01 &&
          Math.abs(cur.upperRight.sizePct - urSize) < 0.01
        )
          return;
        onSizesChanged({
          ...cur,
          upperLeft: { ...cur.upperLeft, sizePct: ulSize },
          upperRight: { ...cur.upperRight, sizePct: urSize },
        });
      }
    },
    [onSizesChanged],
  );

  // ── Defensive: nothing visible. Should be prevented by toggle UI. ──
  if (!upperVisible && !lowerVisible) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-xs">
        No panels visible
      </div>
    );
  }

  const upperSizePct = lowerVisible ? Math.max(MIN_PCT, 100 - lower.sizePct) : 100;
  const lowerSizePct = upperVisible ? Math.max(MIN_PCT, lower.sizePct) : 100;

  // The Group component re-uses panel sizes by id, so a stable defaultLayout
  // ensures sizing survives toggling visibility.
  const outerDefaultLayout: Layout = {};
  if (upperVisible) outerDefaultLayout.upper = upperSizePct;
  if (lowerVisible) outerDefaultLayout.lower = lowerSizePct;

  const innerDefaultLayout: Layout = {};
  if (ulVisible) innerDefaultLayout.upperLeft = ulVisible && urVisible ? ul.sizePct : 100;
  if (urVisible) innerDefaultLayout.upperRight = ulVisible && urVisible ? ur.sizePct : 100;

  return (
    <Group
      orientation="vertical"
      id="proq-panel-root"
      className="flex-1 min-h-0 min-w-0"
      defaultLayout={outerDefaultLayout}
      onLayoutChanged={handleOuterLayoutChanged}
      groupRef={outerGroupRef}
      elementRef={outerGroupElRef}
    >
      {upperVisible && (
        <Panel id="upper" defaultSize={upperSizePct} minSize={MIN_PCT} className="min-h-0 min-w-0">
          {ulVisible && urVisible ? (
            <Group
              orientation="horizontal"
              id="proq-panel-upper"
              className="h-full w-full"
              defaultLayout={innerDefaultLayout}
              onLayoutChanged={handleUpperLayoutChanged}
            >
              <Panel id="upperLeft" defaultSize={ul.sizePct} minSize={MIN_PCT} className="min-h-0 min-w-0">
                <PanelSlotProvider slot="upperLeft">{renderPanel('upperLeft')}</PanelSlotProvider>
              </Panel>
              <PanelSeparator orientation="horizontal" />
              <Panel id="upperRight" defaultSize={ur.sizePct} minSize={MIN_PCT} className="min-h-0 min-w-0">
                <PanelSlotProvider slot="upperRight">{renderPanel('upperRight')}</PanelSlotProvider>
              </Panel>
            </Group>
          ) : ulVisible ? (
            <PanelSlotProvider slot="upperLeft">{renderPanel('upperLeft')}</PanelSlotProvider>
          ) : (
            <PanelSlotProvider slot="upperRight">{renderPanel('upperRight')}</PanelSlotProvider>
          )}
        </Panel>
      )}
      {upperVisible && lowerVisible && <PanelSeparator orientation="vertical" />}
      {lowerVisible && (
        <Panel id="lower" defaultSize={lowerSizePct} minSize={MIN_PCT} className="min-h-0 min-w-0">
          <PanelSlotProvider slot="lower" beginLowerResize={upperVisible ? beginLowerResize : undefined}>
            {renderPanel('lower')}
          </PanelSlotProvider>
        </Panel>
      )}
    </Group>
  );
}

/**
 * Visible 1-px divider with a wider invisible hit target. `orientation` matches
 * the parent Group's orientation: `'horizontal'` = drag along x (vertical bar
 * between L/R panels), `'vertical'` = drag along y (horizontal bar between rows).
 */
function PanelSeparator({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  const isVertical = orientation === 'vertical';
  return (
    <Separator
      className={
        isVertical
          ? 'group h-[5px] -my-[2px] cursor-row-resize relative z-10 outline-none'
          : 'group w-[5px] -mx-[2px] cursor-col-resize relative z-10 outline-none'
      }
    >
      <span
        className={
          isVertical
            ? 'absolute inset-x-0 top-1/2 h-px bg-border-default group-hover:bg-bronze-800 group-data-[active=true]:bg-bronze-800 transition-colors pointer-events-none'
            : 'absolute inset-y-0 left-1/2 w-px bg-border-default group-hover:bg-bronze-800 group-data-[active=true]:bg-bronze-800 transition-colors pointer-events-none'
        }
      />
    </Separator>
  );
}
