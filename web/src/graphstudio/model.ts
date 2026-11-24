/*
 * Graph Studio model: which chart kinds exist, their variants, variable slots and options.
 * Everything the UI shows (gallery, slots, options tab) is derived from this data, so adding a
 * chart kind later means adding an entry to KINDS (and a branch in compute.ts).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Cell, Variable } from '../engine/types';
import type { GraphDef, GraphKind } from '../charts/studioTypes';
import { GROUP_ORDER4, KINDS4, MARGINALS_OPTION } from './kinds4';

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
  /** category slots: most distinct values the variable may have (panel by); absent = any number */
  maxDistinct?: number;
  /** where the slot sits on the chart canvas (SPSS style): on the axis it belongs to. Absent = slot list only. */
  place?: SlotPlace;
}

/** Canvas positions: axes, legend-like roles (colour, size, cluster) and panel rows/columns. */
export type SlotPlace = 'x' | 'y' | 'y2' | 'z' | 'legend' | 'size' | 'panelCols' | 'panelRows' | 'detail';

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
  /** false when the kind cannot be split into panels (default: it can) */
  panels?: (def: GraphDef) => boolean;
}

export const FUNCS = ['count', 'pct', 'mean', 'median', 'sum', 'min', 'max', 'sd'] as const;
export type Func = (typeof FUNCS)[number];

/** Summary functions that need a variable to summarise. */
export const needsVariable = (f: unknown) => f !== 'count' && f !== 'pct';

const fn = (id: Func): Choice => ({
  value: id,
  label: `graphstudio.func.${id}`,
});
const ALL_FUNCS: Choice[] = FUNCS.map(fn);
/** Summaries of a numeric variable (no count/percent). */
const VALUE_FUNCS: Choice[] = (['mean', 'median', 'sum', 'min', 'max', 'sd'] as Func[]).map(fn);
/** Summaries of the 3D bars: the 2D bar's, without the standard deviation. */
const BAR3D_FUNCS: Choice[] = (['count', 'pct', 'mean', 'median', 'sum', 'min', 'max'] as Func[]).map(fn);
export const SURFACE_GRID_MIN = 10;
export const SURFACE_GRID_MAX = 60;
export const SURFACE_GRID_DEFAULT = 25;
const ADDITIVE_FUNCS: Choice[] = (['count', 'pct', 'sum'] as Func[]).map(fn);

const opt = (def: GraphDef, id: string): unknown => def.options[id];

const INTERVAL: Choice[] = [
  { value: 'none', label: 'graphstudio.interval.none' },
  { value: 'ci', label: 'graphstudio.interval.ci' },
  { value: 'se', label: 'graphstudio.interval.se' },
  { value: 'sd', label: 'graphstudio.interval.sd' },
];

const intervalOptions = (when?: (def: GraphDef) => boolean, withNone = true): OptionDef[] => [
  {
    id: 'interval',
    type: 'select',
    label: 'graphstudio.opt.interval',
    choices: withNone ? INTERVAL : INTERVAL.slice(1),
    when,
  },
  {
    id: 'level',
    type: 'number',
    label: 'graphstudio.opt.level',
    min: 50,
    max: 99.9,
    step: 1,
    when: (d) => (when ? when(d) : true) && opt(d, 'interval') === 'ci',
  },
  {
    id: 'mult',
    type: 'number',
    label: 'graphstudio.opt.mult',
    min: 0.5,
    max: 5,
    step: 0.5,
    when: (d) => (when ? when(d) : true) && (opt(d, 'interval') === 'se' || opt(d, 'interval') === 'sd'),
  },
];

const BIN_RULES: Choice[] = [
  { value: 'fd', label: 'graphstudio.binRule.fd' },
  { value: 'sturges', label: 'graphstudio.binRule.sturges' },
  { value: 'count', label: 'graphstudio.binRule.count' },
  { value: 'width', label: 'graphstudio.binRule.width' },
];

