'use client';

import React, { useEffect } from 'react';
import { XIcon } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/* ─── Base Modal Shell ─────────────────────────────────────────────── */

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Extra Tailwind classes on the content card */
  className?: string;
  /** Show the X close button (default true) */
  showClose?: boolean;
  /** z-index class override (default "z-50") */
  zIndex?: string;
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
  showClose = true,
  zIndex = 'z-50',
}: ModalProps) {
  useEscapeKey(onClose, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 ${zIndex} flex items-center justify-center p-4`} onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className={`relative bg-gunmetal-50 dark:bg-[#1a1a1a] border border-gunmetal-300 dark:border-zinc-800 rounded-lg shadow-2xl animate-in fade-in zoom-in-95 duration-150 ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {showClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors p-1 z-10"
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
      <h3 className="text-sm font-semibold text-gunmetal-900 dark:text-zinc-100 mb-3">{title}</h3>
      <div className="text-xs text-gunmetal-700 dark:text-zinc-400 leading-relaxed mb-5">{children}</div>
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
      <h3 className="text-sm font-semibold text-gunmetal-900 dark:text-zinc-100 mb-3">{title}</h3>
      <div className="text-xs text-gunmetal-700 dark:text-zinc-400 leading-relaxed mb-5">{children}</div>
      <div className="flex justify-end">
        <button onClick={onClose} className="btn-primary">{buttonLabel}</button>
      </div>
    </Modal>
  );
}
