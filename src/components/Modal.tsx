'use client';

import React, { useEffect, useRef } from 'react';
import { XIcon } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/* ─── Base Modal Shell ─────────────────────────────────────────────── */

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Extra Tailwind classes on the content card */
  className?: string;
  /** Inline styles on the content card */
  style?: React.CSSProperties;
  /** Show the X close button (default true) */
  showClose?: boolean;
  /** z-index class override (default "z-50") */
  zIndex?: string;
  /** Ref for the content card element */
  cardRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Low-level modal shell. Renders a backdrop + centered card.
 * Handles escape-key, backdrop click, and body overflow lock.
 */
export function Modal({
  isOpen,
  onClose,
  children,
  className = '',
  style,
  showClose = true,
  zIndex = 'z-50',
  cardRef,
}: ModalProps) {
  useEscapeKey(onClose, isOpen);

  // Track where mousedown started so we only close on true backdrop clicks
  const mouseDownOnBackdrop = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndex} flex items-center justify-center p-4 electron-no-drag`}
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => {
        if (mouseDownOnBackdrop.current && e.target === e.currentTarget) onClose();
        mouseDownOnBackdrop.current = false;
      }}
    >
      <div className="absolute inset-0 bg-black/40" onMouseDown={(e) => { mouseDownOnBackdrop.current = true; }} />
      <div
        ref={cardRef}
        className={`relative bg-surface-detail border border-border-default rounded-lg shadow-2xl animate-in fade-in zoom-in-95 duration-75 ${className}`}
        style={style}
      >
        {showClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-text-placeholder hover:text-text-secondary p-1 z-10"
          >
            <XIcon className="w-4 h-4" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

/* ─── Confirm Modal ────────────────────────────────────────────────── */

interface ConfirmModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Extra class on the card */
  className?: string;
}

/**
 * Two-button confirm dialog. Title + body content + Cancel / Confirm.
 */
export function ConfirmModal({
  isOpen,
  onConfirm,
  onCancel,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  className = '',
}: ConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} showClose={false} className={`max-w-md mx-4 p-6 ${className}`}>
      <h3 className="text-sm font-semibold text-text-primary mb-3">{title}</h3>
      <div className="text-xs text-text-secondary leading-relaxed mb-5">{children}</div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-secondary">{cancelLabel}</button>
        <button onClick={onConfirm} className="btn-primary">{confirmLabel}</button>
      </div>
    </Modal>
  );
}

/* ─── Alert / Info Modal ───────────────────────────────────────────── */

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  buttonLabel?: string;
  /** Extra class on the card */
  className?: string;
}

/**
 * Single-button info/alert dialog. Title + body + OK.
 */
export function AlertModal({
  isOpen,
  onClose,
  title,
  children,
  buttonLabel = 'OK',
  className = '',
}: AlertModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} showClose={false} className={`max-w-sm mx-4 p-6 ${className}`}>
      <h3 className="text-sm font-semibold text-text-primary mb-3">{title}</h3>
      <div className="text-xs text-text-secondary leading-relaxed mb-5">{children}</div>
      <div className="flex justify-end">
        <button onClick={onClose} className="btn-primary">{buttonLabel}</button>
      </div>
    </Modal>
  );
}
