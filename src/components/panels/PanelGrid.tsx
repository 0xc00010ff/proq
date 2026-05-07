'use client';

import React, { useCallback, useRef } from 'react';
import { Group, Panel, Separator, useGroupRef, type Layout } from 'react-resizable-panels';
import type { PanelLayout, PanelSlotId } from '@/lib/types';
import { DEFAULT_PANEL_SIZE_PCT } from '@/lib/panels';
import { PanelSlotProvider } from './panel-slot-context';

interface PanelGridProps {
  layout: PanelLayout;
  /** Called with a fresh layout (sizes updated) after the user finishes a drag. */
  onSizesChanged: (layout: PanelLayout) => void;
  /** Renders the contents of a given slot — called once per visible slot. */
  renderPanel: (slot: PanelSlotId) => React.ReactNode;
}

/**
 * Pixel threshold below which a drag-released panel snaps closed. Lets the user
 * push a panel off-screen by dragging instead of hunting for the toggle button.
 * The lower panel uses a larger threshold because its sub-nav row is taller,
 * making it easy to leave a sliver of bar that looks intentional but isn't.
 */
const SNAP_CLOSE_PX = 64;
const LOWER_SNAP_CLOSE_PX = 88;

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
  const innerGroupRef = useGroupRef();
  const outerGroupElRef = useRef<HTMLDivElement | null>(null);
  const innerGroupElRef = useRef<HTMLDivElement | null>(null);

  const beginLowerResize = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    // Only react to the empty background of the sub-nav row, not its
    // interactive controls. Views often wrap their subnav in their own flex-1
    // div, so we can't rely on e.target === e.currentTarget — instead, walk
    // up from the click target and bail if we hit anything interactive
    // before reaching this wrapper.
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('button, a, input, textarea, select, label, [role="button"], [role="tab"], [data-no-panel-resize]')) return;
    const groupEl = outerGroupElRef.current;
    const groupApi = outerGroupRef.current;
    if (!groupEl || !groupApi) return;
    e.preventDefault();
    const rect = groupEl.getBoundingClientRect();
    const startY = e.clientY;
    const startLayout = groupApi.getLayout();
    const startLowerPct = typeof startLayout.lower === 'number' ? startLayout.lower : 0;
    const prevBodyUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    // Force `grabbing` everywhere for the duration of the drag — overrides
    // any element-level cursor (e.g. `cursor-grab` on the sub-nav itself).
    const cursorStyleEl = document.createElement('style');
    cursorStyleEl.textContent = '*, *::before, *::after { cursor: grabbing !important; }';
    document.head.appendChild(cursorStyleEl);
    const onMove = (ev: MouseEvent) => {
      // Track cursor displacement, not absolute position, so the bar stays
      // pinned to the spot the user grabbed (no edge-snap jump).
      const dyPct = ((ev.clientY - startY) / rect.height) * 100;
      const lowerPct = startLowerPct - dyPct;
      const clamped = Math.max(0, Math.min(100, lowerPct));
      groupApi.setLayout({ upper: 100 - clamped, lower: clamped });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      cursorStyleEl.remove();
      document.body.style.userSelect = prevBodyUserSelect;
      const final = groupApi.getLayout();
      const lowerSize = final.lower;
      const cur = layoutRef.current;
      if (typeof lowerSize !== 'number') return;
      const groupHeight = groupEl.getBoundingClientRect().height;
      const lowerPx = (lowerSize / 100) * groupHeight;
      // Below threshold: snap closed and reset sizePct so the next reopen
      // (via TopBar toggle) lands at a usable default size. The setLayout
      // call overwrites the library's internal layout cache for the current
      // panel-id set; without it the cache holds the tiny drag-end size and
      // the panel reappears invisibly small.
      if (lowerPx < LOWER_SNAP_CLOSE_PX) {
        groupApi.setLayout({
          upper: 100 - DEFAULT_PANEL_SIZE_PCT.lower,
          lower: DEFAULT_PANEL_SIZE_PCT.lower,
        });
        onSizesChanged({
          ...cur,
          lower: { ...cur.lower, visible: false, sizePct: DEFAULT_PANEL_SIZE_PCT.lower },
        });
        return;
      }
      if (Math.abs((cur.lower.sizePct ?? 0) - lowerSize) >= 0.01) {
        onSizesChanged({ ...cur, lower: { ...cur.lower, sizePct: lowerSize } });
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [onSizesChanged, outerGroupRef]);

  const handleOuterLayoutChanged = useCallback(
    (next: Layout) => {
      const lowerSize = next.lower;
      const upperSize = next.upper;
      if (typeof lowerSize !== 'number') return;
      const cur = layoutRef.current;
      const groupHeight = outerGroupElRef.current?.getBoundingClientRect().height ?? 0;
      const lowerPx = (lowerSize / 100) * groupHeight;
      const upperPx = typeof upperSize === 'number' ? (upperSize / 100) * groupHeight : groupHeight;
      const upperRowVisible = cur.upperLeft.visible || cur.upperRight.visible;

      // Snap-close lower when both rows were visible and lower shrunk past
      // threshold. The setLayout call resets the library's cached layout for
      // the current panel-id set so the next reopen lands at a usable default
      // (otherwise it remembers the tiny drag-end size).
      if (cur.lower.visible && upperRowVisible && lowerPx < LOWER_SNAP_CLOSE_PX) {
        outerGroupRef.current?.setLayout({
          upper: 100 - DEFAULT_PANEL_SIZE_PCT.lower,
          lower: DEFAULT_PANEL_SIZE_PCT.lower,
        });
        onSizesChanged({
          ...cur,
          lower: { ...cur.lower, visible: false, sizePct: DEFAULT_PANEL_SIZE_PCT.lower },
        });
        return;
      }
      // Snap-close upper row (hide whichever upper slots were visible) when
      // user pushed it past threshold from the same divider.
      if (cur.lower.visible && upperRowVisible && upperPx < SNAP_CLOSE_PX) {
        outerGroupRef.current?.setLayout({
          upper: 100 - DEFAULT_PANEL_SIZE_PCT.lower,
          lower: DEFAULT_PANEL_SIZE_PCT.lower,
        });
        onSizesChanged({
          ...cur,
          upperLeft: cur.upperLeft.visible
            ? { ...cur.upperLeft, visible: false, sizePct: DEFAULT_PANEL_SIZE_PCT.upperLeft }
            : cur.upperLeft,
          upperRight: cur.upperRight.visible
            ? { ...cur.upperRight, visible: false, sizePct: DEFAULT_PANEL_SIZE_PCT.upperRight }
            : cur.upperRight,
        });
        return;
      }

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
      if (typeof ulSize !== 'number' || typeof urSize !== 'number') return;

      // Snap-close UL or UR when its width drops below the threshold mid-drag.
      // Only relevant when both upper slots are visible (the only time this
      // divider exists).
      if (cur.upperLeft.visible && cur.upperRight.visible) {
        const innerWidth = innerGroupElRef.current?.getBoundingClientRect().width ?? 0;
        const ulPx = (ulSize / 100) * innerWidth;
        const urPx = (urSize / 100) * innerWidth;
        if (ulPx < SNAP_CLOSE_PX) {
          innerGroupRef.current?.setLayout({
            upperLeft: DEFAULT_PANEL_SIZE_PCT.upperLeft,
            upperRight: DEFAULT_PANEL_SIZE_PCT.upperRight,
          });
          onSizesChanged({
            ...cur,
            upperLeft: { ...cur.upperLeft, visible: false, sizePct: DEFAULT_PANEL_SIZE_PCT.upperLeft },
          });
          return;
        }
        if (urPx < SNAP_CLOSE_PX) {
          innerGroupRef.current?.setLayout({
            upperLeft: DEFAULT_PANEL_SIZE_PCT.upperLeft,
            upperRight: DEFAULT_PANEL_SIZE_PCT.upperRight,
          });
          onSizesChanged({
            ...cur,
            upperRight: { ...cur.upperRight, visible: false, sizePct: DEFAULT_PANEL_SIZE_PCT.upperRight },
          });
          return;
        }
      }

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

  // Defensive floor on initial layout sizes; mid-drag the user can pull a
  // panel below this to trigger snap-close (handled in *LayoutChanged callbacks).
  const upperSizePct = lowerVisible ? Math.max(5, 100 - lower.sizePct) : 100;
  const lowerSizePct = upperVisible ? Math.max(5, lower.sizePct) : 100;

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
        <Panel id="upper" defaultSize={upperSizePct} minSize={0} className="min-h-0 min-w-0">
          {ulVisible && urVisible ? (
            <Group
              orientation="horizontal"
              id="proq-panel-upper"
              className="h-full w-full"
              defaultLayout={innerDefaultLayout}
              onLayoutChanged={handleUpperLayoutChanged}
              groupRef={innerGroupRef}
              elementRef={innerGroupElRef}
            >
              <Panel id="upperLeft" defaultSize={ul.sizePct} minSize={0} className="min-h-0 min-w-0">
                <PanelSlotProvider slot="upperLeft">{renderPanel('upperLeft')}</PanelSlotProvider>
              </Panel>
              <PanelSeparator orientation="horizontal" />
              <Panel id="upperRight" defaultSize={ur.sizePct} minSize={0} className="min-h-0 min-w-0">
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
        <Panel id="lower" defaultSize={lowerSizePct} minSize={0} className="min-h-0 min-w-0">
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
