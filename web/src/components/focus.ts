/*
 * Focus helpers shared by Dialog, Popover, Menu and Toolbar.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** True when the environment has no layout engine (jsdom); then every element counts as visible. */
function noLayout(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getClientRects().length === 0;
}

export function isVisible(el: HTMLElement): boolean {
  if (el.closest('[hidden], [inert]')) return false;
  if (noLayout()) return true;
  if (el.getClientRects().length === 0) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

/** Tabbable descendants of `root` in DOM order. */
export function getFocusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
}

/**
 * Keeps Tab / Shift+Tab inside `root`. Call from a keydown handler;
 * returns true when it moved focus (the event is then prevented).
 */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault(): void }, root: HTMLElement | null): boolean {
  if (e.key !== 'Tab' || !root) return false;
  const nodes = getFocusable(root);
  if (!nodes.length) {
    e.preventDefault();
    root.focus();
    return true;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const inside = !!active && root.contains(active);
  if (e.shiftKey && (active === first || !inside || active === root)) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && (active === last || !inside)) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

export interface Placement {
  side: 'bottom' | 'top';
  align: 'start' | 'end' | 'center';
}

/** Positions a floating element of size `w`×`h` next to `rect`, flipping to stay in the viewport. */
export function placeFloating(rect: DOMRect, w: number, h: number, p: Placement, gap = 6): { left: number; top: number; side: 'bottom' | 'top' } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let side = p.side;
  if (side === 'bottom' && rect.bottom + gap + h > vh - 8 && rect.top - gap - h > 8) side = 'top';
  else if (side === 'top' && rect.top - gap - h < 8 && rect.bottom + gap + h < vh - 8) side = 'bottom';
  let left = p.align === 'start' ? rect.left : p.align === 'end' ? rect.right - w : rect.left + rect.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, vw - w - 8));
  const top = side === 'bottom' ? rect.bottom + gap : rect.top - gap - h;
  return { left, top: Math.max(8, top), side };
}
