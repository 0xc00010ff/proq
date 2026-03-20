'use client';

import React from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';

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
 * Low-level modal shell. Wraps shadcn Dialog primitive.
 * Handles escape-key (via custom shortcut system), backdrop click, and body overflow lock.
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
  // Use the custom shortcut system for escape; prevent Radix's built-in escape handling
  useEscapeKey(onClose, isOpen);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        ref={cardRef}
        showClose={showClose}
        className={className}
        overlayClassName={zIndex !== 'z-50' ? zIndex : undefined}
        style={style}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {children}
      </DialogContent>
    </Dialog>
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
