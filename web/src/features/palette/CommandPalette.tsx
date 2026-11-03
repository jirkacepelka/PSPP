/*
 * Command palette (Ctrl/Cmd+K): search every menu action, dialog and PSPP command template.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { ACTIONS_BY_ID, formatShortcut, runAction } from '../../app/actions';
import { MENUS } from '../../app/menus';
import { flattenMenus } from '../../app/menuEntries';
import { PSPP_COMMANDS } from '../../lib/commands';
import { useUi } from '../../store/ui';
import { syntaxTemplate } from '../syntax/templates';
import { pasteSyntax } from '../../app/engine';

interface Entry {
  key: string;
  label: string;
  path: string;
  icon: string;
  shortcut?: string;
  disabled?: boolean;
  keywords: string;
  run: () => void;
}

function norm(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function CommandPalette() {
  const { t, i18n } = useTranslation();
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const entries = useMemo<Entry[]>(() => {
    if (!open) return [];
    const seen = new Set<string>();
    const out: Entry[] = [];
    for (const m of MENUS) {
      for (const { path, id } of flattenMenus(m.items, t, [t(m.label)])) {
        const a = ACTIONS_BY_ID[id];
        if (!a || seen.has(id)) continue;
        seen.add(id);
        out.push({
          key: id,
          label: t(a.label),
          path: path.join(' › '),
          icon: a.icon ?? 'chevron_right',
          shortcut: formatShortcut(a.shortcut),
          disabled: a.enabled ? !a.enabled() : false,
          keywords: norm(`${t(a.label)} ${path.join(' ')} ${a.keywords ?? ''} ${id}`),
          run: () => runAction(id),
        });
      }
    }
    for (const id of ['syntax.runAll', 'syntax.runCurrent', 'syntax.runSelection']) {
      const a = ACTIONS_BY_ID[id];
      out.push({ key: id, label: t(a.label), path: t('views.syntax'), icon: a.icon ?? 'play_arrow', shortcut: formatShortcut(a.shortcut), keywords: norm(`${t(a.label)} run`), run: () => runAction(id) });
    }
    for (const c of PSPP_COMMANDS) {
      out.push({
        key: `cmd:${c}`,
        label: c,
        path: t('palette.insertSyntax'),
        icon: 'code_blocks',
        keywords: norm(`${c} syntax syntaxe`),
        run: () => pasteSyntax(syntaxTemplate(c, i18n.language === 'cs' ? 'cs' : 'en')),
      });
    }
    return out;
  }, [open, t, i18n.language]);

  const results = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return entries.filter((e) => !e.key.startsWith('cmd:')).slice(0, 60);
    const scored = entries
      .map((e) => {
        if (!words.every((w) => e.keywords.includes(w))) return null;
        const l = norm(e.label);
        let score = 0;
        if (l.startsWith(words[0])) score += 10;
        if (l.includes(words.join(' '))) score += 5;
        if (e.key.startsWith('cmd:')) score -= 3;
        if (e.disabled) score -= 2;
        return { e, score };
      })
      .filter((x): x is { e: Entry; score: number } => !!x)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 80).map((x) => x.e);
  }, [entries, q]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  const choose = (e: Entry | undefined) => {
    if (!e || e.disabled) return;
    setOpen(false);
    setTimeout(() => e.run(), 0);
  };
  return createPortal(
    <div className="palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('palette.title')}>
        <div className="palette-search">
          <Icon name="search" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.placeholder')}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `pal-${active}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(results[active]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul className="palette-list" id="palette-list" role="listbox" ref={list}>
          {results.length === 0 && <li className="palette-empty">{t('palette.noResults')}</li>}
          {results.map((r, i) => (
            <li
              key={r.key}
              id={`pal-${i}`}
              data-idx={i}
              role="option"
              aria-selected={i === active}
              aria-disabled={r.disabled}
              className={`palette-item ${i === active ? 'on' : ''} ${r.disabled ? 'disabled' : ''}`}
              onMouseMove={() => setActive(i)}
              onClick={() => choose(r)}
            >
              <Icon name={r.icon} />
              <span className="palette-label">{r.label}</span>
              <span className="palette-path">{r.path}</span>
              {r.shortcut && <kbd className="kbd">{r.shortcut}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
