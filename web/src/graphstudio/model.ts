/*
 * Graph Studio model: which chart kinds exist, their variants, variable slots and options.
 * Everything the UI shows (gallery, slots, options tab) is derived from this data, so adding a
 * chart kind later means adding an entry to KINDS (and a branch in compute.ts).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Cell, Variable } from '../engine/types';
import type { GraphDef, GraphKind } from '../charts/studioTypes';

/** What a slot takes: a grouping variable (few distinct values) or a numeric variable. */
export type Accept = 'category' | 'numeric';

export interface SlotDef {
  id: string;
  /** i18n key of the slot title */
  label: string;
  /** i18n key of a one-line explanation */
  hint?: string;
  accepts: Accept;
  /** maximum number of variables */
  max: number;
  /** minimum number of variables needed to draw (0 = optional) */
  min: number;
  icon: string;
}

export interface Choice {
  value: string;
  /** i18n key */
  label: string;
}

export interface OptionDef {
  id: string;
  type: 'select' | 'number' | 'bool';
  /** i18n key */
  label: string;
  help?: string;
  choices?: Choice[] | ((def: GraphDef) => Choice[]);
  min?: number;
  max?: number;
  step?: number;
  /** number fields: an empty field means automatic */
  auto?: boolean;
  when?: (def: GraphDef) => boolean;
}

export interface VariantDef {
  id: string;
  /** i18n key */
  label: string;
  icon: string;
}

export interface KindModel {
  kind: GraphKind;
  /** gallery group id (i18n graphstudio.group.<id>) */
  group: string;
  /** i18n key of the chart name */
  label: string;
  icon: string;
  variants: VariantDef[];
  slots: (def: GraphDef) => SlotDef[];
  options: OptionDef[];
  defaults: Record<string, unknown>;
}

export const FUNCS = ['count', 'pct', 'mean', 'median', 'sum', 'min', 'max', 'sd'] as const;
export type Func = (typeof FUNCS)[number];

/** Summary functions that need a variable to summarise. */
export const needsVariable = (f: unknown) => f !== 'count' && f !== 'pct';

const fn = (id: Func): Choice => ({ value: id, label: `graphstudio.func.${id}` });
const ALL_FUNCS: Choice[] = FUNCS.map(fn);
const ADDITIVE_FUNCS: Choice[] = (['count', 'pct', 'sum'] as Func[]).map(fn);

const opt = (def: GraphDef, id: string): unknown => def.options[id];

const INTERVAL: Choice[] = [
  { value: 'none', label: 'graphstudio.interval.none' },
  { value: 'ci', label: 'graphstudio.interval.ci' },
  { value: 'se', label: 'graphstudio.interval.se' },
  { value: 'sd', label: 'graphstudio.interval.sd' },
];

const intervalOptions = (when?: (def: GraphDef) => boolean, withNone = true): OptionDef[] => [
  { id: 'interval', type: 'select', label: 'graphstudio.opt.interval', choices: withNone ? INTERVAL : INTERVAL.slice(1), when },
  { id: 'level', type: 'number', label: 'graphstudio.opt.level', min: 50, max: 99.9, step: 1, when: (d) => (when ? when(d) : true) && opt(d, 'interval') === 'ci' },
  { id: 'mult', type: 'number', label: 'graphstudio.opt.mult', min: 0.5, max: 5, step: 0.5, when: (d) => (when ? when(d) : true) && (opt(d, 'interval') === 'se' || opt(d, 'interval') === 'sd') },
];

const BIN_RULES: Choice[] = [
  { value: 'fd', label: 'graphstudio.binRule.fd' },
  { value: 'sturges', label: 'graphstudio.binRule.sturges' },
  { value: 'count', label: 'graphstudio.binRule.count' },
  { value: 'width', label: 'graphstudio.binRule.width' },
];

