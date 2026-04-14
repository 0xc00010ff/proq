"use client";

import { useState, useCallback, useEffect, type RefObject, type Dispatch, type SetStateAction } from "react";

export type ResizeDirection = "vertical" | "horizontal";

interface UseResizablePanelOptions {
  defaultPercent?: number;
  /** Pixel size below which the panel snaps closed on mouseUp. */
  snapCloseThreshold?: number;
  /** Percent to reset to when snapping closed. */
  closedPercent?: number;
  /** Called on mouseUp with the final size percent (not called on snap-close). */
  onPersist?: (size: number) => void;
  /** Resize direction: "vertical" = bottom panel (height), "horizontal" = right panel (width). Default: "vertical" */
  direction?: ResizeDirection;
}

interface UseResizablePanelReturn {
  percent: number;
  setPercent: Dispatch<SetStateAction<number>>;
  collapsed: boolean;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  isDragging: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
  toggleCollapsed: () => void;
  expand: () => void;
}

export function useResizablePanel(
  containerRef: RefObject<HTMLDivElement | null>,
  options: UseResizablePanelOptions = {},
): UseResizablePanelReturn {
  const {
    defaultPercent = 40,
    snapCloseThreshold = 200,
    closedPercent = defaultPercent,
    onPersist,
    direction = "vertical",
  } = options;

  const [percent, setPercent] = useState(defaultPercent);
  const [collapsed, setCollapsed] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const expand = useCallback(() => {
    setCollapsed((prev) => {
      if (!prev) return prev;
      return false;
    });
    setPercent((prev) => Math.max(prev, 40));
  }, []);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      let pct: number;
      if (direction === "horizontal") {
        // Right-side panel: size = distance from cursor to right edge
        const x = e.clientX - rect.left;
        pct = ((rect.width - x) / rect.width) * 100;
      } else {
        // Bottom panel: size = distance from cursor to bottom edge
        const y = e.clientY - rect.top;
        pct = ((rect.height - y) / rect.height) * 100;
      }

      if (collapsed && pct > 5) {
        setCollapsed(false);
      }
      setPercent(Math.min(100, Math.max(3, pct)));
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();

        let pixelSize: number;
        let pct: number;
        if (direction === "horizontal") {
          const x = e.clientX - rect.left;
          pixelSize = rect.width - x;
          pct = (pixelSize / rect.width) * 100;
        } else {
          const y = e.clientY - rect.top;
          pixelSize = rect.height - y;
          pct = (pixelSize / rect.height) * 100;
        }

        if (pixelSize < snapCloseThreshold) {
          setCollapsed(true);
          setPercent(closedPercent);
        } else if (onPersist) {
          onPersist(Math.min(100, Math.max(3, pct)));
        }
      }
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, collapsed, containerRef, snapCloseThreshold, closedPercent, onPersist, direction]);

  return { percent, setPercent, collapsed, setCollapsed, isDragging, onResizeStart, toggleCollapsed, expand };
}
