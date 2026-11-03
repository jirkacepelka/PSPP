/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { TFunction } from 'i18next';
import type { MenuEntry } from '../components/Menu';
import { ACTIONS_BY_ID, formatShortcut, runAction } from './actions';
import type { MenuDef } from './menus';

export function buildEntries(defs: MenuDef[], t: TFunction, prefix = ''): MenuEntry[] {
  const out: MenuEntry[] = [];
  defs.forEach((d, i) => {
    if (d === '-') out.push({ type: 'sep', id: `${prefix}sep${i}` });
    else if (typeof d === 'string') {
      const a = ACTIONS_BY_ID[d];
      if (!a) return;
      out.push({
        type: 'item',
        id: a.id,
        label: t(a.label),
        icon: a.icon,
        shortcut: formatShortcut(a.shortcut),
        checked: a.checked ? a.checked() : undefined,
        disabled: a.enabled ? !a.enabled() : false,
        onSelect: () => runAction(a.id),
      });
    } else if ('header' in d) out.push({ type: 'header', id: `${prefix}h${i}`, label: t(d.header) });
    else out.push({ type: 'submenu', id: `${prefix}${d.sub}`, label: t(d.sub), icon: d.icon, items: buildEntries(d.items, t, `${prefix}${d.sub}.`) });
  });
  return out;
}

/** Flattens menus into a list of [path, actionId] for the command palette. */
export function flattenMenus(defs: MenuDef[], t: TFunction, path: string[] = []): { path: string[]; id: string }[] {
  const out: { path: string[]; id: string }[] = [];
  for (const d of defs) {
    if (d === '-') continue;
    if (typeof d === 'string') out.push({ path, id: d });
    else if ('sub' in d) out.push(...flattenMenus(d.items, t, [...path, t(d.sub)]));
  }
  return out;
}