const binOptions = (): OptionDef[] => [
  { id: 'binRule', type: 'select', label: 'graphstudio.opt.binRule', choices: BIN_RULES },
  { id: 'bins', type: 'number', label: 'graphstudio.opt.bins', min: 2, max: 200, step: 1, when: (d) => opt(d, 'binRule') === 'count' },
  { id: 'binWidth', type: 'number', label: 'graphstudio.opt.binWidth', min: 0, step: 1, when: (d) => opt(d, 'binRule') === 'width' },
];

const SORT: Choice[] = [
  { value: 'category', label: 'graphstudio.sort.category' },
  { value: 'asc', label: 'graphstudio.sort.asc' },
  { value: 'desc', label: 'graphstudio.sort.desc' },
];

const slot = (id: string, label: string, accepts: Accept, o: Partial<SlotDef> & { min?: number } = {}): SlotDef => ({
  id,
  label,
  accepts,
  max: 1,
  min: 0,
  icon: accepts === 'numeric' ? 'straighten' : 'category',
  ...o,
});

const catX = (min = 1) => slot('x', 'graphstudio.slot.category', 'category', { min, hint: 'graphstudio.slotHint.category' });
const groupSlot = (min: number, label = 'graphstudio.slot.group') => slot('group', label, 'category', { min, hint: 'graphstudio.slotHint.group' });
const valueSlot = (min: number, label = 'graphstudio.slot.value') => slot('value', label, 'numeric', { min, hint: 'graphstudio.slotHint.value' });

const v = (id: string, label: string, icon: string): VariantDef => ({ id, label: `graphstudio.variant.${label}`, icon });

/** True when the variant needs a grouping variable. */
const grouped = (def: GraphDef, ...variants: string[]) => (def.variant ? variants.includes(def.variant) : false);

/** A summary slot set for count/pct vs variable functions. */
const summarySlots = (def: GraphDef, x: SlotDef, group: SlotDef): SlotDef[] => [x, group, ...(needsVariable(opt(def, 'func')) ? [valueSlot(1)] : [])];