const binOptions = (): OptionDef[] => [
  {
    id: 'binRule',
    type: 'select',
    label: 'graphstudio.opt.binRule',
    choices: BIN_RULES,
  },
  {
    id: 'bins',
    type: 'number',
    label: 'graphstudio.opt.bins',
    min: 2,
    max: 200,
    step: 1,
    when: (d) => opt(d, 'binRule') === 'count',
  },
  {
    id: 'binWidth',
    type: 'number',
    label: 'graphstudio.opt.binWidth',
    min: 0,
    step: 1,
    when: (d) => opt(d, 'binRule') === 'width',
  },
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

const catX = (min = 1) =>
  slot('x', 'graphstudio.slot.category', 'category', {
    min,
    hint: 'graphstudio.slotHint.category',
  });
const groupSlot = (min: number, label = 'graphstudio.slot.group') => slot('group', label, 'category', { min, hint: 'graphstudio.slotHint.group' });
const valueSlot = (min: number, label = 'graphstudio.slot.value') => slot('value', label, 'numeric', { min, hint: 'graphstudio.slotHint.value' });

/** Space the categories in proportion to their numeric value (years, ages); the category variable must be numeric. */
const NUMERIC_AXIS: OptionDef = {
  id: 'numericAxis',
  type: 'bool',
  label: 'graphstudio.opt.numericAxis',
};

/** Merging of numeric category values into intervals (options shown when the mode is on). */
const MERGE_OPTIONS: OptionDef[] = [
  {
    id: 'mergeMode',
    type: 'select',
    label: 'graphstudio.opt.mergeMode',
    choices: ['none', 'width', 'count'].map((value) => ({
      value,
      label: `graphstudio.merge.${value}`,
    })),
  },
  {
    id: 'mergeWidth',
    type: 'number',
    label: 'graphstudio.opt.mergeWidth',
    min: 0,
    step: 1,
    when: (d) => opt(d, 'mergeMode') === 'width',
  },
  {
    id: 'mergeCount',
    type: 'number',
    label: 'graphstudio.opt.mergeCount',
    min: 1,
    step: 1,
    when: (d) => opt(d, 'mergeMode') === 'count',
  },
];
const MERGE_DEFAULTS = { mergeMode: 'none', mergeWidth: 2, mergeCount: 100 };

const DISTS: Choice[] = ['normal', 'exponential', 'uniform', 'lognormal'].map((value) => ({ value, label: `graphstudio.dist.${value}` }));

const v = (id: string, label: string, icon: string): VariantDef => ({
  id,
  label: `graphstudio.variant.${label}`,
  icon,
});

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
      {
        id: 'func',
        type: 'select',
        label: 'graphstudio.opt.func',
        choices: (d) => (grouped(d, 'stacked', 'stacked100') ? ADDITIVE_FUNCS : ALL_FUNCS),
      },
      ...intervalOptions((d) => opt(d, 'func') === 'mean' && !grouped(d, 'stacked', 'stacked100')),
      {
        id: 'sort',
        type: 'select',
        label: 'graphstudio.opt.sort',
        choices: SORT,
      },
      {
        id: 'horizontal',
        type: 'bool',
        label: 'graphstudio.opt.horizontal',
        when: (d) => d.variant !== 'horizontal',
      },
    ],
    defaults: {
      func: 'count',
      interval: 'none',
      level: 95,
      mult: 2,
      sort: 'category',
      horizontal: false,
    },
  },
  line: {
    kind: 'line',
    group: 'line',
    label: 'graphstudio.kind.line',
    icon: 'show_chart',
    variants: [v('simple', 'lineSimple', 'show_chart'), v('multiple', 'lineMultiple', 'multiline_chart')],
    slots: (d) => summarySlots(d, catX(), groupSlot(d.variant === 'multiple' ? 1 : 0, 'graphstudio.slot.lines')),
    options: [
      {
        id: 'func',
        type: 'select',
        label: 'graphstudio.opt.func',
        choices: ALL_FUNCS,
      },
      ...intervalOptions((d) => opt(d, 'func') === 'mean'),
      { id: 'markers', type: 'bool', label: 'graphstudio.opt.markers' },
      NUMERIC_AXIS,
    ],
    defaults: {
      func: 'mean',
      interval: 'none',
      level: 95,
      mult: 2,
      markers: true,
      numericAxis: false,
    },
  },
  area: {
    kind: 'area',
    group: 'area',
    label: 'graphstudio.kind.area',
    icon: 'area_chart',
    variants: [v('simple', 'areaSimple', 'area_chart'), v('stacked', 'areaStacked', 'stacked_line_chart'), v('stacked100', 'areaStacked100', 'percent')],
    slots: (d) => summarySlots(d, catX(), groupSlot(grouped(d, 'stacked', 'stacked100') ? 1 : 0, 'graphstudio.slot.areas')),
    options: [
      {
        id: 'func',
        type: 'select',
        label: 'graphstudio.opt.func',
        choices: (d) => (grouped(d, 'stacked', 'stacked100') ? ADDITIVE_FUNCS : ALL_FUNCS),
      },
      NUMERIC_AXIS,
    ],
    defaults: { func: 'count', numericAxis: false },
  },
  pie: {
    kind: 'pie',
    group: 'pie',
    label: 'graphstudio.kind.pie',
    icon: 'pie_chart',
    variants: [v('simple', 'pie', 'pie_chart')],
    slots: (d) => [catX(), ...(needsVariable(opt(d, 'func')) ? [valueSlot(1)] : [])],
    options: [
      {
        id: 'func',
        type: 'select',
        label: 'graphstudio.opt.func',
        choices: ADDITIVE_FUNCS,
      },
      {
        id: 'sort',
        type: 'select',
        label: 'graphstudio.opt.sort',
        choices: SORT,
      },
    ],
    defaults: { func: 'count', sort: 'category' },
  },
  histogram: {
    kind: 'histogram',
    group: 'histogram',
    label: 'graphstudio.kind.histogram',
    icon: 'equalizer',
    variants: [v('simple', 'histSimple', 'equalizer'), v('stacked', 'histStacked', 'stacked_bar_chart'), v('polygon', 'polygon', 'ssid_chart')],
    slots: (d) => [
      slot('value', 'graphstudio.slot.measure', 'numeric', {
        min: 1,
        hint: 'graphstudio.slotHint.measure',
      }),
      ...(d.variant === 'simple' ? [] : [groupSlot(d.variant === 'stacked' ? 1 : 0, 'graphstudio.slot.splitBy')]),
    ],
    options: [
      ...binOptions(),
      {
        id: 'normal',
        type: 'bool',
        label: 'graphstudio.opt.normal',
        when: (d) => d.variant === 'simple',
      },
    ],
    defaults: { binRule: 'fd', bins: 10, binWidth: null, normal: false },
  },
  pyramid: {
    kind: 'pyramid',
    group: 'pyramid',
    label: 'graphstudio.kind.pyramid',
    icon: 'align_horizontal_center',
    variants: [v('simple', 'pyramid', 'align_horizontal_center')],
    slots: () => [
      slot('value', 'graphstudio.slot.age', 'numeric', {
        min: 1,
        hint: 'graphstudio.slotHint.age',
      }),
      groupSlot(1, 'graphstudio.slot.sides'),
    ],
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
    options: [...intervalOptions(undefined, false), NUMERIC_AXIS],
    defaults: { interval: 'ci', level: 95, mult: 2, numericAxis: false },
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
      {
        id: 'fitByGroup',
        type: 'bool',
        label: 'graphstudio.opt.fitByGroup',
        when: (d) => d.options.fit !== 'none' && (d.bind.group?.length ?? 0) > 0,
      },
      {
        id: 'fitCi',
        type: 'bool',
        label: 'graphstudio.opt.fitCi',
        when: (d) => d.options.fit !== 'none',
      },
      {
        id: 'showR2',
        type: 'bool',
        label: 'graphstudio.opt.showR2',
        when: (d) => d.options.fit !== 'none',
      },
      MARGINALS_OPTION,
    ],
    defaults: {
      fit: 'none',
      fitByGroup: false,
      fitCi: false,
      showR2: true,
      marginals: 'none',
    },
  },
  dot: {
    kind: 'dot',
    group: 'scatter',
    label: 'graphstudio.kind.dot',
    icon: 'more_horiz',
    variants: [v('simple', 'dot', 'more_horiz')],
    slots: () => [slot('value', 'graphstudio.slot.measure', 'numeric', { min: 1 }), groupSlot(0, 'graphstudio.slot.colorBy')],
    options: [
      {
        id: 'binWidth',
        type: 'number',
        label: 'graphstudio.opt.binWidth',
        min: 0,
        step: 1,
        auto: true,
      },
    ],
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
    slots: () => [
      slot('vars', 'graphstudio.slot.matrixVars', 'numeric', {
        min: 2,
        max: 8,
        hint: 'graphstudio.slotHint.matrixVars',
      }),
      groupSlot(0, 'graphstudio.slot.colorBy'),
    ],
    options: [],
    defaults: {},
    panels: () => false,
  },
  heatmap: {
    kind: 'heatmap',
    group: 'matrix',
    label: 'graphstudio.kind.heatmap',
    icon: 'grid_on',
    variants: [v('simple', 'heatmap', 'grid_on')],
    slots: () => [slot('x', 'graphstudio.slot.xAxis', 'numeric', { min: 1 }), slot('y', 'graphstudio.slot.yAxis', 'numeric', { min: 1 })],
    options: [
      {
        id: 'xBins',
        type: 'number',
        label: 'graphstudio.opt.xBins',
        min: 2,
        max: 60,
        step: 1,
      },
      {
        id: 'yBins',
        type: 'number',
        label: 'graphstudio.opt.yBins',
        min: 2,
        max: 60,
        step: 1,
      },
    ],
    defaults: { xBins: 20, yBins: 20 },
  },
  highlow: {
    kind: 'highlow',
    group: 'highlow',
    label: 'graphstudio.kind.highlow',
    icon: 'finance_mode',
    variants: [v('hlc', 'hlc', 'finance_mode'), v('range', 'hlRange', 'height'), v('diff', 'hlDiff', 'area_chart')],
    slots: (d) => [
      catX(),
      slot('high', 'graphstudio.slot.high', 'numeric', {
        min: 1,
        hint: 'graphstudio.slotHint.value',
      }),
      slot('low', 'graphstudio.slot.low', 'numeric', {
        min: 1,
        hint: 'graphstudio.slotHint.value',
      }),
      ...(d.variant === 'hlc'
        ? [
            slot('close', 'graphstudio.slot.close', 'numeric', {
              hint: 'graphstudio.slotHint.value',
            }),
          ]
        : []),
    ],
    options: [
      {
        id: 'func',
        type: 'select',
        label: 'graphstudio.opt.func',
        choices: VALUE_FUNCS,
      },
      NUMERIC_AXIS,
    ],
    defaults: { func: 'mean', numericAxis: false },
  },
  dualaxis: {
    kind: 'dualaxis',
    group: 'dualaxis',
    label: 'graphstudio.kind.dualaxis',
    icon: 'swap_vert',
    variants: [v('barline', 'barLine', 'swap_vert'), v('lineline', 'lineLine', 'multiline_chart'), v('barbar', 'barBar', 'bar_chart_4_bars'), v('linebar', 'lineBar', 'stacked_line_chart')],
    slots: () => [
      catX(),
      slot('left', 'graphstudio.slot.left', 'numeric', {
        min: 1,
        hint: 'graphstudio.slotHint.value',
      }),
      slot('right', 'graphstudio.slot.right', 'numeric', {
        min: 1,
        hint: 'graphstudio.slotHint.value',
      }),
    ],
    options: [
      {
        id: 'func',
        type: 'select',
        label: 'graphstudio.opt.func',
        choices: VALUE_FUNCS,
      },
    ],
    defaults: { func: 'mean' },
  },
  qq: {
    kind: 'qq',
    group: 'probplot',
    label: 'graphstudio.kind.qq',
    icon: 'show_chart',
    variants: [v('qq', 'qq', 'show_chart')],
    slots: () => [
      slot('value', 'graphstudio.slot.measure', 'numeric', {
        min: 1,
        hint: 'graphstudio.slotHint.measure',
      }),
    ],
    options: [
      {
        id: 'dist',
        type: 'select',
        label: 'graphstudio.opt.dist',
        choices: DISTS,
      },
    ],
    defaults: { dist: 'normal' },
  },
  pp: {
    kind: 'pp',
    group: 'probplot',
    label: 'graphstudio.kind.pp',
    icon: 'ssid_chart',
    variants: [v('pp', 'pp', 'ssid_chart')],
    slots: () => [
      slot('value', 'graphstudio.slot.measure', 'numeric', {
        min: 1,
        hint: 'graphstudio.slotHint.measure',
      }),
    ],
    options: [
      {
        id: 'dist',
        type: 'select',
        label: 'graphstudio.opt.dist',
        choices: DISTS,
      },
    ],
    defaults: { dist: 'normal' },
  },
  sequence: {
    kind: 'sequence',
    group: 'sequence',
    label: 'graphstudio.kind.sequence',
    icon: 'timeline',
    variants: [v('sequence', 'sequence', 'timeline')],
    slots: () => [
      slot('value', 'graphstudio.slot.seqVars', 'numeric', {
        min: 1,
        max: 8,
        hint: 'graphstudio.slotHint.matrixVars',
      }),
      slot('x', 'graphstudio.slot.seqAxis', 'numeric', {
        hint: 'graphstudio.slotHint.seqAxis',
      }),
    ],
    options: [
      {
        id: 'transform',
        type: 'select',
        label: 'graphstudio.opt.transform',
        choices: ['none', 'diff', 'log'].map((value) => ({
          value,
          label: `graphstudio.transform.${value}`,
        })),
      },
    ],
    defaults: { transform: 'none' },
  },
  control: {
    kind: 'control',
    group: 'sequence',
    label: 'graphstudio.kind.control',
    icon: 'monitoring',
    variants: [v('imr', 'ctlImr', 'monitoring'), v('individuals', 'ctlIndividuals', 'show_chart'), v('movingrange', 'ctlMr', 'vital_signs'), v('xbar', 'ctlXbar', 'query_stats')],
    slots: (d) => [
      slot('value', 'graphstudio.slot.measure', 'numeric', {
        min: 1,
        hint: 'graphstudio.slotHint.measure',
      }),
      ...(d.variant === 'xbar'
        ? [
            slot('subgroup', 'graphstudio.slot.subgroup', 'category', {
              min: 1,
              hint: 'graphstudio.slotHint.subgroup',
            }),
          ]
        : []),
    ],
    options: [
      {
        id: 'limitK',
        type: 'number',
        label: 'graphstudio.opt.limitK',
        min: 1,
        max: 5,
        step: 0.5,
      },
      {
        id: 'sigma',
        type: 'select',
        label: 'graphstudio.opt.sigma',
        choices: ['sd', 'range'].map((value) => ({
          value,
          label: `graphstudio.sigma.${value}`,
        })),
        when: (d) => d.variant === 'xbar',
      },
    ],
    defaults: { limitK: 3, sigma: 'sd' },
    // the I-MR variant already is a pair of charts
    panels: (d) => d.variant !== 'imr',
  },
  violin: {
    kind: 'violin',
    group: 'boxplot',
    label: 'graphstudio.kind.violin',
    icon: 'ecg_heart',
    variants: [v('simple', 'violin', 'ecg_heart')],
    slots: () => [valueSlot(1, 'graphstudio.slot.measure'), catX(0)],
    options: [
      {
        id: 'bwFactor',
        type: 'number',
        label: 'graphstudio.opt.bwFactor',
        min: 0.2,
        max: 3,
        step: 0.1,
      },
    ],
    defaults: { bwFactor: 1 },
  },
  density: {
    kind: 'density',
    group: 'histogram',
    label: 'graphstudio.kind.density',
    icon: 'density_small',
    variants: [v('simple', 'density', 'density_small')],
    slots: () => [
      slot('value', 'graphstudio.slot.measure', 'numeric', {
        min: 1,
        hint: 'graphstudio.slotHint.measure',
      }),
      groupSlot(0, 'graphstudio.slot.splitBy'),
    ],
    options: [
      { id: 'fill', type: 'bool', label: 'graphstudio.opt.fill' },
      {
        id: 'bwFactor',
        type: 'number',
        label: 'graphstudio.opt.bwFactor',
        min: 0.2,
        max: 3,
        step: 0.1,
      },
    ],
    defaults: { fill: true, bwFactor: 1 },
  },
  scatter3d: {
    kind: 'scatter3d',
    group: '3d',
    label: 'graphstudio.kind.scatter3d',
    icon: 'view_in_ar',
    variants: [v('simple', 'scatter3d', 'view_in_ar')],
    slots: () => [
      slot('x', 'graphstudio.slot.xAxis', 'numeric', { min: 1 }),
      slot('y', 'graphstudio.slot.yAxis', 'numeric', { min: 1 }),
      slot('z', 'graphstudio.slot.zAxis', 'numeric', { min: 1 }),
      groupSlot(0, 'graphstudio.slot.colorBy'),
    ],
    options: [
      {
        id: 'fit',
        type: 'select',
        label: 'graphstudio.opt.fit3d',
        choices: ['none', 'plane'].map((value) => ({
          value,
          label: `graphstudio.fit.${value}`,
        })),
      },
    ],
    defaults: { fit: 'none' },
    panels: () => false,
  },
  bar3d: {
    kind: 'bar3d',
    group: '3d',
    label: 'graphstudio.kind.bar3d',
    icon: 'deployed_code',
    variants: [v('simple', 'bar3d', 'deployed_code')],
    slots: (d) => [
      catX(),
      slot('y', 'graphstudio.slot.yCategory', 'category', {
        min: 1,
        hint: 'graphstudio.slotHint.category',
      }),
      ...(needsVariable(opt(d, 'func')) ? [valueSlot(1)] : []),
    ],
    options: [
      {
        id: 'func',
        type: 'select',
        label: 'graphstudio.opt.func',
        choices: BAR3D_FUNCS,
      },
    ],
    defaults: { func: 'count' },
    panels: () => false,
  },
  surface3d: {
    kind: 'surface3d',
    group: '3d',
    label: 'graphstudio.kind.surface3d',
    icon: 'landscape',
    variants: [v('simple', 'surface3d', 'landscape')],
    slots: () => [
      slot('x', 'graphstudio.slot.xAxis', 'numeric', { min: 1 }),
      slot('y', 'graphstudio.slot.yAxis', 'numeric', { min: 1 }),
      slot('z', 'graphstudio.slot.zSurface', 'numeric', {
        hint: 'graphstudio.slotHint.zSurface',
      }),
    ],
    options: [
      {
        id: 'grid',
        type: 'number',
        label: 'graphstudio.opt.grid',
        min: SURFACE_GRID_MIN,
        max: SURFACE_GRID_MAX,
        step: 1,
      },
    ],
    defaults: { grid: SURFACE_GRID_DEFAULT },
    panels: () => false,
  },
  ...KINDS4,
};

