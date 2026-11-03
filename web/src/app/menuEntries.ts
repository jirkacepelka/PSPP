/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { TFunction } from 'i18next';
import type { AppMenuEntry } from '../features/shell/AppMenu';
import { ACTIONS_BY_ID, formatShortcut, runAction } from './actions';
import { resolveMenuId, type MenuDef } from './menus';

const has = (id: string) => !!ACTIONS_BY_ID[id];

export function buildEntries(defs: MenuDef[], t: TFunction, prefix = ''): AppMenuEntry[] {
  const out: AppMenuEntry[] = [];
  defs.forEach((d, i) => {
    if (d === '-') {
      // no leading / doubled separators
      if (out.length && out[out.length - 1].type !== 'sep') out.push({ type: 'sep', id: `${prefix}sep${i}` });
    } else if (typeof d === 'string') {
      const id = resolveMenuId(d, has);
      const a = id ? ACTIONS_BY_ID[id] : undefined;
      if (!a) return;
      out.push({
        type: 'item',
        id: a.id,
        label: t(a.label),
        icon: a.icon,
        shortcut: formatShortcut(a.shortcut),
        checked: a.checked ? a.checked() : undefined,
        disabled: a.enabled ? !a.enabled() : false,
        badge: a.template ? t('shell.menu.syntaxBadge') : undefined,
        title: a.template ? t('shell.menu.templateTip', { command: a.template }) : undefined,
        onSelect: () => runAction(a.id),
      });
    } else if ('header' in d) out.push({ type: 'header', id: `${prefix}h${i}`, label: t(d.header) });
    else out.push({ type: 'submenu', id: `${prefix}${d.sub}`, label: t(d.sub), icon: d.icon, items: buildEntries(d.items, t, `${prefix}${d.sub}.`) });
  });
  while (out.length && out[out.length - 1].type === 'sep') out.pop();
  return out;
}

/** Flattens menus into a list of [path, actionId] for the command palette. */
export function flattenMenus(defs: MenuDef[], t: TFunction, path: string[] = []): { path: string[]; id: string }[] {
  const out: { path: string[]; id: string }[] = [];
  for (const d of defs) {
    if (d === '-') continue;
    if (typeof d === 'string') {
      const id = resolveMenuId(d, has);
      if (id) out.push({ path, id });
    } else if ('sub' in d) out.push(...flattenMenus(d.items, t, [...path, t(d.sub)]));
  }
  return out;
}
