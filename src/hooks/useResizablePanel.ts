"use client";

import { useState, useCallback, useEffect, type RefObject, type Dispatch, type SetStateAction } from "react";

interface UseResizablePanelOptions {
  defaultPercent?: number;
  /** Pixel height below which the panel snaps closed on mouseUp. */
  snapCloseThreshold?: number;
  /** Percent to reset to when snapping closed. */
  closedPercent?: number;
  /** Called on mouseUp with the final height percent (not called on snap-close). */
  onPersist?: (height: number) => void;
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
      const y = e.clientY - rect.top;
      const pct = ((rect.height - y) / rect.height) * 100;
      if (collapsed && pct > 5) {
        setCollapsed(false);
      }
      setPercent(Math.min(100, Math.max(3, pct)));
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const pixelHeight = rect.height - y;
        if (pixelHeight < snapCloseThreshold) {
          setCollapsed(true);
          setPercent(closedPercent);
        } else if (onPersist) {
          const finalPercent = Math.min(100, Math.max(3, ((rect.height - y) / rect.height) * 100));
          onPersist(finalPercent);
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
  }, [isDragging, collapsed, containerRef, snapCloseThreshold, closedPercent, onPersist]);

  return { percent, setPercent, collapsed, setCollapsed, isDragging, onResizeStart, toggleCollapsed, expand };
}