/** Gallery group order (ids of KindModel.group). */
export const GROUP_ORDER = ['bar', 'line', 'area', 'pie', 'histogram', 'pyramid', 'scatter', 'highlow', 'boxplot', 'errorbar', 'dualaxis', 'probplot', 'sequence', 'pareto', 'matrix', ...GROUP_ORDER4, '3d'];

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
  .flatMap((m) =>
    m!.variants.map((vr) => ({
      id: `${m!.kind}:${vr.id}`,
      group: m!.group,
      kind: m!.kind,
      variant: vr.id,
      label: m!.variants.length > 1 ? vr.label : m!.label,
      icon: vr.icon,
      family: m!.label,
    })),
  )
  .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));

export const modelOf = (kind: GraphKind): KindModel | undefined => KINDS[kind];

export function defaultDef(kind: GraphKind, variant?: string): GraphDef {
  const m = KINDS[kind]!;
  return {
    v: 1,
    kind,
    variant: variant ?? m.variants[0].id,
    bind: {},
    options: {
      ...m.defaults,
      ...(MERGE_KINDS.includes(kind) ? MERGE_DEFAULTS : {}),
      ...PANEL_DEFAULTS,
    },
  };
}

/** Switches the variant, dropping bindings of slots that no longer exist and fixing option values. */
export function withVariant(def: GraphDef, variant: string): GraphDef {
  const next: GraphDef = {
    ...def,
    variant,
    bind: { ...def.bind },
    options: { ...def.options },
  };
  const ids = new Set(slotsOf(next).map((s) => s.id));
  for (const k of Object.keys(next.bind)) if (!ids.has(k)) delete next.bind[k];
  normalizeOptions(next);
  return next;
}