export const KINDS: Partial<Record<GraphKind, KindModel>> = {
  bar: {
    kind: 'bar',
    group: 'bar',
    label: 'graphstudio.kind.bar',
    icon: 'bar_chart',
    variants: [
      v('simple', 'simple', 'bar_chart'),
      v('clustered', 'clustered', 'bar_chart_4_bars'),
      v('stacked', 'stacked', 'stacked_bar_chart'),
      v('stacked100', 'stacked100', 'percent'),
      v('horizontal', 'horizontal', 'align_horizontal_left'),
    ],
    slots: (d) => summarySlots(d, catX(), groupSlot(grouped(d, 'clustered', 'stacked', 'stacked100') ? 1 : 0, d.variant === 'clustered' ? 'graphstudio.slot.cluster' : d.variant === 'simple' || d.variant === 'horizontal' ? 'graphstudio.slot.group' : 'graphstudio.slot.stack')),
    options: [
      { id: 'func', type: 'select', label: 'graphstudio.opt.func', choices: (d) => (grouped(d, 'stacked', 'stacked100') ? ADDITIVE_FUNCS : ALL_FUNCS) },
      ...intervalOptions((d) => opt(d, 'func') === 'mean' && !grouped(d, 'stacked', 'stacked100')),
      { id: 'sort', type: 'select', label: 'graphstudio.opt.sort', choices: SORT },
      { id: 'horizontal', type: 'bool', label: 'graphstudio.opt.horizontal', when: (d) => d.variant !== 'horizontal' },
    ],
    defaults: { func: 'count', interval: 'none', level: 95, mult: 2, sort: 'category', horizontal: false },
  },
  line: {
    kind: 'line',
    group: 'line',
    label: 'graphstudio.kind.line',
    icon: 'show_chart',
    variants: [v('simple', 'lineSimple', 'show_chart'), v('multiple', 'lineMultiple', 'multiline_chart')],
    slots: (d) => summarySlots(d, catX(), groupSlot(d.variant === 'multiple' ? 1 : 0, 'graphstudio.slot.lines')),
    options: [
      { id: 'func', type: 'select', label: 'graphstudio.opt.func', choices: ALL_FUNCS },
      ...intervalOptions((d) => opt(d, 'func') === 'mean'),
      { id: 'markers', type: 'bool', label: 'graphstudio.opt.markers' },
    ],
    defaults: { func: 'mean', interval: 'none', level: 95, mult: 2, markers: true },
  },
  area: {
    kind: 'area',
    group: 'area',
    label: 'graphstudio.kind.area',
    icon: 'area_chart',
    variants: [v('simple', 'areaSimple', 'area_chart'), v('stacked', 'areaStacked', 'stacked_line_chart'), v('stacked100', 'areaStacked100', 'percent')],
    slots: (d) => summarySlots(d, catX(), groupSlot(grouped(d, 'stacked', 'stacked100') ? 1 : 0, 'graphstudio.slot.areas')),
    options: [{ id: 'func', type: 'select', label: 'graphstudio.opt.func', choices: (d) => (grouped(d, 'stacked', 'stacked100') ? ADDITIVE_FUNCS : ALL_FUNCS) }],
    defaults: { func: 'count' },
  },
  pie: {
    kind: 'pie',
    group: 'pie',
    label: 'graphstudio.kind.pie',
    icon: 'pie_chart',
    variants: [v('simple', 'pie', 'pie_chart')],
    slots: (d) => [catX(), ...(needsVariable(opt(d, 'func')) ? [valueSlot(1)] : [])],
    options: [
      { id: 'func', type: 'select', label: 'graphstudio.opt.func', choices: ADDITIVE_FUNCS },
      { id: 'sort', type: 'select', label: 'graphstudio.opt.sort', choices: SORT },
    ],
    defaults: { func: 'count', sort: 'category' },
  },
  histogram: {
    kind: 'histogram',
    group: 'histogram',
    label: 'graphstudio.kind.histogram',
    icon: 'equalizer',
    variants: [v('simple', 'histSimple', 'equalizer'), v('stacked', 'histStacked', 'stacked_bar_chart'), v('polygon', 'polygon', 'ssid_chart')],
    slots: (d) => [slot('value', 'graphstudio.slot.measure', 'numeric', { min: 1, hint: 'graphstudio.slotHint.measure' }), ...(d.variant === 'simple' ? [] : [groupSlot(d.variant === 'stacked' ? 1 : 0, 'graphstudio.slot.splitBy')])],
    options: [...binOptions(), { id: 'normal', type: 'bool', label: 'graphstudio.opt.normal', when: (d) => d.variant === 'simple' }],
    defaults: { binRule: 'fd', bins: 10, binWidth: null, normal: false },
  },
  pyramid: {
    kind: 'pyramid',
    group: 'pyramid',
    label: 'graphstudio.kind.pyramid',
    icon: 'align_horizontal_center',
    variants: [v('simple', 'pyramid', 'align_horizontal_center')],
    slots: () => [slot('value', 'graphstudio.slot.age', 'numeric', { min: 1, hint: 'graphstudio.slotHint.age' }), groupSlot(1, 'graphstudio.slot.sides')],
    options: [...binOptions(), { id: 'swap', type: 'bool', label: 'graphstudio.opt.swap' }],
    defaults: { binRule: 'width', bins: 10, binWidth: 5, swap: false },
  },
  boxplot: {
    kind: 'boxplot',
    group: 'boxplot',
    label: 'graphstudio.kind.boxplot',
    icon: 'candlestick_chart',
    variants: [v('simple', 'boxSimple', 'candlestick_chart'), v('clustered', 'boxClustered', 'stacked_bar_chart')],
    slots: (d) => [valueSlot(1, 'graphstudio.slot.measure'), catX(d.variant === 'clustered' ? 1 : 0), ...(d.variant === 'clustered' ? [groupSlot(1, 'graphstudio.slot.cluster')] : [])],
    options: [{ id: 'outliers', type: 'bool', label: 'graphstudio.opt.outliers' }],
    defaults: { outliers: true },
  },
  errorbar: {
    kind: 'errorbar',
    group: 'errorbar',
    label: 'graphstudio.kind.errorbar',
    icon: 'vital_signs',
    variants: [v('simple', 'errSimple', 'vital_signs'), v('clustered', 'errClustered', 'bar_chart_4_bars')],
    slots: (d) => [catX(), ...(d.variant === 'clustered' ? [groupSlot(1, 'graphstudio.slot.cluster')] : []), valueSlot(1, 'graphstudio.slot.measure')],
    options: intervalOptions(undefined, false),
    defaults: { interval: 'ci', level: 95, mult: 2 },
  },
  scatter: {
    kind: 'scatter',
    group: 'scatter',
    label: 'graphstudio.kind.scatter',
    icon: 'scatter_plot',
    variants: [v('simple', 'scatterSimple', 'scatter_plot'), v('grouped', 'scatterGrouped', 'bubble_chart')],
    slots: (d) => [slot('x', 'graphstudio.slot.xAxis', 'numeric', { min: 1 }), slot('y', 'graphstudio.slot.yAxis', 'numeric', { min: 1 }), ...(d.variant === 'grouped' ? [groupSlot(1, 'graphstudio.slot.colorBy')] : [])],
    options: [
      {
        id: 'fit',
        type: 'select',
        label: 'graphstudio.opt.fit',
        choices: ['none', 'linear', 'quadratic', 'cubic', 'loess'].map((value) => ({ value, label: `graphstudio.fit.${value}` })),
      },
      { id: 'fitByGroup', type: 'bool', label: 'graphstudio.opt.fitByGroup', when: (d) => d.options.fit !== 'none' && (d.bind.group?.length ?? 0) > 0 },
      { id: 'showR2', type: 'bool', label: 'graphstudio.opt.showR2', when: (d) => d.options.fit !== 'none' },
    ],
    defaults: { fit: 'none', fitByGroup: false, showR2: true },
  },
  dot: {
    kind: 'dot',
    group: 'scatter',
    label: 'graphstudio.kind.dot',
    icon: 'more_horiz',
    variants: [v('simple', 'dot', 'more_horiz')],
    slots: () => [slot('value', 'graphstudio.slot.measure', 'numeric', { min: 1 }), groupSlot(0, 'graphstudio.slot.colorBy')],
    options: [{ id: 'binWidth', type: 'number', label: 'graphstudio.opt.binWidth', min: 0, step: 1, auto: true }],
    defaults: { binWidth: null },
  },
  pareto: {
    kind: 'pareto',
    group: 'pareto',
    label: 'graphstudio.kind.pareto',
    icon: 'waterfall_chart',
    variants: [v('simple', 'pareto', 'waterfall_chart')],
    slots: () => [catX(), valueSlot(0, 'graphstudio.slot.sumOf')],
    options: [],
    defaults: {},
  },
  scattermatrix: {
    kind: 'scattermatrix',
    group: 'matrix',
    label: 'graphstudio.kind.scattermatrix',
    icon: 'grid_view',
    variants: [v('simple', 'matrix', 'grid_view')],
    slots: () => [slot('vars', 'graphstudio.slot.matrixVars', 'numeric', { min: 2, max: 8, hint: 'graphstudio.slotHint.matrixVars' }), groupSlot(0, 'graphstudio.slot.colorBy')],
    options: [],
    defaults: {},
  },
  heatmap: {
    kind: 'heatmap',
    group: 'matrix',
    label: 'graphstudio.kind.heatmap',
    icon: 'grid_on',
    variants: [v('simple', 'heatmap', 'grid_on')],
    slots: () => [slot('x', 'graphstudio.slot.xAxis', 'numeric', { min: 1 }), slot('y', 'graphstudio.slot.yAxis', 'numeric', { min: 1 })],
    options: [
      { id: 'xBins', type: 'number', label: 'graphstudio.opt.xBins', min: 2, max: 60, step: 1 },
      { id: 'yBins', type: 'number', label: 'graphstudio.opt.yBins', min: 2, max: 60, step: 1 },
    ],
    defaults: { xBins: 20, yBins: 20 },
  },
};

