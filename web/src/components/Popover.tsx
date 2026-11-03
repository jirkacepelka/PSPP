/*
 * Popover — non-modal floating panel anchored to a trigger. Escape or an outside click closes
 * it and focus returns to the trigger. Use for small forms/pickers; use <Menu> for commands.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { getFocusable, placeFloating, type Placement } from './focus';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement>;
  /** accessible name of the popover region */
  label: string;
  placement?: `${Placement['side']}-${Placement['align']}`;
  /** move focus into the popover on open (default true) */
  autoFocus?: boolean;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function Popover({ open, onClose, anchorRef, label, placement = 'bottom-start', autoFocus = true, flush, className = '', children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [side, align] = placement.split('-') as [Placement['side'], Placement['align']];

  useLayoutEffect(() => {
    if (!open) return;
    const a = anchorRef.current;
    const el = ref.current;
    if (!a || !el) return;
    const r = el.getBoundingClientRect();
    const p = placeFloating(a.getBoundingClientRect(), r.width, r.height, { side, align });
    setPos({ left: p.left, top: p.top });
  }, [open, side, align, anchorRef]);

  useEffect(() => {
    if (!open) return;
    if (autoFocus) (getFocusable(ref.current)[0] ?? ref.current)?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, autoFocus, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={`popover ${flush ? 'flush' : ''} ${className}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
          anchorRef.current?.focus();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
