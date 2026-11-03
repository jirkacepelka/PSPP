/*
 * Tooltip — positioned, delayed, keyboard-accessible (shows on focus, hides on Escape).
 * Wraps exactly one focusable child and links it with aria-describedby.
 * For icon buttons the lighter CSS tooltip of <IconButton> is usually enough.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeFloating } from './focus';
import { Kbd } from './Kbd';

interface TooltipProps {
  content: ReactNode;
  /** optional shortcut rendered as <Kbd> inside the tooltip */
  shortcut?: string | string[];
  placement?: 'bottom' | 'top';
  /** hover delay in ms (focus shows immediately) */
  delay?: number;
  children: ReactElement;
}

type AnyProps = Record<string, unknown> & {
  onMouseEnter?: (e: unknown) => void;
  onMouseLeave?: (e: unknown) => void;
  onFocus?: (e: unknown) => void;
  onBlur?: (e: unknown) => void;
  onKeyDown?: (e: { key: string }) => void;
};

export function Tooltip({ content, shortcut, placement = 'bottom', delay = 450, children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = useCallback((el: HTMLElement, wait: number) => {
    anchor.current = el;
    clear();
    if (wait <= 0) setOpen(true);
    else timer.current = setTimeout(() => setOpen(true), wait);
  }, []);
  const hide = useCallback(() => {
    clear();
    setOpen(false);
    setPos(null);
  }, []);
  useEffect(() => clear, []);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const r = anchor.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const p = placeFloating(r, t.width, t.height, { side: placement, align: 'center' });
    setPos({ left: p.left, top: p.top });
  }, [open, placement]);

  if (!isValidElement(children)) return children;
  const props = children.props as AnyProps;
  const child = cloneElement(children as ReactElement<AnyProps>, {
    'aria-describedby': open ? id : (props['aria-describedby'] as string | undefined),
    onMouseEnter: (e: unknown) => {
      props.onMouseEnter?.(e);
      show((e as { currentTarget: HTMLElement }).currentTarget, delay);
    },
    onMouseLeave: (e: unknown) => {
      props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: unknown) => {
      props.onFocus?.(e);
      show((e as { currentTarget: HTMLElement }).currentTarget, 0);
    },
    onBlur: (e: unknown) => {
      props.onBlur?.(e);
      hide();
    },
    onKeyDown: (e: { key: string }) => {
      props.onKeyDown?.(e);
      if (e.key === 'Escape') hide();
    },
  });

  return (
    <>
      {child}
      {open &&
        createPortal(
          <div ref={tip} id={id} role="tooltip" className="tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>
            {content}
            {shortcut && <Kbd keys={shortcut} />}
          </div>,
          document.body,
        )}
    </>
  );
}
