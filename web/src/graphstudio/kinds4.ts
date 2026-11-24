/*
 * Graph Studio phase 4: model entries of the added chart kinds (overlay scatter, bubble, mosaic, ridgeline,
 * radar, lollipop, waterfall, forest, treemap, Bland-Altman, forecast) and the scatter marginals option.
 * model.ts spreads KINDS4 into KINDS; this file only imports types from model.ts, so there is no import cycle
 * at load time. The computation is in compute4.ts.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { GraphDef, GraphKind } from '../charts/studioTypes';
import type { Accept, Choice, KindModel, OptionDef, SlotDef, VariantDef } from './model';

const opt = (def: GraphDef, id: string): unknown => def.options[id];
const fn = (id: string): Choice => ({
  value: id,
  label: `graphstudio.func.${id}`,
});
const choices = (prefix: string, values: string[]): Choice[] => values.map((value) => ({ value, label: `${prefix}.${value}` }));
const v = (id: string, label: string, icon: string): VariantDef => ({
  id,
  label: `graphstudio.variant.${label}`,
  icon,
});

const slot = (id: string, label: string, accepts: Accept, o: Partial<SlotDef> = {}): SlotDef => ({
  id,
  label,
  accepts,
  max: 1,
  min: 0,
  icon: accepts === 'numeric' ? 'straighten' : 'category',
  ...o,
});

const VALUE_FUNCS = ['mean', 'median', 'sum', 'min', 'max', 'sd'].map(fn);
const BAR_FUNCS = ['count', 'pct', 'mean', 'median', 'sum', 'min', 'max', 'sd'].map(fn);
const FIT_CHOICES = choices('graphstudio.fit', ['none', 'linear', 'quadratic', 'cubic', 'loess']);
const SORT = choices('graphstudio.sort', ['category', 'asc', 'desc']);
const needsVariable = (f: unknown) => f !== 'count' && f !== 'pct';

/** Scatter option: small marginal plots on top and right of the scatterplot (added to the scatter kind in model.ts). */
export const MARGINALS_OPTION: OptionDef = {
  id: 'marginals',
  type: 'select',
  label: 'graphstudio.opt.marginals',
  choices: choices('graphstudio.marginals', ['none', 'histogram', 'density', 'box']),
};

/** Gallery groups added by this phase, in gallery order (the other kinds join existing groups). */
export const GROUP_ORDER4 = ['mosaic', 'treemap', 'radar', 'waterfall', 'forest'];

/** Kinds without panels: their chart is not a plain x/y plot the panels could share axes of. */
const noPanels = () => false;

