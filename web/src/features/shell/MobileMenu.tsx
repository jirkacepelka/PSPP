/*
 * Compact menu for phones (< 600 px): search first, recently used dialogs, then every menu of
 * the menu bar as an accordion (audit MOB-4).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { trapTab } from '../../components/focus';
import { MENUS } from '../../app/menus';
import { buildEntries } from '../../app/menuEntries';
import { openDialog, openPalette } from '../../app/actions';
import { SPECS_BY_ID } from '../dialogs/specs';
import { useDialogMemory } from '../../store/dialogs';
import { useUi } from '../../store/ui';
import type { AppMenuEntry } from './AppMenu';
import { LogoMark } from './Logo';

function Entries({ items, close, depth = 0 }: { items: AppMenuEntry[]; close: () => void; depth?: number }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className={`sh-drawer-list ${depth ? 'nested' : ''}`}>
      {items.map((it, i) => {
        if (it.type === 'sep') return <li key={`s${i}`} className="sh-drawer-sep" role="separator" />;
        if (it.type === 'header') return <li key={`h${i}`} className="menu-header">{it.label}</li>;
        if (it.type === 'submenu')
          return (
            <li key={it.id}>
              <button type="button" className="sh-drawer-item" aria-expanded={open === it.id} onClick={() => setOpen(open === it.id ? null : it.id)}>
                <Icon name={it.icon ?? ''} />
                <span className="sh-drawer-label">{it.label}</span>
                <Icon name={open === it.id ? 'expand_less' : 'expand_more'} />
              </button>
              {open === it.id && <Entries items={it.items} close={close} depth={depth + 1} />}
            </li>
          );
        return (
          <li key={it.id}>
            <button
              type="button"
              className="sh-drawer-item"
              disabled={it.disabled}
              aria-pressed={it.checked}
              title={it.title}
              onClick={() => {
                close();
                it.onSelect();
              }}
            >
              <Icon name={it.checked !== undefined ? (it.checked ? 'check' : '') : (it.icon ?? '')} />
              <span className="sh-drawer-label">{it.label}</span>
              {it.badge && <span className="app-menu-badge">{it.badge}</span>}
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
  const recent = useDialogMemory((s) => s.recent);
  const [section, setSection] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, [open]);
  if (!open) return null;
  const close = () => setOpen(false);
  const frequent = recent.filter((id) => SPECS_BY_ID[id]).slice(0, 5);
  return createPortal(
    <div
      className="sh-drawer-scrim"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
        if (e.key === 'Tab' && ref.current) trapTab(e.nativeEvent, ref.current);
      }}
    >
      <div className="sh-drawer" ref={ref} role="dialog" aria-modal="true" aria-label={t('menu.menubar')}>
        <div className="sh-drawer-head">
          <LogoMark size={28} />
          <span className="sh-drawer-title">PSPP Studio</span>
          <IconButton icon="close" label={t('common.close')} onClick={close} tip={false} />
        </div>
        <button
          type="button"
          className="sh-drawer-search"
          onClick={() => {
            close();
            openPalette();
          }}
        >
          <Icon name="search" size={18} />
          <span>{t('shell.searchPlaceholder')}</span>
        </button>
        <nav className="sh-drawer-nav" aria-label={t('menu.menubar')}>
          {frequent.length > 0 && (
            <div className="sh-drawer-section">
              <div className="menu-header">{t('shell.frequent')}</div>
              <ul className="sh-drawer-list">
                {frequent.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      className="sh-drawer-item"
                      onClick={() => {
                        close();
                        openDialog(id);
                      }}
                    >
                      <Icon name={SPECS_BY_ID[id].icon ?? 'tune'} />
                      <span className="sh-drawer-label">{t(SPECS_BY_ID[id].title)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {MENUS.map((m) => (
            <div key={m.id} className="sh-drawer-section">
              <button type="button" className="sh-drawer-item top" aria-expanded={section === m.id} onClick={() => setSection(section === m.id ? null : m.id)}>
                <span className="sh-drawer-label">{t(m.label)}</span>
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
