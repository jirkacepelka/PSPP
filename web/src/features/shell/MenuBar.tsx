/*
 * Desktop menu bar (File, Edit, View, ...).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu } from '../../components/Menu';
import { MENUS } from '../../app/menus';
import { buildEntries } from '../../app/menuEntries';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { useSettings } from '../../store/settings';

export function MenuBar() {
  const { t } = useTranslation();
  const [open, setOpen] = useState<{ index: number; keyboard: boolean } | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // re-render menus when state that affects enabled/checked changes
  useData((s) => s.revision);
  useUi((s) => `${s.view}${s.valueLabels}${s.zoom}`);
  useSettings((s) => `${s.theme}${s.showToolbar}${s.showFormulaBar}${s.showStatusBar}`);

  const openAt = (index: number, keyboard: boolean) => {
    const n = MENUS.length;
    const i = ((index % n) + n) % n;
    setOpen({ index: i, keyboard });
    refs.current[i]?.focus();
  };

  const anchorFor = (i: number) => {
    const r = refs.current[i]?.getBoundingClientRect();
    return r ? { x: r.left, y: r.bottom + 2 } : { x: 0, y: 0 };
  };

  return (
    <nav className="menubar" role="menubar" aria-label={t('menu.menubar')}>
      {MENUS.map((m, i) => (
        <button
          key={m.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open?.index === i}
          className={`menubar-item ${open?.index === i ? 'open' : ''}`}
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
            }
          }}
        >
          {t(m.label)}
        </button>
      ))}
      {open && (
        <Menu
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
