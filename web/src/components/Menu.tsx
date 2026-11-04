/*
 * Popup menu with keyboard navigation (↑ ↓ Home End, type-ahead, → ← for submenus) and nested submenus.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMenuAim } from './menuAim';
import { Icon } from './Icon';

export type MenuEntry =
  | { type: 'item'; id: string; label: string; icon?: string; shortcut?: string; checked?: boolean; disabled?: boolean; danger?: boolean; onSelect: () => void }
  | { type: 'submenu'; id: string; label: string; icon?: string; items: MenuEntry[]; disabled?: boolean }
  | { type: 'sep'; id?: string }
  | { type: 'header'; id?: string; label: string };

export interface Anchor {
  x: number;
  y: number;
  /** alternative position if the menu does not fit (e.g. left edge of parent for submenus) */
  altX?: number;
  /** align the menu's right edge to altX (menus opened from right-aligned buttons) */
  alignEnd?: boolean;
}

interface MenuProps {
  items: MenuEntry[];
  anchor: Anchor;
  onClose: (reason: 'select' | 'escape' | 'outside' | 'left' | 'right') => void;
  label?: string;
  autoFocus?: boolean;
  level?: number;
  onNavigateSibling?: (dir: -1 | 1) => void;
}

export function Menu({ items, anchor, onClose, label, autoFocus = true, level = 0, onNavigateSibling }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.x, top: anchor.y });
  const [sub, setSub] = useState<{ index: number; anchor: Anchor; focus: boolean } | null>(null);

  const { aimed, cancel } = useMenuAim(ref, level);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.alignEnd && anchor.altX !== undefined ? anchor.altX - r.width : anchor.x;
    if (left + r.width > vw - 8) left = anchor.altX !== undefined ? anchor.altX - r.width : vw - r.width - 8;
    left = Math.max(8, left);
    let top = anchor.y;
    if (top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
    setPos({ left, top });
  }, [anchor.x, anchor.y, anchor.altX, anchor.alignEnd]);

  useEffect(() => {
    if (autoFocus) {
      const first = ref.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)');
      first?.focus({ preventScroll: true });
    }
  }, [autoFocus]);

  useEffect(() => {
    if (level > 0) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.menu') || t.closest('[data-menu-trigger]')) return;
      onClose('outside');
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [level, onClose]);

  const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(':scope > [role^="menuitem"]:not(:disabled)') ?? []);

  const openSub = (index: number, el: HTMLElement, focus: boolean) => {
    const r = el.getBoundingClientRect();
    setSub({ index, anchor: { x: r.right - 4, y: r.top - 8, altX: r.left + 4 }, focus });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = focusables();
    const idx = list.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        list[(idx + 1) % list.length]?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        list[(idx - 1 + list.length) % list.length]?.focus();
        break;
      case 'Home':
        e.preventDefault();
        list[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        list[list.length - 1]?.focus();
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose(level > 0 ? 'left' : 'escape');
        break;
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        if (level > 0) onClose('left');
        else onNavigateSibling?.(-1);
        break;
      case 'ArrowRight': {
        const el = document.activeElement as HTMLElement;
        const i = Number(el?.dataset.index);
        if (el?.getAttribute('aria-haspopup') === 'menu') {
          e.preventDefault();
          e.stopPropagation();
          openSub(i, el, true);
        } else if (level === 0) {
          e.preventDefault();
          onNavigateSibling?.(1);
        }
        break;
      }
      case 'Tab':
        e.preventDefault();
        onClose('escape');
        break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const ch = e.key.toLowerCase();
          const start = idx + 1;
          const order = [...list.slice(start), ...list.slice(0, start)];
          order.find((el) => el.textContent?.trim().toLowerCase().startsWith(ch))?.focus();
        }
    }
  };

  const subEntry = sub ? items[sub.index] : null;

  return createPortal(
    <>
      <div
        ref={ref}
        className="menu"
        role="menu"
        data-level={level}
        aria-label={label}
        style={{ left: pos.left, top: pos.top, zIndex: 900 + level }}
        onKeyDown={onKeyDown}
      >
        {items.map((it, i) => {
          if (it.type === 'sep') return <div key={`sep${i}`} className="menu-sep" role="separator" />;
          if (it.type === 'header') return <div key={`h${i}`} className="menu-header">{it.label}</div>;
          if (it.type === 'submenu') {
            return (
              <button
                key={it.id}
                type="button"
                className="menu-item"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={sub?.index === i}
                data-active={sub?.index === i}
                data-index={i}
                disabled={it.disabled}
                onClick={(e) => openSub(i, e.currentTarget, true)}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  if (sub?.index === i) {
                    cancel();
                    return;
                  }
                  aimed(() => openSub(i, el, false), sub ? 0 : 90);
                }}
              >
                <Icon name={it.icon ?? ''} />
                <span className="menu-label">{it.label}</span>
                <Icon name="chevron_right" />
              </button>
            );
          }
          return (
            <button
              key={it.id}
              type="button"
              className={it.danger ? 'menu-item danger' : 'menu-item'}
              role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={it.checked}
              data-index={i}
              disabled={it.disabled}
              onMouseEnter={() => {
                if (sub) aimed(() => setSub(null));
                else cancel();
              }}
              onClick={() => {
                onClose('select');
                it.onSelect();
              }}
            >
              <Icon name={it.checked !== undefined ? (it.checked ? 'check' : '') : it.icon ?? ''} />
              <span className="menu-label">{it.label}</span>
              {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
            </button>
          );
        })}
      </div>
      {sub && subEntry && subEntry.type === 'submenu' && (
        <Menu
          items={subEntry.items}
          anchor={sub.anchor}
          level={level + 1}
          label={subEntry.label}
          autoFocus={sub.focus}
          onClose={(reason) => {
            const index = sub.index;
            setSub(null);
            if (reason === 'left') {
              ref.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus();
            } else onClose(reason);
          }}
        />
      )}
    </>,
    document.body,
  );
}
