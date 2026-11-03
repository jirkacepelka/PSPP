/*
 * Toolbar — role="toolbar" with one tab stop and arrow-key navigation between controls.
 * ToolbarGroup clusters related controls; ToolbarSeparator draws a hairline between groups.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { getFocusable } from './focus';

interface ToolbarProps {
  'aria-label': string;
  children: ReactNode;
  bordered?: boolean;
  className?: string;
}

export function Toolbar({ children, bordered, className = '', ...aria }: ToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const items = () => getFocusable(ref.current).concat(Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? [])).filter((el, i, a) => a.indexOf(el) === i && !(el as HTMLButtonElement).disabled);

  // one tab stop: the first enabled item (or the last focused one)
  useEffect(() => {
    const list = items();
    if (!list.length) return;
    const current = list.find((el) => el.dataset.roving === 'active') ?? list[0];
    for (const el of list) {
      el.dataset.roving = el === current ? 'active' : 'idle';
      el.tabIndex = el === current ? 0 : -1;
    }
  });

  const focusAt = (list: HTMLElement[], i: number) => {
    const el = list[(i + list.length) % list.length];
    for (const x of list) {
      x.dataset.roving = x === el ? 'active' : 'idle';
      x.tabIndex = x === el ? 0 : -1;
    }
    el.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.matches('input, textarea, select')) return; // let text fields keep their arrows
    const list = items();
    const i = list.indexOf(target);
    if (i < 0) return;
    if (e.key === 'ArrowRight') focusAt(list, i + 1);
    else if (e.key === 'ArrowLeft') focusAt(list, i - 1);
    else if (e.key === 'Home') focusAt(list, 0);
    else if (e.key === 'End') focusAt(list, list.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={aria['aria-label']}
      className={`ds-toolbar ${bordered ? 'bordered' : ''} ${className}`}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        const el = e.target as HTMLElement;
        if (el.dataset.roving) {
          for (const x of items()) {
            x.dataset.roving = x === el ? 'active' : 'idle';
            x.tabIndex = x === el ? 0 : -1;
          }
        }
      }}
    >
      {children}
    </div>
  );
}

export function ToolbarGroup({ children, attached, label, className = '' }: { children: ReactNode; attached?: boolean; label?: string; className?: string }) {
  return (
    <div className={`toolbar-group ${attached ? 'attached' : ''} ${className}`} role={label ? 'group' : undefined} aria-label={label}>
      {children}
    </div>
  );
}

export function ToolbarSeparator() {
  return <div className="toolbar-sep" role="separator" aria-orientation="vertical" />;
}

export function ToolbarSpacer() {
  return <div className="toolbar-spacer" />;
}