/** Gallery group order (ids of KindModel.group). */
export const GROUP_ORDER = ['bar', 'line', 'area', 'pie', 'histogram', 'pyramid', 'scatter', 'boxplot', 'errorbar', 'pareto', 'matrix'];

export interface GalleryEntry {
  id: string;
  group: string;
  kind: GraphKind;
  variant: string;
  /** i18n key */
  label: string;
  icon: string;
  /** i18n key of the chart family name, searched along with the label */
  family: string;
}

/** One tile per kind and variant, data driven. */
export const GALLERY: GalleryEntry[] = Object.values(KINDS)
  .flatMap((m) => m!.variants.map((vr) => ({ id: `${m!.kind}:${vr.id}`, group: m!.group, kind: m!.kind, variant: vr.id, label: m!.variants.length > 1 ? vr.label : m!.label, icon: vr.icon, family: m!.label })))
  .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));

export const modelOf = (kind: GraphKind): KindModel | undefined => KINDS[kind];

export function defaultDef(kind: GraphKind, variant?: string): GraphDef {
  const m = KINDS[kind]!;
  return { v: 1, kind, variant: variant ?? m.variants[0].id, bind: {}, options: { ...m.defaults } };
}

/** Switches the variant, dropping bindings of slots that no longer exist and fixing option values. */
export function withVariant(def: GraphDef, variant: string): GraphDef {
  const next: GraphDef = { ...def, variant, bind: { ...def.bind }, options: { ...def.options } };
  const ids = new Set(slotsOf(next).map((s) => s.id));
  for (const k of Object.keys(next.bind)) if (!ids.has(k)) delete next.bind[k];
  normalizeOptions(next);
  return next;
}

