/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import cs from './cs.json';
import en from './en.json';

function flatten(o: unknown, prefix = '', out: string[] = []): string[] {
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.push(key.replace(/_(one|few|many|other)$/, ''));
  }
  return out;
}

const fragments = import.meta.glob<{ default: unknown }>('./fragments/*.json', { eager: true });

describe('translations', () => {
  it('each fragment has the same keys in cs and en', () => {
    for (const [path, mod] of Object.entries(fragments)) {
      if (!path.endsWith('.cs.json')) continue;
      const other = fragments[path.replace(/\.cs\.json$/, '.en.json')];
      expect(other, `${path} needs an .en.json twin`).toBeTruthy();
      const a = new Set(flatten(mod.default));
      const b = new Set(flatten(other.default));
      expect([...a].filter((k) => !b.has(k)), path).toEqual([]);
      expect([...b].filter((k) => !a.has(k)), path).toEqual([]);
    }
  });
  it('cs and en define the same keys', () => {
    const a = new Set(flatten(cs));
    const b = new Set(flatten(en));
    expect([...a].filter((k) => !b.has(k))).toEqual([]);
    expect([...b].filter((k) => !a.has(k))).toEqual([]);
  });
  it('defines dynamic keys', () => {
    const keys = new Set(flatten(cs));
    const dyn = [
      ...['name', 'type', 'width', 'decimals', 'label', 'values', 'missing', 'columns', 'align', 'measure', 'role'].map((c) => `variables.col.${c}`),
      ...['left', 'right', 'center'].map((a) => `align.${a}`),
      ...['nominal', 'ordinal', 'scale'].map((m) => `measure.${m}`),
      ...['input', 'target', 'both', 'none', 'partition', 'split'].map((r) => `role.${r}`),
      ...['loading', 'ready', 'running', 'error'].map((s) => `engine.${s}`),
      ...['profile', 'appearance', 'language', 'data', 'editor', 'files', 'shortcuts', 'about'].flatMap((s) => [`settings.section.${s}`, `settings.sectionDesc.${s}`]),
      ...['modern', 'classic', 'apa', 'compact'].map((s) => `settings.style.${s}`),
      ...['sav', 'zsav', 'por', 'csv'].flatMap((f) => [`saveAs.fmt.${f}`, `saveAs.fmtDesc.${f}`]),
      ...['error', 'warning', 'note'].map((s) => `output.severity.${s}`),
      ...['students', 'employees', 'trial'].flatMap((s) => [`samples.${s}.title`, `samples.${s}.desc`]),
      ...['numeric', 'comma', 'dot', 'scientific', 'date', 'dollar', 'custom', 'string'].map((k) => `varType.${k}`),
      ...['MEAN', 'MEDIAN', 'SUM', 'SD', 'MIN', 'MAX', 'N', 'NU', 'NMISS', 'NUMISS', 'FIRST', 'LAST'].map((f) => `agg.${f}`),
    ];
    expect(dyn.filter((k) => !keys.has(k))).toEqual([]);
  });
});