/** Keeps option values valid after a change (e.g. a stacked bar cannot show a mean). */
export function normalizeOptions(def: GraphDef): GraphDef {
  if (!KINDS[def.kind]) return def;
  for (const o of optionsOf(def)) {
    if (o.type !== 'select') continue;
    const choices = typeof o.choices === 'function' ? o.choices(def) : (o.choices ?? []);
    if (choices.length && !choices.some((c) => c.value === def.options[o.id])) def.options[o.id] = choices[0].value;
  }
  return def;
}

/** The 'panel by' slot every kind (but the scatterplot matrix) offers. */
const panelSlot = (): SlotDef =>
  slot('panel', 'graphstudio.slot.panel', 'category', {
    maxDistinct: MAX_PANELS,
    hint: 'graphstudio.slotHint.panel',
    icon: 'grid_view',
  });

/**
 * Canvas place of each slot id, per kind (the same for every variant). Kinds that are not listed
 * (or slot ids that are not) fall back to the rules in `defaultPlace`.
 */
const PLACES: Partial<Record<GraphKind, Record<string, SlotPlace>>> = {
  bar: { x: 'x', value: 'y', group: 'legend' },
  line: { x: 'x', value: 'y', group: 'legend' },
  area: { x: 'x', value: 'y', group: 'legend' },
  pie: { x: 'legend', value: 'size' },
  histogram: { value: 'x', group: 'legend' },
  pyramid: { value: 'y', group: 'legend' },
  boxplot: { value: 'y', x: 'x', group: 'legend' },
  errorbar: { x: 'x', value: 'y', group: 'legend' },
  scatter: { x: 'x', y: 'y', group: 'legend' },
  dot: { value: 'x', group: 'legend' },
  pareto: { x: 'x', value: 'y' },
  scattermatrix: { vars: 'detail', group: 'legend' },
  heatmap: { x: 'x', y: 'y' },
  highlow: { x: 'x', high: 'y', low: 'y', close: 'y' },
  dualaxis: { x: 'x', left: 'y', right: 'y2' },
  qq: { value: 'y' },
  pp: { value: 'y' },
  sequence: { value: 'y', x: 'x' },
  control: { value: 'y', subgroup: 'x' },
  violin: { value: 'y', x: 'x' },
  density: { value: 'x', group: 'legend' },
  scatter3d: { x: 'x', y: 'y', z: 'z', group: 'legend' },
  bar3d: { x: 'x', y: 'y', value: 'z' },
  surface3d: { x: 'x', y: 'y', z: 'z' },
};

