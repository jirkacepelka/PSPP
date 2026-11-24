/*
 * Graph Studio phase 4 tests: overlay scatter, bubble, mosaic, ridgeline, radar, lollipop, waterfall, forest,
 * treemap, Bland-Altman, forecast and scatter marginals, with small datasets whose results are worked out by hand.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { Dataset, Variable } from '../engine/types';
import type { GraphDef, GraphKind } from '../charts/studioTypes';
import students from '../samples/students.json';
import { tInv } from '../ext/dist';
import { computeChart } from './compute';
import { BA_LIMIT, forecastModel } from './compute4';
import { defaultDef, GALLERY, GROUP_ORDER, KINDS, optionsOf, slotsOf } from './model';
import { studioChart } from './outputBridge';
import { seriesNames } from './series';

const t = (k: string, a?: Record<string, unknown>) => (a ? `${k}:${JSON.stringify(a)}` : k);

const num = (name: string, extra: Partial<Variable> = {}): Variable => ({
  name,
  label: '',
  type: 'numeric',
  width: 0,
  print: { type: 'F', w: 8, d: 2 },
  write: { type: 'F', w: 8, d: 2 },
  valueLabels: [],
  missing: { values: [] },
  columns: 8,
  align: 'right',
  measure: 'scale',
  role: 'input',
  ...extra,
});

const ds = (vars: [string, (number | null)[]][], extra: Partial<Dataset> = {}): Dataset => ({
  name: 't',
  variables: vars.map(([n]) => num(n)),
  columns: vars.map(([, c]) => c),
  ...extra,
});

const def = (kind: GraphKind, bind: GraphDef['bind'], options: Record<string, unknown> = {}, variant?: string): GraphDef => {
  const d = defaultDef(kind, variant);
  return { ...d, bind, options: { ...d.options, ...options } };
};

function ok(d: GraphDef, data: Dataset) {
  const r = computeChart(d, data, t);
  if (!r.ok) throw new Error(`not ok: ${JSON.stringify(r)}`);
  return r;
}
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const chartOf = (d: GraphDef, data: Dataset): Obj => ok(d, data).chart as Obj;

const NEW_KINDS: GraphKind[] = ['overlay', 'bubble', 'mosaic', 'ridgeline', 'radar', 'lollipop', 'waterfall', 'forest', 'treemap', 'blandaltman', 'forecast'];

describe('gallery and model', () => {
  it('lists every new kind, in known gallery groups', () => {
    for (const k of NEW_KINDS) {
      expect(KINDS[k], k).toBeTruthy();
      expect(
        GALLERY.some((e) => e.kind === k),
        k,
      ).toBe(true);
    }
    for (const e of GALLERY) expect(GROUP_ORDER, e.id).toContain(e.group);
    expect(new Set(GALLERY.map((e) => e.id)).size).toBe(GALLERY.length);
  });
  it('gives every slot of every new kind and variant a place, with legend/size roles where they belong', () => {
    for (const k of NEW_KINDS) {
      for (const vr of KINDS[k]!.variants) {
        const d = defaultDef(k, vr.id);
        for (const s of slotsOf(d)) expect(s.place, `${k}:${vr.id}:${s.id}`).toBeTruthy();
      }
    }
    const place = (k: GraphKind, id: string, variant?: string) => slotsOf(defaultDef(k, variant)).find((s) => s.id === id)?.place;
    expect(place('bubble', 'size')).toBe('size');
    expect(place('bubble', 'group')).toBe('legend');
    expect(place('overlay', 'y')).toBe('y');
    expect(place('lollipop', 'x', 'simple')).toBe('x');
    // horizontal variants swap the axes
    expect(place('lollipop', 'x', 'horizontal')).toBe('y');
    expect(place('forest', 'est')).toBe('x');
    expect(place('ridgeline', 'group')).toBe('y');
  });
  it('lollipop is a bar with the same slots; scatter has the marginals option', () => {
    const l = defaultDef('lollipop');
    expect(slotsOf(l).map((s) => s.id)).toEqual(['x', 'group', 'panel']);
    expect(slotsOf({ ...l, options: { ...l.options, func: 'mean' } }).map((s) => s.id)).toEqual(['x', 'group', 'value', 'panel']);
    const m = optionsOf(defaultDef('scatter')).find((o) => o.id === 'marginals')!;
    expect((m.choices as { value: string }[]).map((c) => c.value)).toEqual(['none', 'histogram', 'density', 'box']);
    expect(defaultDef('scatter').options.marginals).toBe('none');
  });
  it('forecast options follow the method', () => {
    const ids = (method: string) =>
      optionsOf({
        ...defaultDef('forecast'),
        options: { ...defaultDef('forecast').options, method },
      }).map((o) => o.id);
    const base = (method: string) =>
      optionsOf({
        ...defaultDef('forecast'),
        options: { ...defaultDef('forecast').options, method },
      })
        .filter(
          (o) =>
            !o.when ||
            o.when({
              ...defaultDef('forecast'),
              options: { ...defaultDef('forecast').options, method },
            }),
        )
        .map((o) => o.id);
    expect(ids('ma')).toContain('window');
    expect(base('ma')).toContain('window');
    expect(base('trend')).not.toContain('window');
    expect(base('ses')).toContain('alpha');
    expect(base('ses')).not.toContain('beta');
    expect(base('holt')).toContain('beta');
  });
  it('all visible text of the new kinds exists in cs and en', async () => {
    const files = import.meta.glob<{ default: Record<string, unknown> }>('../i18n/fragments/*.json', { eager: true });
    const merge = (a: Obj, b: Obj): Obj => {
      for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && a[k] && typeof a[k] === 'object' ? merge(a[k], v as Obj) : v;
      return a;
    };
    const load = (lang: string) =>
      Object.entries(files)
        .filter(([p]) => p.endsWith(`.${lang}.json`))
        .reduce((acc, [, m]) => merge(acc, JSON.parse(JSON.stringify(m.default))), {} as Obj);
    const get = (o: Obj, key: string): unknown => key.split('.').reduce((a: any, p) => (a && typeof a === 'object' ? a[p] : undefined), o); // eslint-disable-line @typescript-eslint/no-explicit-any
    const keys = new Set<string>();
    for (const k of NEW_KINDS) {
      const m = KINDS[k]!;
      keys.add(m.label);
      keys.add(`graphstudio.group.${m.group}`);
      for (const vr of m.variants) {
        keys.add(vr.label);
        const d = defaultDef(k, vr.id);
        for (const s of slotsOf(d)) {
          keys.add(s.label);
          if (s.hint) keys.add(s.hint);
        }
        for (const o of optionsOf(d)) {
          keys.add(o.label);
          for (const c of typeof o.choices === 'function' ? o.choices(d) : (o.choices ?? [])) keys.add(c.label);
        }
      }
    }
    for (const lang of ['cs', 'en']) {
      const cat = load(lang);
      expect(
        [...keys].filter((k) => get(cat, k) === undefined),
        lang,
      ).toEqual([]);
    }
  });
});

describe('overlay scatter', () => {
  const data = ds([
    ['x', [1, 2, 3]],
    ['a', [2, 4, 6]],
    ['b', [1, 1, 2]],
  ]);
  it('emits one scatter with the group = y variable name and a Variables legend', () => {
    const c = chartOf(def('overlay', { x: ['x'], y: ['a', 'b'] }), data);
    expect(c.type).toBe('scatter');
    expect(c.points).toEqual([
      [1, 2, 'a'],
      [2, 4, 'a'],
      [3, 6, 'a'],
      [1, 1, 'b'],
      [2, 1, 'b'],
      [3, 2, 'b'],
    ]);
    expect(c.byvar).toBe('graphstudio.legend.variables');
    expect(c.fit).toBe('none');
    expect(seriesNames(c)).toEqual(['a', 'b']);
  });
  it('fits each variable separately when a fit is chosen', () => {
    const c = chartOf(def('overlay', { x: ['x'], y: ['a', 'b'] }, { fit: 'linear', fitCi: true }), data);
    expect([c.fit, c.fitByGroup, c.fitCi, c.showR2]).toEqual(['linear', true, true, true]);
  });
  it('needs two y variables', () => {
    const r = computeChart(def('overlay', { x: ['x'], y: ['a'] }), data, t);
    expect(r).toMatchObject({ ok: false, reason: 'missing' });
  });
});

describe('scatter marginals', () => {
  const data = ds([
    ['x', [1, 2, 3]],
    ['y', [3, 1, 2]],
  ]);
  it('passes the option on and omits it when none', () => {
    expect(chartOf(def('scatter', { x: ['x'], y: ['y'] }), data).marginals).toBeUndefined();
    expect(chartOf(def('scatter', { x: ['x'], y: ['y'] }, { marginals: 'density' }), data).marginals).toBe('density');
  });
});

describe('bubble', () => {
  const data = ds([
    ['x', [1, 2, 3, 4]],
    ['y', [4, 3, 2, 1]],
    ['s', [10, 0, 30, 40]],
    ['g', [1, 1, 2, 2]],
    ['l', [1, 2, 3, 4]],
  ]);
  it('draws x, y, size, group and label; drops non-positive sizes with a note', () => {
    const r = ok(
      def('bubble', {
        x: ['x'],
        y: ['y'],
        size: ['s'],
        group: ['g'],
        label: ['l'],
      }),
      data,
    );
    const c = r.chart as Obj;
    expect(c.type).toBe('bubble');
    expect(c.sizeLabel).toBe('s');
    expect(c.points).toEqual([
      { x: 1, y: 4, size: 10, group: '1', label: '1' },
      { x: 3, y: 2, size: 30, group: '2', label: '3' },
      { x: 4, y: 1, size: 40, group: '2', label: '4' },
    ]);
    expect(r.notes.some((n) => n.startsWith('graphstudio.note.bubbleDropped'))).toBe(true);
  });
  it('has no group or label without those slots', () => {
    const c = chartOf(def('bubble', { x: ['x'], y: ['y'], size: ['s'] }), data);
    expect(c.points[0]).toEqual({ x: 1, y: 4, size: 10, group: null });
  });
  it('says the weight is not used', () => {
    const r = ok(def('bubble', { x: ['x'], y: ['y'], size: ['s'] }), {
      ...data,
      weight: 'w',
      variables: [...data.variables, num('w')],
      columns: [...data.columns, [1, 1, 1, 1]],
    });
    expect(r.notes.some((n) => n.startsWith('graphstudio.note.weightIgnored'))).toBe(true);
  });
});

describe('mosaic', () => {
  const data = ds([
    ['a', [1, 1, 1, 2, 2, 2, 2]],
    ['b', [1, 1, 2, 1, 2, 2, 2]],
    ['w', [1, 1, 1, 1, 1, 1, 3]],
  ]);
  it('counts cases per cell as counts[yi][xi]', () => {
    const c = chartOf(def('mosaic', { x: ['a'], y: ['b'] }), data);
    expect(c.xs).toEqual(['1', '2']);
    expect(c.ys).toEqual(['1', '2']);
    expect(c.counts).toEqual([
      [2, 1],
      [1, 3],
    ]);
    expect(c.shade).toBe(true);
  });
  it('honours the weight and the shade option', () => {
    const c = chartOf(def('mosaic', { x: ['a'], y: ['b'] }, { shade: false }), {
      ...data,
      weight: 'w',
    });
    expect(c.counts).toEqual([
      [2, 1],
      [1, 5],
    ]);
    expect(c.shade).toBe(false);
  });
});

describe('ridgeline', () => {
  it('is a density with the ridge layout, one curve per group', () => {
    const data = ds([
      ['v', [1, 2, 3, 4, 5, 10, 11, 12, 13, 14]],
      ['g', [1, 1, 1, 1, 1, 2, 2, 2, 2, 2]],
    ]);
    const c = chartOf(def('ridgeline', { value: ['v'], group: ['g'] }), data);
    expect(c.type).toBe('density');
    expect(c.layout).toBe('ridge');
    expect(c.curves.map((q: Obj) => q.name)).toEqual(['1', '2']);
    expect(c.ylabel).toBe('g');
  });
});

describe('radar', () => {
  const data = ds([
    ['a', [1, 3, 5, 7]],
    ['b', [10, 10, 20, 20]],
    ['c', [0, 4, 0, 4]],
    ['g', [1, 1, 2, 2]],
  ]);
  it('summarises per group on each axis, standardised to 0-100 over the data range', () => {
    const c = chartOf(def('radar', { vars: ['a', 'b', 'c'], group: ['g'] }), data);
    expect(c.axes).toEqual(['a', 'b', 'c']);
    expect([c.min, c.max]).toEqual([0, 100]);
    // a: group means 2 and 6 over range 1..7 -> 100/6 and 500/6; b: 10 and 20 over 10..20 -> 0, 100; c: 2 and 2 over 0..4 -> 50
    expect(c.series[0].values[0]).toBeCloseTo(100 / 6);
    expect(c.series[1].values[0]).toBeCloseTo(500 / 6);
    expect(c.series[0].values[1]).toBeCloseTo(0);
    expect(c.series[1].values[1]).toBeCloseTo(100);
    expect(c.series[0].values[2]).toBeCloseTo(50);
  });
  it('overall mean without a group, raw values when not standardised', () => {
    const c = chartOf(def('radar', { vars: ['a', 'b', 'c'] }, { standardise: false }), data);
    expect(c.series).toHaveLength(1);
    expect(c.series[0].values).toEqual([4, 15, 2]);
    expect([c.min, c.max]).toEqual([null, null]);
  });
  it('uses the chosen summary function', () => {
    const c = chartOf(def('radar', { vars: ['a', 'b', 'c'] }, { standardise: false, func: 'max' }), data);
    expect(c.series[0].values).toEqual([7, 20, 4]);
  });
  it('needs three variables', () => {
    expect(computeChart(def('radar', { vars: ['a', 'b'] }), data, t)).toMatchObject({ ok: false, reason: 'missing' });
  });
});

describe('lollipop', () => {
  const data = ds([
    ['x', [1, 1, 2, 2, 2]],
    ['v', [10, 20, 30, 40, 50]],
    ['g', [1, 2, 1, 2, 1]],
  ]);
  it('is the bar summary with lollipop true', () => {
    const c = chartOf(def('lollipop', { x: ['x'], value: ['v'] }, { func: 'mean' }), data);
    expect(c.type).toBe('bar');
    expect(c.lollipop).toBe(true);
    expect(c.bars.map((b: Obj) => b.count)).toEqual([15, 40]);
    expect(c.horizontal).toBe(false);
  });
  it('clustered and horizontal variants', () => {
    const cl = chartOf(def('lollipop', { x: ['x'], group: ['g'] }, {}, 'clustered'), data);
    expect(cl.bars).toHaveLength(4);
    expect(cl.stack).toBe('none');
    const h = chartOf(def('lollipop', { x: ['x'] }, {}, 'horizontal'), data);
    expect(h.horizontal).toBe(true);
    expect(h.bars.map((b: Obj) => b.count)).toEqual([2, 3]);
  });
});

describe('waterfall', () => {
  const data = ds([
    ['c', [1, 1, 2, 3, 4]],
    ['v', [5, 5, -3, 4, 11]],
  ]);
  it('sums values per category in order', () => {
    const c = chartOf(def('waterfall', { x: ['c'], value: ['v'] }), data);
    expect(c.steps).toEqual([
      { label: '1', value: 10 },
      { label: '2', value: -3 },
      { label: '3', value: 4 },
      { label: '4', value: 11 },
    ]);
  });
  it('last is total: the bar carries the running sum and a mismatch is noted', () => {
    const r = ok(def('waterfall', { x: ['c'], value: ['v'] }, { lastTotal: true }), data);
    const steps = (r.chart as Obj).steps;
    expect(steps[3]).toEqual({ label: '4', value: 11, total: true });
    expect(steps.slice(0, 3).every((s: Obj) => !s.total)).toBe(true);
    expect(r.notes.some((n) => n.startsWith('graphstudio.note.wfTotal'))).toBe(false);
    const bad = ok(
      def('waterfall', { x: ['c'], value: ['v'] }, { lastTotal: true }),
      ds([
        ['c', [1, 2, 3]],
        ['v', [5, 5, 9]],
      ]),
    );
    expect((bad.chart as Obj).steps[2]).toMatchObject({
      value: 10,
      total: true,
    });
    expect(bad.notes.some((n) => n.startsWith('graphstudio.note.wfTotal'))).toBe(true);
  });
});

describe('forest', () => {
  it('estimates with limits, one row per case', () => {
    const data = ds([
      ['l', [1, 2, 3]],
      ['e', [0.5, 1, -0.2]],
      ['lo', [0, 0.5, -1]],
      ['hi', [1, 1.5, 0.6]],
    ]);
    const c = chartOf(def('forest', { label: ['l'], est: ['e'], lo: ['lo'], hi: ['hi'] }, {}, 'estimates'), data);
    expect(c.type).toBe('forest');
    expect(c.rows.map((r: Obj) => [r.label, r.est, r.lo, r.hi])).toEqual([
      ['1', 0.5, 0, 1],
      ['2', 1, 0.5, 1.5],
      ['3', -0.2, -1, 0.6],
    ]);
    expect([c.refValue, c.log]).toEqual([0, false]);
  });
  it('log axis: reference 1, rows with non-positive limits are dropped', () => {
    const data = ds([
      ['l', [1, 2]],
      ['e', [1.5, 0.8]],
      ['lo', [1.1, -0.1]],
      ['hi', [2, 1.2]],
    ]);
    const r = ok(def('forest', { label: ['l'], est: ['e'], lo: ['lo'], hi: ['hi'] }, { log: true }, 'estimates'), data);
    const c = r.chart as Obj;
    expect(c.log).toBe(true);
    expect(c.refValue).toBe(1);
    expect(c.rows).toHaveLength(1);
    expect(r.notes.some((n) => n.startsWith('graphstudio.note.forestBadLog'))).toBe(true);
    expect((ok(def('forest', { label: ['l'], est: ['e'], lo: ['lo'], hi: ['hi'] }, { log: true, refValue: 2 }, 'estimates'), data).chart as Obj).refValue).toBe(2);
  });
  it('means with t confidence intervals by category', () => {
    const data = ds([
      ['v', [1, 2, 3, 4, 10, 12]],
      ['g', [1, 1, 1, 1, 2, 2]],
    ]);
    const c = chartOf(def('forest', { value: ['v'], x: ['g'] }, { overall: false }, 'means'), data);
    // group 1: mean 2.5, sd sqrt(5/3), se = sd / 2
    const half = tInv(0.975, 3) * (Math.sqrt(5 / 3) / 2);
    expect(c.rows[0].est).toBeCloseTo(2.5);
    expect(c.rows[0].lo).toBeCloseTo(2.5 - half);
    expect(c.rows[0].hi).toBeCloseTo(2.5 + half);
    // group 2: n = 2, mean 11, sd sqrt(2), se = 1, t(1 df) = 12.706
    expect(c.rows[1].hi - c.rows[1].est).toBeCloseTo(tInv(0.975, 1));
    expect(c.rows).toHaveLength(2);
  });
  it('overall row and a level option; groups of one case have no interval', () => {
    const data = ds([
      ['v', [1, 2, 3, 4, 10, 12, 20]],
      ['g', [1, 1, 1, 1, 2, 2, 3]],
    ]);
    const r = ok(def('forest', { value: ['v'], x: ['g'] }, { overall: true, level: 90 }, 'means'), data);
    const c = r.chart as Obj;
    expect(c.rows.map((q: Obj) => q.label)).toEqual(['1', '2', 'graphstudio.chart.overall']);
    expect(c.rows[0].hi - c.rows[0].est).toBeCloseTo(tInv(0.95, 3) * (Math.sqrt(5 / 3) / 2));
    expect(r.notes.some((n) => n.startsWith('graphstudio.note.forestFew'))).toBe(true);
  });
});

describe('treemap', () => {
  const data = ds([
    ['c', [1, 1, 1, 2, 2, 3]],
    ['g', [1, 1, 1, 2, 2, 2]],
    ['v', [5, 5, 5, -1, 2, 7]],
  ]);
  it('counts cases per category and group', () => {
    const c = chartOf(def('treemap', { x: ['c'], group: ['g'] }), data);
    expect(c.tiles).toEqual([
      { label: '1', value: 3, group: '1' },
      { label: '2', value: 2, group: '2' },
      { label: '3', value: 1, group: '2' },
    ]);
  });
  it('sums a variable; non-positive totals are dropped with a note', () => {
    const r = ok(def('treemap', { x: ['c'], value: ['v'] }, { func: 'sum' }), data);
    expect((r.chart as Obj).tiles).toEqual([
      { label: '1', value: 15, group: null },
      { label: '2', value: 1, group: null },
      { label: '3', value: 7, group: null },
    ]);
    const neg = ok(
      def('treemap', { x: ['c'], value: ['v'] }, { func: 'sum' }),
      ds([
        ['c', [1, 2]],
        ['v', [-3, 4]],
      ]),
    );
    expect((neg.chart as Obj).tiles).toHaveLength(1);
    expect(neg.notes.some((n) => n.startsWith('graphstudio.note.treemapDropped'))).toBe(true);
  });
});

describe('Bland-Altman', () => {
  const data = ds([
    ['a', [10, 12, 14, 16]],
    ['b', [9, 12, 15, 15]],
  ]);
  it('plots difference against the mean with the limits of agreement as editable reference lines', () => {
    const c = chartOf(def('blandaltman', { a: ['a'], b: ['b'] }), data);
    expect(c.type).toBe('scatter');
    expect(c.points).toEqual([
      [9.5, 1],
      [12, 0],
      [14.5, -1],
      [15.5, 1],
    ]);
    // differences 1, 0, -1, 1: mean 0.25, sum of squares 2.75, sd = sqrt(2.75 / 3)
    const sdv = Math.sqrt(2.75 / 3);
    const lines = c.style.refLines as {
      axis: string;
      value: number;
      label: string;
      dash?: boolean;
    }[];
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.axis === 'y')).toBe(true);
    expect(lines[0].value).toBeCloseTo(0.25);
    expect(lines[1].value).toBeCloseTo(0.25 + BA_LIMIT * sdv);
    expect(lines[2].value).toBeCloseTo(0.25 - BA_LIMIT * sdv);
    expect(lines.every((l) => l.label.length > 0)).toBe(true);
    expect(c.fit).toBe('none');
  });
  it('percent difference and the optional trend line', () => {
    const c = chartOf(def('blandaltman', { a: ['a'], b: ['b'] }, { percent: true, trend: true }), data);
    expect(c.points[0][1]).toBeCloseTo((100 * 1) / 9.5);
    expect(c.fit).toBe('linear');
    expect(c.ylabel).toContain('baDiffPct');
  });
  it('the spec style defaults reach the stored chart and the user style wins per key', () => {
    const spec = chartOf(def('blandaltman', { a: ['a'], b: ['b'] }), data);
    const stored = studioChart(spec, def('blandaltman', { a: ['a'], b: ['b'] }), {});
    expect((stored.style as Obj).refLines).toHaveLength(3);
    const emptied = studioChart(spec, def('blandaltman', { a: ['a'], b: ['b'] }), { refLines: [] });
    expect((emptied.style as Obj | undefined)?.refLines).toBeUndefined();
    const own = studioChart(spec, def('blandaltman', { a: ['a'], b: ['b'] }), {
      refLines: [{ axis: 'y', value: 5 }],
      title: 'T',
    });
    expect(own.style as Obj).toMatchObject({
      refLines: [{ axis: 'y', value: 5 }],
      title: 'T',
    });
  });
});

describe('forecast model', () => {
  const lin = [2, 4, 6, 8, 10];
  const xs = [1, 2, 3, 4, 5];
  const xf = [6, 7];
  it('linear trend: least squares line and the textbook prediction interval', () => {
    const exact = forecastModel(lin, {
      method: 'trend',
      window: 3,
      alpha: null,
      beta: null,
      xs,
      xf,
    })!;
    expect(exact.forecast).toEqual([12, 14]);
    const y = [1, 3, 2, 4, 5];
    const r = forecastModel(y, {
      method: 'trend',
      window: 3,
      alpha: null,
      beta: null,
      xs,
      xf: [6],
    })!;
    // slope 0.9, intercept 0.3: forecast 5.7, SSE 1.9, sigma^2 = 1.9 / 3, factor 1 + 1/5 + (6 - 3)^2 / 10
    expect(r.level[0]).toBeCloseTo(1.2);
    expect(r.forecast[0]).toBeCloseTo(5.7);
    const half = tInv(0.975, 3) * Math.sqrt((1.9 / 3) * 2.1);
    expect(r.hi[0]).toBeCloseTo(5.7 + half);
    expect(r.lo[0]).toBeCloseTo(5.7 - half);
  });
  it('moving average: trailing mean, flat forecast, residual based interval', () => {
    const r = forecastModel([1, 3, 5, 7], {
      method: 'ma',
      window: 2,
      alpha: null,
      beta: null,
      xs: [1, 2, 3, 4],
      xf: [5, 6],
    })!;
    expect(r.level).toEqual([null, 2, 4, 6]);
    expect(r.forecast).toEqual([6, 6]);
    // errors: y3 - level2 = 3, y4 - level3 = 3: m = 2, sigma^2 = 18 / 1, df 1
    expect(r.hi[0]).toBeCloseTo(6 + tInv(0.975, 1) * Math.sqrt(18));
    expect(
      forecastModel([1, 2], {
        method: 'ma',
        window: 3,
        alpha: null,
        beta: null,
        xs: [1, 2],
        xf: [3],
      }),
    ).toBeNull();
  });
  it('simple exponential smoothing with a given alpha', () => {
    const r = forecastModel([10, 20, 30], {
      method: 'ses',
      window: 3,
      alpha: 0.5,
      beta: null,
      xs: [1, 2, 3],
      xf: [4, 5],
    })!;
    expect(r.level).toEqual([10, 15, 22.5]);
    expect(r.forecast).toEqual([22.5, 22.5]);
    // errors 10 and 15: SSE 325, sigma^2 = 325 / 1; variance of step k: sigma^2 (1 + alpha^2 (k - 1))
    const q = tInv(0.975, 1);
    expect(r.hi[0]).toBeCloseTo(22.5 + q * Math.sqrt(325));
    expect(r.hi[1]).toBeCloseTo(22.5 + q * Math.sqrt(325 * 1.25));
  });
  it('alpha fitted on the grid is the least squares one', () => {
    const y = [3, 5, 4, 6, 8, 7, 9];
    const sse = (a: number) => {
      let l = y[0];
      let s = 0;
      for (let i = 1; i < y.length; i++) {
        s += (y[i] - l) ** 2;
        l = a * y[i] + (1 - a) * l;
      }
      return s;
    };
    let best = 0.01;
    for (let k = 1; k <= 99; k++) if (sse(k / 100) < sse(best) - 1e-12) best = k / 100;
    const r = forecastModel(y, {
      method: 'ses',
      window: 3,
      alpha: null,
      beta: null,
      xs: y.map((_, i) => i + 1),
      xf: [8],
    })!;
    expect(r.alpha).toBeCloseTo(best);
  });
  it('Holt linear smoothing with given constants, worked out by hand', () => {
    const r = forecastModel([1, 3, 2, 5], {
      method: 'holt',
      window: 3,
      alpha: 0.5,
      beta: 0.5,
      xs: [1, 2, 3, 4],
      xf: [5],
    })!;
    expect(r.level).toEqual([1, 3, 3.5, 4.875]);
    // trend after the last value: 1.3125
    expect(r.forecast[0]).toBeCloseTo(4.875 + 1.3125);
    expect([r.alpha, r.beta]).toEqual([0.5, 0.5]);
    // a straight line is followed exactly, whatever the fitted constants
    const line = forecastModel([1, 2, 3, 4, 5], {
      method: 'holt',
      window: 3,
      alpha: null,
      beta: null,
      xs: [1, 2, 3, 4, 5],
      xf: [6, 7],
    })!;
    expect(line.forecast[0]).toBeCloseTo(6);
    expect(line.forecast[1]).toBeCloseTo(7);
  });
  it('has no interval without degrees of freedom', () => {
    const r = forecastModel([1, 3, 2], {
      method: 'holt',
      window: 3,
      alpha: 0.5,
      beta: 0.5,
      xs: [1, 2, 3],
      xf: [4],
    })!;
    expect(r.lo).toEqual([null]);
  });
});

describe('forecast chart', () => {
  const data = ds([
    ['v', [1, 3, 2, 4, 5]],
    ['t', [10, 20, 30, 40, 50]],
  ]);
  it('extends the sequence with a dashed forecast series and a prediction band', () => {
    const r = ok(def('forecast', { value: ['v'] }, { method: 'trend', horizon: 2 }), data);
    const c = r.chart as Obj;
    expect(c.type).toBe('sequence');
    expect(c.x).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(c.series.map((s: Obj) => s.name)).toEqual(['v', 'graphstudio.forecast.trend', 'graphstudio.chart.forecastLine']);
    expect(c.series[0].values).toEqual([1, 3, 2, 4, 5, null, null]);
    expect(c.series[2].dash).toBe(true);
    expect(c.series[2].values.slice(0, 3)).toEqual([null, null, null]);
    // the dashed line starts at the last level and continues with the forecasts
    expect(c.series[2].values[4]).toBeCloseTo(4.8);
    expect(c.series[2].values[5]).toBeCloseTo(5.7);
    expect(c.bands).toHaveLength(1);
    expect(c.bands[0].lo[4]).toBeCloseTo(4.8);
    expect(c.bands[0].hi[4]).toBeCloseTo(4.8);
    expect(c.bands[0].hi[5]).toBeGreaterThan(c.bands[0].lo[5]);
  });
  it('uses a numeric x axis and continues with its mean spacing; no band when switched off', () => {
    const c = chartOf(def('forecast', { value: ['v'], x: ['t'] }, { method: 'ma', window: 2, horizon: 2, band: false }), data);
    expect(c.x).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(c.bands).toBeUndefined();
    expect(c.xlabel).toBe('t');
  });
  it('no forecast horizon gives only the series; too few values gives nothing', () => {
    const c = chartOf(def('forecast', { value: ['v'] }, { method: 'ses', horizon: 0 }), data);
    expect(c.series).toHaveLength(2);
    expect(c.x).toHaveLength(5);
    const r = computeChart(def('forecast', { value: ['v'] }, { method: 'trend' }), ds([['v', [1, 2]]]), t);
    expect(r).toMatchObject({ ok: false, reason: 'nodata' });
  });
  it('reports fitted smoothing constants', () => {
    const r = ok(def('forecast', { value: ['v'] }, { method: 'holt', horizon: 1 }), data);
    expect(r.notes.some((n) => n.startsWith('graphstudio.note.fittedAlphaBeta'))).toBe(true);
  });
});

describe('students sample', () => {
  const sample = students as unknown as Dataset;
  const cases: [string, GraphDef][] = [
    ['overlay', def('overlay', { x: ['hours'], y: ['gpa', 'sleep'] })],
    [
      'bubble',
      def('bubble', {
        x: ['hours'],
        y: ['gpa'],
        size: ['stress'],
        group: ['faculty'],
      }),
    ],
    ['mosaic', def('mosaic', { x: ['faculty'], y: ['gender'] })],
    ['ridgeline', def('ridgeline', { value: ['gpa'], group: ['faculty'] })],
    [
      'radar',
      def('radar', {
        vars: ['hours', 'sleep', 'stress', 'gpa'],
        group: ['gender'],
      }),
    ],
    ['lollipop', def('lollipop', { x: ['faculty'], value: ['gpa'] }, { func: 'mean' })],
    ['waterfall', def('waterfall', { x: ['year'], value: ['hours'] })],
    ['forest estimates', def('forest', { label: ['id'], est: ['gpa'], lo: ['gpa'], hi: ['gpa'] }, {}, 'estimates')],
    ['forest means', def('forest', { value: ['gpa'], x: ['faculty'] }, {}, 'means')],
    ['treemap', def('treemap', { x: ['faculty'], group: ['gender'] })],
    ['blandaltman', def('blandaltman', { a: ['hours'], b: ['sleep'] })],
    ['forecast', def('forecast', { value: ['gpa'] }, { method: 'holt', horizon: 10 })],
  ];
  it.each(cases)('%s builds from the sample', (_name, d) => {
    const r = ok(d, sample);
    expect(r.chart.type).toBeTruthy();
    expect(JSON.stringify(r.chart)).not.toContain('NaN');
  });
  it('panels work for the new plain charts', () => {
    const d = def('bubble', {
      x: ['hours'],
      y: ['gpa'],
      size: ['stress'],
      panel: ['gender'],
    });
    expect(chartOf(d, sample).type).toBe('panels');
  });
});
