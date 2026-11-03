/*
 * Command palette (Ctrl/Cmd+K, audit F12): one search over actions, dialogs, variables, goals,
 * output results and PSPP command templates.
 *   empty query  → Nedávné (recent) · Navrhované (context) · Zobrazení (views)
 *   prefixes     → ">" commands · "@" variables · "#" results · "?" help
 *   variables    → Enter jumps to the column; Tab / → shows actions for that variable
 * Matching is fuzzy and diacritics-insensitive (fuzzy.ts).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { trapTab } from '../../components/focus';
import { ACTIONS_BY_ID, formatShortcut, openDialog, runAction } from '../../app/actions';
import { MENUS, resolveMenuId } from '../../app/menus';
import { flattenMenus } from '../../app/menuEntries';
import { manualUrl } from '../../app/help';
import { pasteSyntax } from '../../app/engine';
import { gridCommands, useActiveVariable } from '../../app/gridBus';
import { variableIcon } from '../../app/varIcons';
import { PSPP_COMMANDS } from '../../lib/commands';
import { SPECS_BY_ID } from '../dialogs/specs';
import { syntaxTemplate } from '../syntax/templates';
import { useData } from '../../store/data';
import { useDialogMemory } from '../../store/dialogs';
import { useOutput } from '../../store/output';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import type { Variable } from '../../engine/types';
import { useLayout } from '../shell/layout';
import { score } from './fuzzy';
import { ACTION_WORDS, GOALS } from './synonyms';
import './palette.css';

interface Entry {
  key: string;
  label: string;
  /** secondary text: menu path, variable label, command */
  path?: string;
  icon: string;
  /** data-measure for variable icons */
  measure?: string;
  shortcut?: string;
  badge?: string;
  disabled?: boolean;
  keywords: string;
  group: string;
  /** sub-actions available with Tab / → */
  more?: boolean;
  run: () => void;
}

const RECENT_KEY = 'pspp.palette.recent';
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.slice(0, 8) : [];
  } catch {
    return [];
  }
}
function pushRecent(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 8)));
  } catch {
    /* storage blocked */
  }
}

const has = (id: string) => !!ACTIONS_BY_ID[id];

function jumpToVariable(index: number) {
  const ui = useUi.getState();
  if (ui.showStart || (ui.view !== 'data' && ui.view !== 'variables')) ui.setView('data');
  // wait for the grid to mount and register itself on the bus
  setTimeout(() => gridCommands.gotoVariable(index), 80);
}

