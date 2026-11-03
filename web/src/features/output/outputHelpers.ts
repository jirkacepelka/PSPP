/*
 * Output helpers: readable entry titles, flattening redundant groups, clipboard copies.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { TFunction } from 'i18next';
import type { OutputItem } from '../../engine/types';
import type { OutputEntry } from '../../store/output';
import { SPECS_BY_ID } from '../dialogs/specs';
import { walkFields, type VarListField } from '../dialogs/types';
import { toApa } from '../../lib/apa';

/** "T-test pro nezávislé výběry: gpa podle gender" for dialog results, the command name otherwise (OUT-2). */
export function entryTitle(e: OutputEntry, t: TFunction): string {
  const src = e.source;
  const spec = src ? SPECS_BY_ID[src.specId] : undefined;
  if (!spec || !src) return e.title;
  const lists: VarListField[] = [];
  walkFields(spec.fields, (f) => {
    if (f.kind === 'varlist') lists.push(f);
  });
  const vals = (id: string) => ((src.values[id] as string[] | undefined) ?? []).filter(Boolean);
  const main = lists.find((f) => vals(f.id).length && !f.groups) ?? lists.find((f) => vals(f.id).length);
  const by = lists.find((f) => f !== main && f.groups && vals(f.id).length);
  let vars = '';
  if (main) {
    const v = vals(main.id);
    vars = v.length > 3 ? `${v.slice(0, 3).join(', ')} +${v.length - 3}` : v.join(', ');
  } else {
    // rows fields (pairs), text targets (Compute)
    const target = src.values.target;
    if (typeof target === 'string' && target) vars = target;
    const pairs = src.values.pairs as { a?: string; b?: string; src?: string; dst?: string }[] | undefined;
    if (!vars && pairs?.length) vars = pairs.map((p) => (p.a && p.b ? `${p.a} – ${p.b}` : p.dst ?? p.src ?? '')).filter(Boolean).slice(0, 2).join(', ');
  }
  if (by) vars += ` ${t('output.by', { name: vals(by.id)[0] })}`;
  return vars ? `${t(spec.title)}: ${vars}` : t(spec.title);
}

/**
 * Items as they should be shown: when an entry has a single group (one procedure), show its
 * children directly so the outline and document do not repeat "T-test › T-test".
 */
export function visibleItems(e: OutputEntry): OutputItem[] {
  const shown = e.items.filter((i) => !(i as { hidden?: boolean }).hidden);
  const groups = shown.filter((i) => i.kind === 'group');
  if (groups.length === 1 && shown.length === 1 && groups[0].kind === 'group') return groups[0].children;
  return shown;
}

/** The PSPP command of an entry with a single procedure (for interpretation). */
export function singleCommand(e: OutputEntry): string | undefined {
  const groups = e.items.filter((i) => i.kind === 'group');
  return groups.length === 1 && groups[0].kind === 'group' ? groups[0].command : undefined;
}

export function tableToTsv(table: HTMLTableElement): string {
  return Array.from(table.rows)
    .map((r) => Array.from(r.cells).map((c) => c.innerText.replace(/\s+/g, ' ').trim()).join('\t'))
    .join('\n');
}

async function writeClipboard(html: string | null, text: string): Promise<boolean> {
  try {
    if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    } else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type CopyMode = 'table' | 'apa' | 'text';

/** Copies an output table (F7 / OUT-5). */
export async function copyTable(el: HTMLElement | null, html: string, mode: CopyMode, opts: { locale: 'cs' | 'en'; number: number }): Promise<boolean> {
  const table = el?.querySelector('table');
  if (mode === 'apa') {
    const apa = toApa(html, { locale: opts.locale, number: opts.number });
    return writeClipboard(apa.html, apa.text);
  }
  const text = table ? tableToTsv(table) : '';
  return writeClipboard(mode === 'table' && table ? table.outerHTML : null, text);
}

export async function copyText(text: string): Promise<boolean> {
  return writeClipboard(null, text);
}

/** Copies an SVG chart as a PNG image. */
export async function copyChartImage(svg: Element, toPng: (el: Element) => Promise<Blob>): Promise<boolean> {
  try {
    const blob = await toPng(svg);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/** "Dnes", "Včera" or a date (outline grouping by day). */
export function dayLabel(time: number, t: TFunction, locale: string): string {
  const d = new Date(time);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  if (diff === 0) return t('output.today');
  if (diff === 1) return t('output.yesterday');
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
