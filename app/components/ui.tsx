"use client";

import { useEffect, type PropsWithChildren, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Reusable card container with consistent border, bg, and shadow.
 * @param children - Card content.
 * @param className - Additional classes to merge.
 * @returns Card wrapper element.
 */
export function Card({
  children,
  className = "",
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-border-low bg-card shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Modal dialog with backdrop blur, escape-to-close, and click-outside-to-close.
 * @param onClose - Called when the user dismisses the dialog.
 * @param children - Dialog panel content.
 * @param title - Header text for the dialog.
 * @returns Modal overlay element.
 */
export function Dialog({
  onClose,
  children,
  title,
}: PropsWithChildren<{ onClose: () => void; title: string }>) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border-low bg-card-elevated p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted transition hover:text-foreground cursor-pointer"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Label/value row with optional loading skeleton, used in stat panels.
 * @param label - Left-side label text.
 * @param isLoading - Shows a pulse skeleton instead of children.
 * @param className - Additional classes for the value span.
 * @param children - Right-side value content.
 * @returns Flex row element.
 */
export function StatRow({
  label,
  isLoading,
  className = "",
  children,
}: {
  label: string;
  isLoading?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted">{label}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums ${className}`}>
        {isLoading ? (
          <span className="inline-block h-4 w-20 animate-pulse rounded bg-surface" />
        ) : (
          children
        )}
      </span>
    </div>
  );
}

/**
 * Skeleton loading block for content placeholders.
 * @param count - Number of skeleton rows to render.
 * @param height - Tailwind height class for each row.
 * @returns Skeleton placeholder elements.
 */
export function Skeleton({
  count = 3,
  height = "h-14",
}: {
  count?: number;
  height?: string;
}) {
  return (
    <div className="space-y-2 p-6">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`${height} animate-pulse rounded-xl bg-surface`} />
      ))}
    </div>
  );
}

/**
 * Inline error banner with red styling.
 * @param message - Error message to display.
 * @returns Error banner element.
 */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-short/20 bg-short-muted px-3 py-2 text-xs text-short">
      {message}
    </div>
  );
}

/**
 * Centered empty-state message.
 * @param children - Message content.
 * @returns Styled empty-state element.
 */
export function EmptyState({ children }: PropsWithChildren) {
  return (
    <div className="rounded-xl bg-surface px-4 py-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}