export function CommandPalette() {
  const { t, i18n } = useTranslation();
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const seed = useLayout((s) => s.paletteSeed);
  const [q, setQ] = useState('');
  const [varFocus, setVarFocus] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const dataset = useData((s) => s.dataset);

  const actionEntry = (id: string, group: string, path = ''): Entry | null => {
    const a = ACTIONS_BY_ID[id];
    if (!a) return null;
    const spec = id.startsWith('dialog:') ? SPECS_BY_ID[id.slice(7)] : undefined;
    return {
      key: `${group}:${id}`,
      label: t(a.label),
      path: [path, spec?.command ?? a.template].filter(Boolean).join(' · '),
      icon: a.icon ?? 'chevron_right',
      shortcut: formatShortcut(a.shortcut),
      badge: a.template ? t('shell.menu.syntaxBadge') : undefined,
      disabled: a.enabled ? !a.enabled() : false,
      keywords: `${path} ${a.keywords ?? ''} ${ACTION_WORDS[id] ?? ''} ${spec?.command ?? ''} ${id}`,
      group,
      run: () => {
        pushRecent(id);
        runAction(id);
      },
    };
  };

  const variableActions = (v: Variable, index: number): Entry[] => {
    const isScale = v.type === 'numeric' && v.measure === 'scale';
    const group = t('shell.palette.forVariable', { name: v.name });
    const mk = (key: string, label: string, icon: string, run: () => void): Entry => ({ key: `va:${key}`, label, icon, keywords: label, group, run });
    return [
      mk('jump', t('shell.palette.jump'), 'arrow_forward', () => jumpToVariable(index)),
      mk('inspect', t('shell.palette.properties'), 'right_panel_open', () => {
        useSettings.getState().set({ inspectorOpen: true });
        jumpToVariable(index);
      }),
      mk('freq', t('shell.palette.freqFor', { name: v.name }), 'bar_chart', () => openDialog('frequencies', { variables: [v.name] })),
      ...(v.type === 'numeric' ? [mk('desc', t('shell.palette.descFor', { name: v.name }), 'functions', () => openDialog('descriptives', { variables: [v.name] }))] : []),
      ...(isScale ? [mk('explore', t('shell.palette.exploreFor', { name: v.name }), 'query_stats', () => openDialog('explore', { variables: [v.name] }))] : []),
      mk('labels', t('shell.palette.valueLabelsFor', { name: v.name }), 'label', () => useUi.getState().openModal({ kind: 'valueLabels', index })),
      mk('recode', t('shell.palette.recodeFor', { name: v.name }), 'swap_horiz', () => openDialog('recodeDifferent', { variables: [v.name] })),
    ];
  };

  // ---- the searchable universe
  const universe = useMemo<Entry[]>(() => {
    if (!open) return [];
    const out: Entry[] = [];
    const seen = new Set<string>();
    const gActions = t('shell.palette.groupActions');
    for (const m of MENUS) {
      for (const { path, id } of flattenMenus(m.items, t, [t(m.label)])) {
        if (seen.has(id)) continue;
        seen.add(id);
        const e = actionEntry(id, gActions, path.join(' › '));
        if (e) out.push(e);
      }
    }
    for (const id of ['syntax.runAll', 'syntax.runCurrent', 'syntax.runSelection', 'syntax.runToEnd', 'syntax.save']) {
      const e = actionEntry(id, gActions, t('views.syntax'));
      if (e) out.push(e);
    }
    const gGoals = t('shell.palette.groupGoals');
    for (const g of GOALS) {
      g.actions.forEach((alt, i) => {
        const id = resolveMenuId(alt, has);
        const a = id ? ACTIONS_BY_ID[id] : undefined;
        if (!a || !id) return;
        out.push({
          key: `goal:${g.label}:${id}`,
          label: t(a.label),
          path: t(g.label),
          icon: i === 0 ? 'lightbulb' : (a.icon ?? 'chevron_right'),
          disabled: a.enabled ? !a.enabled() : false,
          keywords: `${g.words} ${t(g.label)}`,
          group: gGoals,
          run: () => {
            pushRecent(id);
            runAction(id);
          },
        });
      });
    }
    const gVars = t('shell.palette.groupVariables');
    dataset?.variables.forEach((v, index) =>
      out.push({
        key: `var:${v.name}`,
        label: v.name,
        path: v.label,
        icon: variableIcon(v),
        measure: v.type === 'string' ? 'string' : v.measure === 'unknown' ? 'scale' : v.measure,
        keywords: `${v.label} ${t('shell.palette.variableWord')}`,
        group: gVars,
        more: true,
        run: () => jumpToVariable(index),
      }),
    );
    const gResults = t('shell.palette.groupResults');
    for (const e of useOutput.getState().entries)
      out.push({
        key: `out:${e.id}`,
        label: e.title,
        path: new Date(e.time).toLocaleTimeString(i18n.language),
        icon: e.pinned ? 'push_pin' : 'article',
        keywords: `${e.syntax.slice(0, 200)} ${t('views.output')}`,
        group: gResults,
        run: () => {
          useOutput.getState().select(e.id);
          useUi.getState().setView('output');
        },
      });
    const gHelp = t('shell.palette.groupHelp');
    out.push({ key: 'help:shortcuts', label: t('actions.shortcuts'), icon: 'keyboard', shortcut: '?', keywords: 'help napoveda klavesy keys', group: gHelp, run: () => runAction('help.shortcuts') });
    const gCmd = t('palette.insertSyntax');
    for (const c of PSPP_COMMANDS) {
      out.push({ key: `cmd:${c}`, label: c, path: gCmd, icon: 'code_blocks', keywords: 'syntax syntaxe prikaz command', group: gCmd, run: () => pasteSyntax(syntaxTemplate(c, i18n.language === 'cs' ? 'cs' : 'en')) });
      out.push({ key: `man:${c}`, label: t('shell.palette.manualFor', { command: c }), icon: 'menu_book', keywords: `${c} manual prirucka help napoveda`, group: gHelp, run: () => window.open(manualUrl(c), '_blank', 'noopener') });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, t, i18n.language, dataset]);

  // ---- empty-query sections
  const home = useMemo<Entry[]>(() => {
    if (!open) return [];
    const out: Entry[] = [];
    const gRecent = t('shell.palette.groupRecent');
    for (const id of useDialogMemory.getState().recent.slice(0, 3)) {
      const spec = SPECS_BY_ID[id];
      if (spec) out.push({ key: `recall:${id}`, label: t('shell.palette.repeat', { name: t(spec.title) }), icon: 'history', keywords: '', group: gRecent, disabled: !dataset, run: () => openDialog(id) });
    }
    for (const id of readRecent()) {
      if (out.length >= 6) break;
      const e = actionEntry(id, gRecent);
      if (e && !out.some((x) => x.key.endsWith(`:${id}`) || x.key === `recall:${id.slice(7)}`)) out.push(e);
    }
    const gSug = t('shell.palette.groupSuggested');
    const col = useActiveVariable.getState().index ?? useUi.getState().selected?.col ?? null;
    const v = col !== null && dataset ? dataset.variables[col] : undefined;
    if (v && col !== null && !useUi.getState().showStart && (useUi.getState().view === 'data' || useUi.getState().view === 'variables'))
      out.push(...variableActions(v, col).slice(2, 4).map((e) => ({ ...e, group: gSug })));
    for (const id of dataset ? ['analysis.assistant', 'dialog:frequencies', 'dialog:descriptives'] : ['file.open', 'file.newData', 'file.sample.students']) {
      const e = actionEntry(id, gSug);
      if (e && !out.some((x) => x.label === e.label)) out.push(e);
    }
    const gViews = t('shell.palette.groupViews');
    for (const id of ['view:data', 'view:variables', 'view:output', 'view:syntax', 'view.journal', 'edit.settings']) {
      const e = actionEntry(id, gViews);
      if (e) out.push(e);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, t, dataset]);

  const results = useMemo<Entry[]>(() => {
    if (varFocus !== null && dataset?.variables[varFocus]) {
      const subs = variableActions(dataset.variables[varFocus], varFocus);
      const sq = q.trim();
      return sq ? subs.filter((e) => score(sq, e) > 0) : subs;
    }
    const raw = q.trimStart();
    const prefix = raw[0];
    const body = ['>', '@', '#', '?'].includes(prefix) ? raw.slice(1).trim() : raw.trim();
    let pool = universe;
    if (prefix === '>') pool = universe.filter((e) => e.group === t('shell.palette.groupActions') || e.key.startsWith('cmd:'));
    else if (prefix === '@') pool = universe.filter((e) => e.key.startsWith('var:'));
    else if (prefix === '#') pool = universe.filter((e) => e.key.startsWith('out:'));
    else if (prefix === '?') pool = universe.filter((e) => e.key.startsWith('help:') || e.key.startsWith('man:'));
    if (!body) return prefix && ['>', '@', '#', '?'].includes(prefix) ? pool.filter((e) => !e.key.startsWith('cmd:') && !e.key.startsWith('man:')).slice(0, 60) : home;
    const scored = pool
      .map((e) => {
        let s = score(body, e);
        if (!s) return null;
        if (e.key.startsWith('cmd:') || e.key.startsWith('man:')) s -= 6;
        if (e.key.startsWith('goal:')) s -= 2;
        if (e.key.startsWith('var:')) s += 2;
        if (e.disabled) s -= 4;
        return { e, s };
      })
      .filter((x): x is { e: Entry; s: number } => !!x)
      .sort((a, b) => b.s - a.s);
    // one row per action: goals repeat actions under a goal title
    const seenLabels = new Set<string>();
    const out: Entry[] = [];
    for (const { e } of scored) {
      const id = `${e.label}|${e.group === t('shell.palette.groupGoals') ? '' : e.path}`;
      if (e.key.startsWith('goal:') && seenLabels.has(e.label)) continue;
      if (seenLabels.has(id)) continue;
      seenLabels.add(id);
      seenLabels.add(e.label);
      out.push(e);
      if (out.length >= 60) break;
    }
    // group the list by section, keeping the best section first
    const order: string[] = [];
    for (const e of out) if (!order.includes(e.group)) order.push(e.group);
    return order.flatMap((g) => out.filter((e) => e.group === g));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe, home, q, varFocus, dataset, t]);

  useEffect(() => {
    if (open) {
      setQ(seed);
      setVarFocus(null);
      setActive(0);
      useLayout.getState().setPaletteSeed('');
      input.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => setActive(0), [q, varFocus]);
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  const close = () => setOpen(false);
  const choose = (e: Entry | undefined) => {
    if (!e || e.disabled) return;
    close();
    setTimeout(() => e.run(), 0);
  };
  const drill = (e: Entry | undefined) => {
    if (!e?.more || !dataset) return false;
    const idx = dataset.variables.findIndex((v) => `var:${v.name}` === e.key);
    if (idx < 0) return false;
    setVarFocus(idx);
    setQ('');
    return true;
  };

  let lastGroup = '';
  const focusVar = varFocus !== null ? dataset?.variables[varFocus] : undefined;
  return createPortal(
    <div className="pal-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="pal"
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        ref={box}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && !(focusVar === undefined && results[active]?.more)) trapTab(e.nativeEvent, box.current);
        }}
      >
        <div className="pal-search">
          {focusVar ? (
            <button type="button" className="pal-scope" onClick={() => setVarFocus(null)} aria-label={t('shell.palette.back')}>
              <Icon name="arrow_back" size={16} />
              {focusVar.name}
            </button>
          ) : (
            <Icon name="search" />
          )}
          <input
            ref={input}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={focusVar ? t('shell.palette.subPlaceholder') : t('shell.palette.placeholder')}
            aria-label={t('palette.placeholder')}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="pal-list"
            aria-autocomplete="list"
            aria-activedescendant={results[active] ? `pal-${active}` : undefined}
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'PageDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 8));
              } else if (e.key === 'PageUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 8));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(results[active]);
              } else if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'ArrowRight' && input.current?.selectionStart === q.length)) {
                if (focusVar === undefined && drill(results[active])) e.preventDefault();
              } else if ((e.key === 'Backspace' && !q) || (e.key === 'ArrowLeft' && focusVar && input.current?.selectionStart === 0)) {
                if (focusVar) {
                  e.preventDefault();
                  setVarFocus(null);
                }
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (focusVar) setVarFocus(null);
                else close();
              }
            }}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul className="pal-list" id="pal-list" role="listbox" ref={list} aria-label={t('palette.title')}>
          {results.length === 0 && (
            <li className="pal-empty" role="presentation">
              <strong>{t('shell.palette.noResults', { q: q.trim() })}</strong>
              <span>{t('shell.palette.noResultsHint')}</span>
            </li>
          )}
          {results.map((r, i) => {
            const head = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            return [
              head && (
                <li key={`g-${head}-${i}`} className="pal-group" role="presentation">
                  {head}
                </li>
              ),
              <li
                key={`${r.key}-${i}`}
                id={`pal-${i}`}
                data-idx={i}
                role="option"
                aria-selected={i === active}
                aria-disabled={r.disabled || undefined}
                className={`pal-item ${i === active ? 'on' : ''} ${r.disabled ? 'disabled' : ''}`}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => choose(r)}
              >
                <span className="pal-icon" data-measure={r.measure}>
                  <Icon name={r.icon} />
                </span>
                <span className="pal-text">
                  <span className="pal-label">{r.label}</span>
                  {r.path && <span className="pal-path">{r.path}</span>}
                </span>
                {r.badge && <span className="app-menu-badge">{r.badge}</span>}
                {r.more && i === active && (
                  <span className="pal-more">
                    {t('shell.palette.moreActions')} <kbd className="kbd">Tab</kbd>
                  </span>
                )}
                {r.shortcut && <kbd className="kbd">{r.shortcut}</kbd>}
              </li>,
            ];
          })}
        </ul>
        <div className="pal-foot">
          <span className="sr-only" aria-live="polite">
            {t('shell.palette.count', { count: results.length })}
          </span>
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> {t('shell.palette.navigate')}
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> {t('shell.palette.run')}
          </span>
          <span className="pal-prefixes">{t('shell.palette.prefixes')}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
