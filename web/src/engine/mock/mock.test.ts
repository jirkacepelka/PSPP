/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import { createMockEngine } from './index';
import { delimitedToDataset, datasetToDelimited } from '../../lib/csv';

const csv = 'id,group,score,name\n1,1,10.5,Ann\n2,1,12,Bob\n3,2,8,Cid\n4,2,,Dan\n';

describe('mock engine', () => {
  it('opens CSV with type guessing', async () => {
    const e = createMockEngine();
    const r = await e.open({ name: 'x.csv', bytes: new TextEncoder().encode(csv) });
    const ds = r.dataset!;
    expect(ds.variables.map((v) => [v.name, v.type])).toEqual([['id', 'numeric'], ['group', 'numeric'], ['score', 'numeric'], ['name', 'string']]);
    expect(ds.columns[2]).toEqual([10.5, 12, 8, null]);
    expect(datasetToDelimited(ds).split('\r\n')[1]).toBe('1,1,10.5,Ann');
  });
  it('runs FREQUENCIES and DESCRIPTIVES', async () => {
    const e = createMockEngine();
    const ds = delimitedToDataset(csv, 't');
    const r = await e.run('FREQUENCIES /VARIABLES=group.\nDESCRIPTIVES score /SAVE.', ds);
    expect(r.ok).toBe(true);
    const groups = r.items.filter((i) => i.kind === 'group');
    expect(groups.map((g) => g.kind === 'group' && g.title)).toEqual(['Frequencies', 'Descriptives']);
    const html = JSON.stringify(r.items);
    expect(html).toContain('10.17'); // mean of 10.5, 12, 8
    expect(r.dataset?.variables.some((v) => v.name === 'Zscore')).toBe(true);
  });
  it('reports errors with line numbers', async () => {
    const e = createMockEngine();
    const r = await e.run('LIST.\nFROBNICATE x.\n', delimitedToDataset(csv, 't'));
    expect(r.ok).toBe(false);
    const msg = r.items.find((i) => i.kind === 'message');
    expect(msg && msg.kind === 'message' && msg.line).toBe(2);
  });
  it('transforms data', async () => {
    const e = createMockEngine();
    const r = await e.run("COMPUTE double = score * 2.\nRECODE group (1='a') (2='b') INTO gstr.\nSORT CASES BY score (D).\nSELECT IF (score > 9).", delimitedToDataset(csv, 't'));
    expect(r.ok).toBe(true);
    const ds = r.dataset!;
    const idx = (n: string) => ds.variables.findIndex((v) => v.name === n);
    expect(ds.columns[idx('score')]).toEqual([12, 10.5]);
    expect(ds.columns[idx('double')]).toEqual([24, 21]);
    expect(ds.columns[idx('gstr')]).toEqual(['a', 'a']);
  });
});
