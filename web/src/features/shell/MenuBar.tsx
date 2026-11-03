/*
 * Classic menu bar (Soubor, Úpravy, … Nápověda). Always visible down to tablet widths: it
 * scrolls horizontally with fade edges instead of collapsing. Alt+letter opens a menu
 * (mnemonic underlined while Alt is held), F10 focuses the bar.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MENUS } from '../../app/menus';
import { buildEntries } from '../../app/menuEntries';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { useOutput } from '../../store/output';
import { useDialogMemory } from '../../store/dialogs';
import { AppMenu } from './AppMenu';
import { useLayout } from './layout';

export const OPEN_MENU_EVENT = 'pspp-open-menu';

/** Label with the mnemonic letter wrapped for underlining. */
export function MnemonicLabel({ label, letter }: { label: string; letter: string }) {
  const i = letter ? label.toLowerCase().indexOf(letter.toLowerCase()) : -1;
  if (i < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, i)}
      <span className="sh-mn">{label[i]}</span>
      {label.slice(i + 1)}
    </>
  );
}

export function mnemonicIndex(code: string, t: (k: string) => string): number {
  const letter = code.replace(/^Key/, '').toLowerCase();
  return MENUS.findIndex((m) => t(m.mnemonic).toLowerCase() === letter);
}

export function MenuBar() {
  const { t } = useTranslation();
  const [open, setOpen] = useState<{ index: number; keyboard: boolean } | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const [fade, setFade] = useState({ l: false, r: false });
  // re-render menus when state that affects enabled/checked changes
  useData((s) => s.revision);
  useUi((s) => `${s.view}${s.showStart}${s.valueLabels}${s.zoom}`);
  useSettings((s) => `${s.theme}${s.showToolbar}${s.showFormulaBar}${s.showStatusBar}${s.showValueLabels}${s.inspectorOpen}${s.splitView}`);
  useOutput((s) => `${s.entries.length}${s.selectedId}`);
  useDialogMemory((s) => s.recent.length);
  useLayout((s) => s.journalOpen);

  const openAt = (index: number, keyboard: boolean) => {
    const n = MENUS.length;
    const i = ((index % n) + n) % n;
    setOpen({ index: i, keyboard });
    const el = refs.current[i];
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  useEffect(() => {
    const on = (e: Event) => openAt((e as CustomEvent<number>).detail, true);
    window.addEventListener(OPEN_MENU_EVENT, on);
    return () => window.removeEventListener(OPEN_MENU_EVENT, on);
  }, []);

  // fade edges when the bar overflows (tablets)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setFade({ l: el.scrollLeft > 2, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, []);

  const anchorFor = (i: number) => {
    const r = refs.current[i]?.getBoundingClientRect();
    return r ? { x: r.left, y: r.bottom + 4 } : { x: 0, y: 0 };
  };

  return (
    <nav className={`sh-menubar ${fade.l ? 'fade-l' : ''} ${fade.r ? 'fade-r' : ''}`} aria-label={t('menu.menubar')}>
      <div className="sh-menubar-scroll" ref={scroller} role="menubar" aria-label={t('menu.menubar')}>
        {MENUS.map((m, i) => {
          const letter = t(m.mnemonic);
          return (
            <button
              key={m.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open?.index === i}
              aria-keyshortcuts={`Alt+${letter.toUpperCase()}`}
              className={`sh-menubar-item ${open?.index === i ? 'open' : ''}`}
              tabIndex={i === focusIdx ? 0 : -1}
              onFocus={() => setFocusIdx(i)}
              data-menu-trigger
              onClick={() => (open?.index === i ? setOpen(null) : openAt(i, false))}
              onMouseEnter={() => open && open.index !== i && openAt(i, false)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openAt(i, true);
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  refs.current[(i + 1) % MENUS.length]?.focus();
                } else if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  refs.current[(i - 1 + MENUS.length) % MENUS.length]?.focus();
                } else if (e.key === 'Home') {
                  e.preventDefault();
                  refs.current[0]?.focus();
                } else if (e.key === 'End') {
                  e.preventDefault();
                  refs.current[MENUS.length - 1]?.focus();
                } else if (e.key === 'Escape') {
                  (document.querySelector<HTMLElement>('#main') ?? document.body).focus();
                }
              }}
            >
              <MnemonicLabel label={t(m.label)} letter={letter} />
            </button>
          );
        })}
      </div>
      {open && (
        <AppMenu
          key={open.index}
          items={buildEntries(MENUS[open.index].items, t)}
          anchor={anchorFor(open.index)}
          label={t(MENUS[open.index].label)}
          autoFocus
          onNavigateSibling={(d) => openAt(open.index + d, true)}
          onClose={(reason) => {
            const idx = open.index;
            setOpen(null);
            if (reason === 'escape') refs.current[idx]?.focus();
          }}
        />
      )}
    </nav>
  );
}