export const KINDS4: Partial<Record<GraphKind, KindModel>> = {
  overlay: {
    kind: 'overlay',
    group: 'scatter',
    label: 'graphstudio.kind.overlay',
    icon: 'blur_on',
    variants: [v('simple', 'overlay', 'blur_on')],
    slots: () => [
      slot('x', 'graphstudio.slot.xAxis', 'numeric', { min: 1, place: 'x' }),
      slot('y', 'graphstudio.slot.overlayY', 'numeric', {
        min: 2,
        max: 8,
        place: 'y',
        hint: 'graphstudio.slotHint.overlayY',
      }),
    ],
    options: [
      {
        id: 'fit',
        type: 'select',
        label: 'graphstudio.opt.fit',
        choices: FIT_CHOICES,
      },
      {
        id: 'fitCi',
        type: 'bool',
        label: 'graphstudio.opt.fitCi',
        when: (d) => opt(d, 'fit') !== 'none',
      },
      {
        id: 'showR2',
        type: 'bool',
        label: 'graphstudio.opt.showR2',
        when: (d) => opt(d, 'fit') !== 'none',
      },
    ],
    defaults: { fit: 'none', fitCi: false, showR2: true },
  },
  bubble: {
    kind: 'bubble',
    group: 'scatter',
    label: 'graphstudio.kind.bubble',
    icon: 'bubble_chart',
    variants: [v('simple', 'bubble', 'bubble_chart')],
    slots: () => [
      slot('x', 'graphstudio.slot.xAxis', 'numeric', { min: 1, place: 'x' }),
      slot('y', 'graphstudio.slot.yAxis', 'numeric', { min: 1, place: 'y' }),
      slot('size', 'graphstudio.slot.size', 'numeric', {
        min: 1,
        place: 'size',
        hint: 'graphstudio.slotHint.size',
        icon: 'bubble_chart',
      }),
      slot('group', 'graphstudio.slot.colorBy', 'category', {
        place: 'legend',
        hint: 'graphstudio.slotHint.group',
      }),
      slot('label', 'graphstudio.slot.labelBy', 'category', {
        place: 'detail',
        hint: 'graphstudio.slotHint.label',
        icon: 'label',
      }),
    ],
    options: [],
    defaults: {},
  },
  mosaic: {
    kind: 'mosaic',
    group: 'mosaic',
    label: 'graphstudio.kind.mosaic',
    icon: 'view_quilt',
    variants: [v('simple', 'mosaic', 'view_quilt')],
    slots: () => [
      slot('x', 'graphstudio.slot.mosaicX', 'category', {
        min: 1,
        place: 'x',
        hint: 'graphstudio.slotHint.category',
      }),
      slot('y', 'graphstudio.slot.mosaicY', 'category', {
        min: 1,
        place: 'y',
        hint: 'graphstudio.slotHint.category',
      }),
    ],
    options: [{ id: 'shade', type: 'bool', label: 'graphstudio.opt.shade' }],
    defaults: { shade: true },
    panels: noPanels,
  },
  ridgeline: {
    kind: 'ridgeline',
    group: 'histogram',
    label: 'graphstudio.kind.ridgeline',
    icon: 'tsunami',
    variants: [v('simple', 'ridgeline', 'tsunami')],
    slots: () => [
      slot('value', 'graphstudio.slot.measure', 'numeric', {
        min: 1,
        place: 'x',
        hint: 'graphstudio.slotHint.measure',
      }),
      slot('group', 'graphstudio.slot.ridgeBy', 'category', {
        min: 1,
        place: 'y',
        hint: 'graphstudio.slotHint.group',
      }),
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
  radar: {
    kind: 'radar',
    group: 'radar',
    label: 'graphstudio.kind.radar',
    icon: 'radar',
    variants: [v('simple', 'radar', 'radar')],
    slots: () => [
      slot('vars', 'graphstudio.slot.radarVars', 'numeric', {
        min: 3,
        max: 12,
        place: 'detail',
        hint: 'graphstudio.slotHint.radarVars',
      }),
      slot('group', 'graphstudio.slot.radarGroup', 'category', {
        place: 'legend',
        hint: 'graphstudio.slotHint.group',
      }),
    ],
    options: [
      {
        id: 'func',
        type: 'select',
        label: 'graphstudio.opt.func',
        choices: VALUE_FUNCS,
      },
      { id: 'standardise', type: 'bool', label: 'graphstudio.opt.standardise' },
    ],
    defaults: { func: 'mean', standardise: true },
    panels: noPanels,
  },
  lollipop: {
    kind: 'lollipop',
    group: 'bar',
    label: 'graphstudio.kind.lollipop',
    icon: 'pin_drop',
    variants: [v('simple', 'lolSimple', 'pin_drop'), v('clustered', 'lolClustered', 'bar_chart_4_bars'), v('horizontal', 'lolHorizontal', 'align_horizontal_left')],
    // the model swaps x and y for the horizontal variant (resolvePlace), so places are given for the upright chart
    slots: (d) => [
      slot('x', 'graphstudio.slot.category', 'category', {
        min: 1,
        place: 'x',
        hint: 'graphstudio.slotHint.category',
      }),
      slot('group', d.variant === 'clustered' ? 'graphstudio.slot.cluster' : 'graphstudio.slot.group', 'category', {
        min: d.variant === 'clustered' ? 1 : 0,
        place: 'legend',
        hint: 'graphstudio.slotHint.group',
      }),
      ...(needsVariable(opt(d, 'func'))
        ? [
            slot('value', 'graphstudio.slot.value', 'numeric', {
              min: 1,
              place: 'y',
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
        choices: BAR_FUNCS,
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
  waterfall: {
    kind: 'waterfall',
    group: 'waterfall',
    label: 'graphstudio.kind.waterfall',
    icon: 'stairs',
    variants: [v('simple', 'waterfall', 'stairs')],
    slots: () => [
      slot('x', 'graphstudio.slot.category', 'category', {
        min: 1,
        place: 'x',
        hint: 'graphstudio.slotHint.category',
      }),
      slot('value', 'graphstudio.slot.sumOfValue', 'numeric', {
        min: 1,
        place: 'y',
        hint: 'graphstudio.slotHint.value',
      }),
    ],
    options: [{ id: 'lastTotal', type: 'bool', label: 'graphstudio.opt.lastTotal' }],
    defaults: { lastTotal: false },
    panels: noPanels,
  },
  forest: {
    kind: 'forest',
    group: 'forest',
    label: 'graphstudio.kind.forest',
    icon: 'linear_scale',
    variants: [v('estimates', 'forestEst', 'linear_scale'), v('means', 'forestMeans', 'vital_signs')],
    slots: (d) =>
      d.variant === 'means'
        ? [
            slot('value', 'graphstudio.slot.measure', 'numeric', {
              min: 1,
              place: 'x',
              hint: 'graphstudio.slotHint.measure',
            }),
            slot('x', 'graphstudio.slot.category', 'category', {
              min: 1,
              place: 'y',
              hint: 'graphstudio.slotHint.category',
            }),
          ]
        : [
            slot('label', 'graphstudio.slot.rowLabel', 'category', {
              min: 1,
              place: 'y',
              hint: 'graphstudio.slotHint.rowLabel',
            }),
            slot('est', 'graphstudio.slot.estimate', 'numeric', {
              min: 1,
              place: 'x',
            }),
            slot('lo', 'graphstudio.slot.lower', 'numeric', {
              min: 1,
              place: 'x',
            }),
            slot('hi', 'graphstudio.slot.upper', 'numeric', {
              min: 1,
              place: 'x',
            }),
            slot('group', 'graphstudio.slot.colorBy', 'category', {
              place: 'legend',
              hint: 'graphstudio.slotHint.group',
            }),
          ],
    options: [
      {
        id: 'level',
        type: 'number',
        label: 'graphstudio.opt.level',
        min: 50,
        max: 99.9,
        step: 1,
        when: (d) => d.variant === 'means',
      },
      {
        id: 'overall',
        type: 'bool',
        label: 'graphstudio.opt.overall',
        when: (d) => d.variant === 'means',
      },
      { id: 'log', type: 'bool', label: 'graphstudio.opt.logAxis' },
      {
        id: 'refValue',
        type: 'number',
        label: 'graphstudio.opt.refValue',
        step: 0.5,
        auto: true,
      },
    ],
    defaults: { level: 95, overall: true, log: false, refValue: null },
    panels: noPanels,
  },
  treemap: {
    kind: 'treemap',
    group: 'treemap',
    label: 'graphstudio.kind.treemap',
    icon: 'dashboard',
    variants: [v('simple', 'treemap', 'dashboard')],
    slots: (d) => [
      slot('x', 'graphstudio.slot.tileBy', 'category', {
        min: 1,
        place: 'detail',
        hint: 'graphstudio.slotHint.category',
      }),
      slot('group', 'graphstudio.slot.colorBy', 'category', {
        place: 'legend',
        hint: 'graphstudio.slotHint.group',
      }),
      ...(opt(d, 'func') === 'sum'
        ? [
            slot('value', 'graphstudio.slot.value', 'numeric', {
              min: 1,
              place: 'size',
              hint: 'graphstudio.slotHint.value',
            }),
          ]
        : []),
    ],
    options: [
      {
        id: 'func',
        type: 'select',
        label: 'graphstudio.opt.size',
        choices: ['count', 'sum'].map(fn),
      },
    ],
    defaults: { func: 'count' },
    panels: noPanels,
  },
  blandaltman: {
    kind: 'blandaltman',
    group: 'scatter',
    label: 'graphstudio.kind.blandaltman',
    icon: 'compare_arrows',
    variants: [v('simple', 'blandaltman', 'compare_arrows')],
    slots: () => [
      slot('a', 'graphstudio.slot.methodA', 'numeric', {
        min: 1,
        place: 'detail',
        hint: 'graphstudio.slotHint.method',
      }),
      slot('b', 'graphstudio.slot.methodB', 'numeric', {
        min: 1,
        place: 'detail',
        hint: 'graphstudio.slotHint.method',
      }),
    ],
    options: [
      { id: 'percent', type: 'bool', label: 'graphstudio.opt.percentDiff' },
      { id: 'trend', type: 'bool', label: 'graphstudio.opt.baTrend' },
    ],
    defaults: { percent: false, trend: false },
  },
  forecast: {
    kind: 'forecast',
    group: 'sequence',
    label: 'graphstudio.kind.forecast',
    icon: 'insights',
    variants: [v('simple', 'forecast', 'insights')],
    slots: () => [
      slot('value', 'graphstudio.slot.measure', 'numeric', {
        min: 1,
        place: 'y',
        hint: 'graphstudio.slotHint.measure',
      }),
      slot('x', 'graphstudio.slot.seqAxis', 'numeric', {
        place: 'x',
        hint: 'graphstudio.slotHint.seqAxis',
      }),
    ],
    options: [
      {
        id: 'method',
        type: 'select',
        label: 'graphstudio.opt.method',
        choices: choices('graphstudio.forecast', ['ma', 'trend', 'ses', 'holt']),
      },
      {
        id: 'window',
        type: 'number',
        label: 'graphstudio.opt.window',
        min: 2,
        max: 50,
        step: 1,
        when: (d) => opt(d, 'method') === 'ma',
      },
      {
        id: 'alpha',
        type: 'number',
        label: 'graphstudio.opt.alpha',
        min: 0.01,
        max: 1,
        step: 0.05,
        auto: true,
        when: (d) => opt(d, 'method') === 'ses' || opt(d, 'method') === 'holt',
      },
      {
        id: 'beta',
        type: 'number',
        label: 'graphstudio.opt.beta',
        min: 0.01,
        max: 1,
        step: 0.05,
        auto: true,
        when: (d) => opt(d, 'method') === 'holt',
      },
      {
        id: 'horizon',
        type: 'number',
        label: 'graphstudio.opt.horizon',
        min: 0,
        max: 200,
        step: 1,
      },
      {
        id: 'band',
        type: 'bool',
        label: 'graphstudio.opt.predBand',
        when: (d) => Number(opt(d, 'horizon')) > 0,
      },
    ],
    defaults: {
      method: 'trend',
      window: 3,
      alpha: null,
      beta: null,
      horizon: 5,
      band: true,
    },
  },
};
