/*
 * Keyboard shortcuts cheat sheet (audit F13). Opened with "?" or Ctrl+/; the section for the
 * current view comes first. Generated from the action registry, so it never drifts.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Kbd } from '../../components/Kbd';
import { ACTIONS, currentScope, formatShortcut, type Action } from '../../app/actions';
import { useUi, type View } from '../../store/ui';
import './misc.css';

type Group = { id: string; title: string; rows: { keys: string; label: string }[] };

const EXTRA: Record<string, [string, string][]> = {
  global: [
    ['?', 'shell.shortcuts.cheatSheet'],
    ['F6', 'shell.shortcuts.regions'],
    ['F10', 'shell.shortcuts.menubar'],
    ['Alt', 'shell.shortcuts.mnemonics'],
  ],
  data: [
    ['Enter', 'shortcuts.editCell'],
    ['Escape', 'shortcuts.cancelEdit'],
    ['Shift+Arrow', 'shortcuts.extendSelection'],
    ['Shift+F10', 'shell.shortcuts.contextMenu'],
  ],
  syntax: [['Mod+Space', 'shortcuts.autocomplete']],
  dialogs: [
    ['Mod+Enter', 'shell.shortcuts.dialogRun'],
    ['Mod+Shift+Enter', 'shell.shortcuts.dialogPaste'],
    ['Escape', 'shortcuts.cancelEdit'],
  ],
  palette: [
    ['@', 'shell.shortcuts.palVariables'],
    ['>', 'shell.shortcuts.palCommands'],
    ['#', 'shell.shortcuts.palResults'],
    ['Tab', 'shell.shortcuts.palMore'],
  ],
};

function groups(t: (k: string) => string): Group[] {
  const by = (pred: (a: Action) => boolean) => ACTIONS.filter((a) => a.shortcut && pred(a)).map((a) => ({ keys: a.shortcut!, label: t(a.label) }));
  const extra = (id: string) => (EXTRA[id] ?? []).map(([keys, k]) => ({ keys, label: t(k) }));
  const scoped = (v: View) => (a: Action) => !!a.scope?.includes(v) && a.scope.length < 4;
  return [
    { id: 'global', title: t('shell.shortcuts.global'), rows: [...by((a) => !a.scope || a.id === 'file.save'), ...extra('global')] },
    { id: 'data', title: t('shell.shortcuts.data'), rows: [...by(scoped('data')), ...extra('data')] },
    { id: 'output', title: t('shell.shortcuts.output'), rows: by((a) => !!a.scope?.includes('output') && a.scope.length === 1) },
    { id: 'syntax', title: t('shell.shortcuts.syntax'), rows: [...by(scoped('syntax')), { keys: 'Mod+Enter', label: t('actions.runCurrent') }, ...extra('syntax')].filter((r, i, all) => all.findIndex((x) => x.keys === r.keys) === i) },
    { id: 'dialogs', title: t('shell.shortcuts.dialogs'), rows: extra('dialogs') },
    { id: 'palette', title: t('shell.shortcuts.palette'), rows: extra('palette') },
  ];
}

function keysOf(s: string): string[] {
  if (s === '?' || s === '@' || s === '>' || s === '#') return [s];
  return formatShortcut(s)
    .split(/\+(?!$)/)
    .filter(Boolean);
}

export function ShortcutsList({ focus }: { focus?: string }) {
  const { t } = useTranslation();
  const list = groups(t);
  const sorted = focus ? [...list.filter((g) => g.id === focus), ...list.filter((g) => g.id !== focus)] : list;
  return (
    <div className="misc-shortcuts">
      {sorted.map((g) =>
        g.rows.length ? (
          <section key={g.id} className={`misc-sc-group ${g.id === focus ? 'is-current' : ''}`} aria-labelledby={`sc-${g.id}`}>
            <h3 id={`sc-${g.id}`} className="misc-sc-title">
              {g.title}
              {g.id === focus && <span className="misc-sc-here">{t('shell.shortcuts.here')}</span>}
            </h3>
            <dl className="misc-sc-list">
              {g.rows.map((r) => (
                <div key={`${r.keys}-${r.label}`} className="misc-sc-row">
                  <dt>{r.label}</dt>
                  <dd>
                    <Kbd keys={keysOf(r.keys)} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null,
      )}
    </div>
  );
}

export function ShortcutsDialog() {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  const scope = currentScope();
  const focus = scope === 'variables' ? 'data' : scope === 'start' ? 'global' : scope;
  return (
    <Dialog title={t('actions.shortcuts')} description={t('shell.shortcuts.desc')} icon="keyboard" onClose={close} size="wide">
      <ShortcutsList focus={focus} />
    </Dialog>
  );
}
