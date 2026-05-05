'use client';

import React, { useEffect, useRef, useState } from 'react';
import { XIcon } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

const MIN_SCALE = 1;
const MAX_SCALE = 8;

export function ImagePreview({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  useEscapeKey(onClose, true);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      // macOS trackpad pinch → wheel + ctrlKey. Cmd+scroll on Windows behaves the same.
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;

        setScale((prev) => {
          const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * Math.exp(-e.deltaY * 0.01)));
          if (next === prev) return prev;
          // Zoom toward cursor: keep the point under the cursor stationary.
          const k = next / prev;
          setTx((t) => cx - k * (cx - t));
          setTy((t) => cy - k * (cy - t));
          if (next === MIN_SCALE) {
            setTx(0);
            setTy(0);
          }
          return next;
        });
      } else {
        // Two-finger scroll → pan when zoomed in.
        setScale((prev) => {
          if (prev <= MIN_SCALE) return prev;
          e.preventDefault();
          setTx((t) => t - e.deltaX);
          setTy((t) => t - e.deltaY);
          return prev;
        });
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setScale(1);
    setTx(0);
    setTy(0);
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-pointer overflow-hidden"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
        aria-label="Close preview"
      >
        <XIcon className="w-5 h-5" />
      </button>
      <img
        src={src}
        alt={alt || 'Preview'}
        draggable={false}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl select-none"
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transition: 'transform 80ms ease-out',
          cursor: scale > 1 ? 'grab' : 'zoom-in',
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
}