/** Keeps option values valid after a change (e.g. a stacked bar cannot show a mean). */
export function normalizeOptions(def: GraphDef): GraphDef {
  const m = KINDS[def.kind];
  if (!m) return def;
  for (const o of m.options) {
    if (o.type !== 'select') continue;
    const choices = typeof o.choices === 'function' ? o.choices(def) : (o.choices ?? []);
    if (choices.length && !choices.some((c) => c.value === def.options[o.id])) def.options[o.id] = choices[0].value;
  }
  return def;
}

export function slotsOf(def: GraphDef): SlotDef[] {
  return KINDS[def.kind]?.slots(def) ?? [];
}

/** Required slots that are still empty, in order. */
export function missingSlots(def: GraphDef): SlotDef[] {
  return slotsOf(def).filter((s) => (def.bind[s.id]?.length ?? 0) < s.min);
}

/** Largest number of distinct values a scale variable may have to serve as a category. */
export const MAX_CATEGORIES = 30;

export interface Rejection {
  /** i18n key under graphstudio.reject */
  key: string;
  args?: Record<string, unknown>;
}

/** Why variable V cannot go into slot S, or null when it is accepted. */
export function rejection(s: SlotDef, variable: Variable, distinct: number): Rejection | null {
  if (s.accepts === 'numeric') return variable.type === 'string' ? { key: 'graphstudio.reject.text', args: { name: variable.name } } : null;
  if (variable.type === 'numeric' && variable.measure === 'scale' && distinct > MAX_CATEGORIES) {
    return { key: 'graphstudio.reject.manyValues', args: { name: variable.name, count: distinct, max: MAX_CATEGORIES } };
  }
  return null;
}

/** Variable names bound anywhere in the definition. */
export const boundNames = (def: GraphDef): string[] => [...new Set(Object.values(def.bind).flat())];

/** Cheap distinct count of a column, capped just above MAX_CATEGORIES. */
export function distinctCapped(col: Cell[] | undefined, cap = MAX_CATEGORIES + 1): number {
  const s = new Set<string | number>();
  for (const x of col ?? []) {
    if (x === null || x === '') continue;
    s.add(x);
    if (s.size >= cap) break;
  }
  return s.size;
}