/** Place for a slot id nobody listed: panel by, colour/group roles and everything else. */
const defaultPlace = (id: string): SlotPlace => (id === 'panel' ? 'panelCols' : id === 'group' ? 'legend' : 'detail');

/** True when the chart is drawn with the value along x and the categories along y. */
export const isHorizontal = (def: GraphDef): boolean => def.variant === 'horizontal' || def.options.horizontal === true;

/** Where a raw slot of DEF sits on the canvas: its table place, with x and y swapped for horizontal charts. */
function resolvePlace(def: GraphDef, s: SlotDef): SlotPlace {
  const p = s.place ?? PLACES[def.kind]?.[s.id] ?? defaultPlace(s.id);
  if (isHorizontal(def)) return p === 'x' ? 'y' : p === 'y' ? 'x' : p;
  return p;
}

export function slotsOf(def: GraphDef): SlotDef[] {
  const m = KINDS[def.kind];
  if (!m) return [];
  return [...m.slots(def), ...(m.panels && !m.panels(def) ? [] : [panelSlot()])].map((s) => ({ ...s, place: resolvePlace(def, s) }));
}

/** Summary functions the kind offers for DEF (empty when it has no summary option). */
export function funcChoices(def: GraphDef): Choice[] {
  const f = optionsOf(def).find((o) => o.id === 'func');
  return f ? (typeof f.choices === 'function' ? f.choices(def) : (f.choices ?? [])) : [];
}

