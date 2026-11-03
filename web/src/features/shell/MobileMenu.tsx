/*
 * Navigation drawer with all menus for narrow screens.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import type { MenuEntry } from '../../components/Menu';
import { MENUS } from '../../app/menus';
import { buildEntries } from '../../app/menuEntries';
import { useUi } from '../../store/ui';

function Entries({ items, close, depth = 0 }: { items: MenuEntry[]; close: () => void; depth?: number }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="drawer-list" style={{ paddingLeft: depth ? 12 : 0 }}>
      {items.map((it, i) => {
        if (it.type === 'sep') return <li key={`s${i}`} className="drawer-sep" role="separator" />;
        if (it.type === 'header') return <li key={`h${i}`} className="menu-header">{it.label}</li>;
        if (it.type === 'submenu')
          return (
            <li key={it.id}>
              <button type="button" className="drawer-item" aria-expanded={open === it.id} onClick={() => setOpen(open === it.id ? null : it.id)}>
                <Icon name={it.icon ?? ''} />
                <span className="menu-label">{it.label}</span>
                <Icon name={open === it.id ? 'expand_less' : 'expand_more'} />
              </button>
              {open === it.id && <Entries items={it.items} close={close} depth={depth + 1} />}
            </li>
          );
        return (
          <li key={it.id}>
            <button
              type="button"
              className="drawer-item"
              disabled={it.disabled}
              aria-checked={it.checked}
              role={it.checked !== undefined ? 'menuitemcheckbox' : undefined}
              onClick={() => {
                close();
                it.onSelect();
              }}
            >
              <Icon name={it.checked !== undefined ? (it.checked ? 'check' : '') : it.icon ?? ''} />
              <span className="menu-label">{it.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function MobileMenu() {
  const { t } = useTranslation();
  const open = useUi((s) => s.mobileMenuOpen);
  const setOpen = useUi((s) => s.setMobileMenu);
  const [section, setSection] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, [open]);
  if (!open) return null;
  const close = () => setOpen(false);
  return createPortal(
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="drawer" ref={ref} role="dialog" aria-modal="true" aria-label={t('menu.menubar')}>
        <div className="drawer-head">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span className="drawer-title">PSPP Studio</span>
          <IconButton icon="close" label={t('common.close')} onClick={close} tip={false} />
        </div>
        <nav className="drawer-nav">
          {MENUS.map((m) => (
            <div key={m.id} className="drawer-section">
              <button type="button" className="drawer-item top" aria-expanded={section === m.id} onClick={() => setSection(section === m.id ? null : m.id)}>
                <span className="menu-label">{t(m.label)}</span>
                <Icon name={section === m.id ? 'expand_less' : 'expand_more'} />
              </button>
              {section === m.id && <Entries items={buildEntries(m.items, t)} close={close} />}
            </div>
          ))}
        </nav>
      </div>
    </div>,
    document.body,
  );
}
