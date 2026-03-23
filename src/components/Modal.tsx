'use client';

import React, { useEffect } from 'react';
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

/* ─── Small Modal ─────────────────────────────────────────────────── */

interface SmallModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Button row — pass your own buttons, or use ConfirmModal/AlertModal for standard layouts */
  actions: React.ReactNode;
  /** Primary action triggered by Cmd+Enter */
  onPrimary?: () => void;
  /** Extra class on the card */
  className?: string;
}

/**
 * Compositional base for small dialogs. Provides consistent title/body/actions
 * layout and Cmd+Enter keyboard shortcut. Use directly for custom layouts,
 * or use ConfirmModal/AlertModal for standard two-button/one-button patterns.
 */
export function SmallModal({
  isOpen,
  onClose,
  title,
  children,
  actions,
  onPrimary,
  className = '',
}: SmallModalProps) {
  useEffect(() => {
    if (!isOpen || !onPrimary) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onPrimary();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onPrimary]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} showClose={false} className={`mx-4 p-6 ${className}`}>
      <h3 className="text-sm font-semibold text-text-primary mb-3">{title}</h3>
      {children}
      <div className="flex justify-end gap-2">{actions}</div>
    </Modal>
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
    <SmallModal
      isOpen={isOpen}
      onClose={onCancel}
      onPrimary={onConfirm}
      title={title}
      className={`max-w-md ${className}`}
      actions={<>
        <button onClick={onCancel} className="btn-secondary">{cancelLabel}</button>
        <button onClick={onConfirm} className="btn-primary">{confirmLabel}</button>
      </>}
    >
      <div className="text-xs text-text-secondary leading-relaxed mb-5">{children}</div>
    </SmallModal>
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
    <SmallModal
      isOpen={isOpen}
      onClose={onClose}
      onPrimary={onClose}
      title={title}
      className={`max-w-sm ${className}`}
      actions={<button onClick={onClose} className="btn-primary">{buttonLabel}</button>}
    >
      <div className="text-xs text-text-secondary leading-relaxed mb-5">{children}</div>
    </SmallModal>
  );
}