/**
 * Summary kinds (bar, line, area, pie, 3D bars) have no value slot while the summary is a count or
 * percent. The canvas still shows the value zone: this is the slot a variable dropped there fills.
 */
export function summaryValueSlot(def: GraphDef): SlotDef | null {
  const m = KINDS[def.kind];
  if (!m || slotsOf(def).some((s) => s.id === 'value')) return null;
  if (!funcChoices(def).some((c) => c.value === 'count')) return null;
  const s = valueSlot(0);
  return {
    ...s,
    place: resolvePlace(def, { ...s, place: PLACES[def.kind]?.value ?? 'y' }),
  };
}

const hasPanel = (d: GraphDef) => (d.bind.panel?.length ?? 0) > 0;

/** Options shared by every kind that can be split into panels. */
const PANEL_OPTIONS: OptionDef[] = [
  {
    id: 'sharedAxes',
    type: 'bool',
    label: 'graphstudio.opt.sharedAxes',
    when: hasPanel,
  },
  {
    id: 'panelCols',
    type: 'number',
    label: 'graphstudio.opt.panelCols',
    min: 1,
    max: 6,
    step: 1,
    auto: true,
    when: hasPanel,
  },
];
const PANEL_DEFAULTS: Record<string, unknown> = {
  sharedAxes: true,
  panelCols: null,
};

/** The options of a definition: those of its kind plus the panel options. */
export function optionsOf(def: GraphDef): OptionDef[] {
  const m = KINDS[def.kind];
  if (!m) return [];
  return [...m.options, ...(MERGE_KINDS.includes(def.kind) ? MERGE_OPTIONS : []), ...(slotsOf(def).some((s) => s.id === 'panel') ? PANEL_OPTIONS : [])];
}

/** The 3D kinds: no reference lines, annotations or panels; the view (rotation) is stored with the chart. */
export const KINDS_3D: GraphKind[] = ['scatter3d', 'bar3d', 'surface3d'];
export const is3d = (kind: GraphKind): boolean => KINDS_3D.includes(kind);

/** Required slots that are still empty, in order. */
export function missingSlots(def: GraphDef): SlotDef[] {
  return slotsOf(def).filter((s) => (def.bind[s.id]?.length ?? 0) < s.min);
}

/** Above this many categories the studio warns that the chart may be crowded. */
export const CATEGORY_WARN = 50;
/** Above this many categories the chart is crowded: a warning marks the slot and the preview. */
export const CATEGORY_CROWDED = 500;
/** Kinds whose category (x) slot can merge numeric values into intervals. */
export const MERGE_KINDS: GraphKind[] = ['bar', 'line', 'area', 'errorbar', 'highlow', 'dualaxis', 'pareto', 'boxplot', 'bar3d', 'lollipop'];
/** Most levels of a panel variable. */
export const MAX_PANELS = 12;

export interface Rejection {
  /** i18n key under graphstudio.reject */
  key: string;
  args?: Record<string, unknown>;
}

/** Why variable V cannot go into slot S, or null when it is accepted. Any variable may be a category. */
export function rejection(s: SlotDef, variable: Variable, distinct: number): Rejection | null {
  if (s.accepts === 'numeric') return variable.type === 'string' ? { key: 'graphstudio.reject.text', args: { name: variable.name } } : null;
  if (s.maxDistinct && distinct > s.maxDistinct)
    return {
      key: 'graphstudio.reject.manyLevels',
      args: { name: variable.name, max: s.maxDistinct },
    };
  return null;
}

/** Variable names bound anywhere in the definition. */
export const boundNames = (def: GraphDef): string[] => [...new Set(Object.values(def.bind).flat())];

/** Cheap distinct count of a column, capped just above CATEGORY_CROWDED. */
export function distinctCapped(col: Cell[] | undefined, cap = CATEGORY_CROWDED + 1): number {
  const s = new Set<string | number>();
  for (const x of col ?? []) {
    if (x === null || x === '') continue;
    s.add(x);
    if (s.size >= cap) break;
  }
  return s.size;
}
