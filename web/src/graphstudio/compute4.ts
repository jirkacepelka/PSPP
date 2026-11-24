/*
 * Graph Studio phase 4 computation: overlay scatter, bubble, mosaic, ridgeline, radar, lollipop, waterfall,
 * forest, treemap, Bland-Altman and forecast. Called from compute.ts (buildOne) with prepared data.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { GraphDef, RefLine } from '../charts/studioTypes';
import { valueText, varTitle } from '../ext/data';
import { tInv } from '../ext/dist';
import { barChart, byTitle, cat, densityChart, funcLabel, intervalHalf, isDateVar, num, optNum, optStr, secondsToDays, summarize, weightNote, type Col, type Obs, type Prepared, type Summary, type Tf } from './compute';

type Obj = Record<string, unknown>;

/** Most bubbles drawn; beyond it every n-th case is kept (deterministic). */
export const BUBBLE_MAX_CASES = 1000;
/** Most rows of a forest plot built from cases. */
export const FOREST_MAX_ROWS = 200;
/** Multiplier of the Bland-Altman limits of agreement: mean difference +- 1.96 SD of the differences. */
export const BA_LIMIT = 1.96;

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : 0;
};
/** Four significant digits, for numbers inside labels. */
const sig = (x: number): string => String(Number(x.toPrecision(4)));

/* ------------------------------------------------------------------ scatter family */

/** Several y variables against one x: one scatter point set per variable, coloured by variable. */
function overlayChart(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Obj {
  weightNote(p, t, notes);
  const X = p.cols.x[0];
  const Ys = p.cols.y;
  const fit = optStr(def, 'fit', 'none');
  const names = Ys.map((c) => varTitle(c.v));
  return {
    type: 'scatter',
    title: t('graphstudio.chart.vs', { y: names.join(', '), x: varTitle(X.v) }),
    xlabel: varTitle(X.v),
    ylabel: t('graphstudio.chart.values'),
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
    byvar: t('graphstudio.legend.variables'),
    // the group of a point is the name of its y variable
    points: Ys.flatMap((Y) => p.rows.map((r) => [num(X, r), num(Y, r), varTitle(Y.v)])),
    fit,
    fitByGroup: fit !== 'none',
    showR2: fit !== 'none' && def.options.showR2 !== false,
    fitCi: fit !== 'none' && def.options.fitCi === true,
  };
}

function bubbleChart(p: Prepared, t: Tf, notes: string[]): Obj | null {
  weightNote(p, t, notes);
  const [X, Y, S] = [p.cols.x[0], p.cols.y[0], p.cols.size[0]];
  const g = p.cols.group?.[0] ? cat(p, p.cols.group[0]) : null;
  const lab = p.cols.label?.[0];
  // a bubble area cannot be negative or zero: such cases are left out
  const keep = p.rows.map((_, k) => k).filter((k) => num(S, p.rows[k]) > 0);
  if (keep.length < p.rows.length)
    notes.push(
      t('graphstudio.note.bubbleDropped', {
        count: p.rows.length - keep.length,
        name: varTitle(S.v),
      }),
    );
  const stride = Math.max(1, Math.ceil(keep.length / BUBBLE_MAX_CASES));
  const picked = keep.filter((_, i) => i % stride === 0).slice(0, BUBBLE_MAX_CASES);
  if (picked.length < keep.length)
    notes.push(
      t('graphstudio.note.sampled', {
        used: picked.length,
        total: keep.length,
      }),
    );
  if (!picked.length) return null;
  return {
    type: 'bubble',
    title: t('graphstudio.chart.bubble', {
      y: varTitle(Y.v),
      x: varTitle(X.v),
      s: varTitle(S.v),
    }),
    xlabel: varTitle(X.v),
    ylabel: varTitle(Y.v),
    sizeLabel: varTitle(S.v),
    byvar: g ? varTitle(p.cols.group[0].v) : null,
    points: picked.map((k) => {
      const r = p.rows[k];
      return {
        x: num(X, r),
        y: num(Y, r),
        size: num(S, r),
        group: g ? g.labels[g.idx[k]] : null,
        ...(lab ? { label: valueText(lab.v, lab.col[r]) } : {}),
      };
    }),
  };
}

/** Bland-Altman: x = mean of two measurements, y = their difference (or percent difference). */
function blandAltmanChart(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Obj | null {
  weightNote(p, t, notes);
  const [A, B] = [p.cols.a[0], p.cols.b[0]];
  const percent = def.options.percent === true;
  const pts: [number, number][] = [];
  let zero = 0;
  for (const r of p.rows) {
    const a = num(A, r);
    const b = num(B, r);
    const m = (a + b) / 2;
    if (percent && m === 0) {
      zero++;
      continue;
    }
    pts.push([m, percent ? (100 * (a - b)) / m : a - b]);
  }
  if (zero) notes.push(t('graphstudio.note.baZeroMean', { count: zero }));
  if (pts.length < 3) return null;
  const diffs = pts.map((q) => q[1]);
  const d = mean(diffs);
  const s = sd(diffs);
  const unit = percent ? ' %' : '';
  // limits of agreement: d +- 1.96 s (s uses n - 1); they are ordinary, editable reference lines
  const line = (value: number, label: string, dash: boolean): RefLine => ({
    axis: 'y',
    value,
    label,
    dash,
  });
  const refLines: RefLine[] = [
    line(d, t('graphstudio.chart.baMean', { v: `${sig(d)}${unit}` }), false),
    line(d + BA_LIMIT * s, t('graphstudio.chart.baUpper', { v: `${sig(d + BA_LIMIT * s)}${unit}` }), true),
    line(d - BA_LIMIT * s, t('graphstudio.chart.baLower', { v: `${sig(d - BA_LIMIT * s)}${unit}` }), true),
  ];
  const a = varTitle(A.v);
  const b = varTitle(B.v);
  return {
    type: 'scatter',
    title: t('graphstudio.chart.blandAltman', { a, b }),
    xlabel: t('graphstudio.chart.baAverage', { a, b }),
    ylabel: percent ? t('graphstudio.chart.baDiffPct', { a, b }) : t('graphstudio.chart.baDiff', { a, b }),
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
    byvar: null,
    points: pts,
    fit: def.options.trend === true ? 'linear' : 'none',
    fitByGroup: false,
    showR2: false,
    fitCi: false,
    // appearance defaults the studio merges under the user's own style (see studioChart)
    style: { refLines },
  };
}

/* ------------------------------------------------------------------ distributions and profiles */

function ridgelineChart(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Obj | null {
  const chart = densityChart(def, p, t, notes);
  if (!chart) return null;
  const x = varTitle(p.cols.value[0].v);
  const g = varTitle(p.cols.group[0].v);
  return {
    ...chart,
    title: t('graphstudio.chart.ridgeBy', { x, g }),
    ylabel: g,
    layout: 'ridge',
  };
}

function mosaicChart(def: GraphDef, p: Prepared, t: Tf): Obj {
  const x = cat(p, p.cols.x[0]);
  const y = cat(p, p.cols.y[0]);
  // counts[yi][xi], weighted
  const counts = y.cells.map(() => x.cells.map(() => 0));
  p.rows.forEach((r, k) => {
    if (x.idx[k] >= 0 && y.idx[k] >= 0) counts[y.idx[k]][x.idx[k]] += p.w[r];
  });
  const [xt, yt] = [varTitle(p.cols.x[0].v), varTitle(p.cols.y[0].v)];
  return {
    type: 'mosaic',
    title: t('graphstudio.chart.by', { y: yt, x: xt }),
    xlabel: xt,
    ylabel: yt,
    xs: x.labels,
    ys: y.labels,
    counts,
    shade: def.options.shade !== false,
  };
}

/**
 * Radar: one axis per variable, one polygon per group level (or one for all cases). With "standardise"
 * every axis is rescaled to 0-100 over the range of that variable in the data: 100 * (v - min) / (max - min)
 * (50 when the variable is constant), so variables in different units become comparable.
 */
function radarChart(def: GraphDef, p: Prepared, t: Tf): Obj {
  const func = optStr(def, 'func', 'mean') as Summary;
  const vars = p.cols.vars;
  const g = p.cols.group?.[0] ? cat(p, p.cols.group[0]) : null;
  const standardise = def.options.standardise !== false;
  const range = vars.map((c) => {
    const xs = p.rows.map((r) => num(c, r));
    return [Math.min(...xs), Math.max(...xs)] as const;
  });
  const summary = (rows: number[]): (number | null)[] =>
    vars.map((c, i) => {
      const obs: Obs[] = rows.map((r) => ({ y: num(c, r), w: p.w[r] }));
      const val = summarize(func, obs);
      if (val === null || !standardise) return val;
      const [lo, hi] = range[i];
      return hi > lo ? (100 * (val - lo)) / (hi - lo) : 50;
    });
  const series = g
    ? g.cells.map((_, gi) => ({
        name: g.labels[gi],
        values: summary(p.rows.filter((__, k) => g.idx[k] === gi)),
      }))
    : [{ name: funcLabel(t, func), values: summary(p.rows) }];
  const f = funcLabel(t, func);
  return {
    type: 'radar',
    title: g ? t('graphstudio.chart.radarBy', { f, g: varTitle(p.cols.group[0].v) }) : t('graphstudio.chart.radar', { f }),
    axes: vars.map((c) => varTitle(c.v)),
    series,
    min: standardise ? 0 : null,
    max: standardise ? 100 : null,
  };
}

/* ------------------------------------------------------------------ waterfall, forest, treemap */

function waterfallChart(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Obj {
  const X = p.cols.x[0];
  const V = p.cols.value[0];
  const x = cat(p, X);
  // weighted sum of the value per category, in category order
  const sums = x.cells.map(() => ({ sum: 0, n: 0 }));
  p.rows.forEach((r, k) => {
    const i = x.idx[k];
    if (i < 0) return;
    sums[i].sum += num(V, r) * p.w[r];
    sums[i].n++;
  });
  const used = x.labels.map((label, i) => ({ label, ...sums[i] })).filter((s) => s.n > 0);
  const steps: { label: string; value: number; total?: boolean }[] = used.map((s) => ({ label: s.label, value: s.sum }));
  if (def.options.lastTotal === true && steps.length >= 2) {
    // the last category is a total: the bar shows the running sum of the steps before it
    const last = steps.length - 1;
    const running = steps.slice(0, last).reduce((s, q) => s + q.value, 0);
    if (Math.abs(running - steps[last].value) > 1e-9 * Math.max(1, Math.abs(running)))
      notes.push(
        t('graphstudio.note.wfTotal', {
          label: steps[last].label,
          value: sig(steps[last].value),
          sum: sig(running),
        }),
      );
    steps[last] = { label: steps[last].label, value: running, total: true };
  }
  const xt = varTitle(X.v);
  return {
    type: 'waterfall',
    title: byTitle(t, funcLabel(t, 'sum', V), xt),
    xlabel: xt,
    ylabel: funcLabel(t, 'sum', V),
    steps,
  };
}

function forestChart(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Obj | null {
  const log = def.options.log === true;
  const level = optNum(def, 'level', 95);
  type Row = {
    label: string;
    est: number;
    lo: number;
    hi: number;
    group?: string | null;
  };
  let rows: Row[] = [];
  let xlabel: string;
  let title: string;
  let autoRef = log ? 1 : 0;
  if (def.variant === 'means') {
    // mean and t based confidence interval of the value per category (weights honoured as frequencies)
    const V = p.cols.value[0];
    const x = cat(p, p.cols.x[0]);
    const buckets = x.cells.map(() => [] as Obs[]);
    p.rows.forEach((r, k) => {
      if (x.idx[k] >= 0) buckets[x.idx[k]].push({ y: num(V, r), w: p.w[r] });
    });
    const add = (label: string, obs: Obs[]) => {
      const m = summarize('mean', obs);
      const half = intervalHalf('ci', level, 0, obs);
      if (m === null || half === null) return false;
      rows.push({ label, est: m, lo: m - half, hi: m + half });
      return true;
    };
    let few = 0;
    buckets.forEach((obs, i) => {
      if (obs.length && !add(x.labels[i], obs)) few++;
    });
    if (few) notes.push(t('graphstudio.note.forestFew', { count: few }));
    const all = p.rows.map((r) => ({ y: num(V, r), w: p.w[r] }));
    if (def.options.overall !== false && rows.length > 1) add(t('graphstudio.chart.overall'), all);
    // the default reference of means is the overall mean (the null effect of "no group differs from the rest")
    const om = summarize('mean', all);
    if (!log && om !== null) autoRef = om;
    const v = varTitle(V.v);
    xlabel = t('graphstudio.chart.meanCi', { v, level });
    title = t('graphstudio.chart.forestMeans', {
      v,
      x: varTitle(p.cols.x[0].v),
      level,
    });
  } else {
    weightNote(p, t, notes);
    const [L, E, LO, HI] = [p.cols.label[0], p.cols.est[0], p.cols.lo[0], p.cols.hi[0]];
    const g = p.cols.group?.[0] ? cat(p, p.cols.group[0]) : null;
    let bad = 0;
    p.rows.forEach((r, k) => {
      const [est, lo, hi] = [num(E, r), num(LO, r), num(HI, r)];
      if (lo > hi || est < lo || est > hi || (log && lo <= 0)) {
        bad++;
        return;
      }
      rows.push({
        label: valueText(L.v, L.col[r]),
        est,
        lo,
        hi,
        group: g ? g.labels[g.idx[k]] : null,
      });
    });
    if (bad) notes.push(t(log ? 'graphstudio.note.forestBadLog' : 'graphstudio.note.forestBad', { count: bad }));
    if (rows.length > FOREST_MAX_ROWS) {
      notes.push(
        t('graphstudio.note.forestRows', {
          used: FOREST_MAX_ROWS,
          total: rows.length,
        }),
      );
      rows = rows.slice(0, FOREST_MAX_ROWS);
    }
    xlabel = varTitle(E.v);
    title = t('graphstudio.chart.forest', {
      v: varTitle(E.v),
      l: varTitle(L.v),
    });
  }
  if (log) {
    const before = rows.length;
    rows = rows.filter((r) => r.lo > 0);
    if (rows.length < before) notes.push(t('graphstudio.note.forestBadLog', { count: before - rows.length }));
  }
  if (!rows.length) return null;
  const ref = def.options.refValue;
  return {
    type: 'forest',
    title,
    xlabel,
    refValue: typeof ref === 'number' && Number.isFinite(ref) ? ref : autoRef,
    log,
    rows,
  };
}

function treemapChart(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Obj | null {
  const func = optStr(def, 'func', 'count');
  const V = func === 'sum' ? p.cols.value[0] : undefined;
  const x = cat(p, p.cols.x[0]);
  const g = p.cols.group?.[0] ? cat(p, p.cols.group[0]) : null;
  const ng = g ? g.cells.length : 1;
  const totals = x.cells.map(() => new Array<number>(ng).fill(0));
  const seen = x.cells.map(() => new Array<boolean>(ng).fill(false));
  p.rows.forEach((r, k) => {
    const xi = x.idx[k];
    if (xi < 0) return;
    const gi = g ? g.idx[k] : 0;
    totals[xi][gi] += V ? num(V, r) * p.w[r] : p.w[r];
    seen[xi][gi] = true;
  });
  const tiles: { label: string; value: number; group?: string | null }[] = [];
  let dropped = 0;
  x.cells.forEach((_, xi) => {
    for (let gi = 0; gi < ng; gi++) {
      if (!seen[xi][gi]) continue;
      // an area cannot be zero or negative
      if (!(totals[xi][gi] > 0)) dropped++;
      else
        tiles.push({
          label: x.labels[xi],
          value: totals[xi][gi],
          group: g ? g.labels[gi] : null,
        });
    }
  });
  if (dropped) notes.push(t('graphstudio.note.treemapDropped', { count: dropped }));
  if (!tiles.length) return null;
  const y = funcLabel(t, func, V);
  return {
    type: 'treemap',
    title: byTitle(t, y, varTitle(p.cols.x[0].v), g ? varTitle(p.cols.group[0].v) : undefined),
    tiles,
  };
}

/* ------------------------------------------------------------------ forecast */

export type ForecastMethod = 'ma' | 'trend' | 'ses' | 'holt';

export interface ForecastInput {
  method: ForecastMethod;
  /** moving average window */
  window: number;
  /** smoothing constants; null = fitted by least squares on a grid */
  alpha: number | null;
  beta: number | null;
  /** positions of the observations (ascending) and of the H forecasts */
  xs: number[];
  xf: number[];
}

export interface ForecastOutput {
  /** smoothed level (or trend line) at each observation; null where undefined */
  level: (number | null)[];
  forecast: number[];
  /** 95 % prediction interval per forecast, null when it cannot be estimated */
  lo: (number | null)[];
  hi: (number | null)[];
  alpha?: number;
  beta?: number;
}

/** Grid for fitting a smoothing constant: 0.01 .. 0.99 (simple) and 0.05 .. 0.95 (Holt, two constants). */
const SES_GRID = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);
const HOLT_GRID = Array.from({ length: 19 }, (_, i) => (i + 1) / 20);

/**
 * Forecast of the series Y observed at XS.
 *
 * Notation: n observations y_1..y_n at positions x_1..x_n, h future positions x_{n+k} = x_n + k * step
 * (step = mean spacing of x, 1 for case order). One-step errors e_t = y_t - (prediction of y_t from earlier values).
 *
 * - ma (moving average, window w): level_t = mean(y_{t-w+1..t}); forecast = level_n for all k (flat);
 *   e_t = y_t - level_{t-1}, t > w; sigma^2 = sum(e^2) / (m - 1), m = n - w errors; PI = forecast +- t * sigma.
 * - trend (least squares line): y = a + b x with b = Sxy / Sxx; forecast a + b x0;
 *   sigma^2 = SSE / (n - 2); PI = forecast +- t_{n-2} * sigma * sqrt(1 + 1/n + (x0 - xbar)^2 / Sxx).
 * - ses (simple exponential smoothing): level_1 = y_1, level_t = alpha y_t + (1 - alpha) level_{t-1}, e_t = y_t - level_{t-1};
 *   forecast = level_n; sigma^2 = SSE / (n - 2) (n - 1 errors, 1 constant); variance of step k: sigma^2 (1 + alpha^2 (k - 1)).
 *   alpha minimises SSE = sum e_t^2 over the grid 0.01, 0.02, ..., 0.99.
 * - holt (linear trend smoothing): level_1 = y_1, b_1 = y_2 - y_1; for t >= 2, with p = level_{t-1} + b_{t-1} (also the prediction):
 *   level_t = alpha y_t + (1 - alpha) p, b_t = beta (level_t - level_{t-1}) + (1 - beta) b_{t-1}; forecast = level_n + k b_n;
 *   alpha and beta minimise SSE over the grid 0.05, 0.10, ..., 0.95; sigma^2 = SSE / (n - 3);
 *   variance of step k: sigma^2 (1 + sum_{j=1..k-1} (alpha + alpha beta j)^2) (ETS(A,A,N) with its beta = alpha beta here).
 * The interval uses the t quantile with the degrees of freedom of sigma^2 at 97.5 %; with no degrees of freedom there is no interval.
 */
export function forecastModel(y: number[], inp: ForecastInput): ForecastOutput | null {
  const n = y.length;
  const { method, xs, xf } = inp;
  const band = (centre: number[], sigma2: number, df: number, factor: (k: number) => number): Pick<ForecastOutput, 'lo' | 'hi'> => {
    if (!(df >= 1) || !(sigma2 >= 0) || !Number.isFinite(sigma2)) return { lo: centre.map(() => null), hi: centre.map(() => null) };
    const q = tInv(0.975, df);
    const half = centre.map((_, i) => q * Math.sqrt(sigma2 * factor(i + 1)));
    return {
      lo: centre.map((c, i) => c - half[i]),
      hi: centre.map((c, i) => c + half[i]),
    };
  };
  if (method === 'ma') {
    const w = Math.max(2, Math.round(inp.window));
    if (n < w + 1) return null;
    const level: (number | null)[] = y.map((_, i) => (i + 1 >= w ? mean(y.slice(i + 1 - w, i + 1)) : null));
    let sse = 0;
    let m = 0;
    for (let i = w; i < n; i++) {
      sse += (y[i] - (level[i - 1] as number)) ** 2;
      m++;
    }
    const last = level[n - 1] as number;
    const forecast = xf.map(() => last);
    return {
      level,
      forecast,
      ...band(forecast, m > 1 ? sse / (m - 1) : NaN, m - 1, () => 1),
    };
  }
  if (method === 'trend') {
    if (n < 3) return null;
    const xbar = mean(xs);
    const ybar = mean(y);
    const sxx = xs.reduce((s, x) => s + (x - xbar) ** 2, 0);
    if (!(sxx > 0)) return null;
    const b = xs.reduce((s, x, i) => s + (x - xbar) * (y[i] - ybar), 0) / sxx;
    const a = ybar - b * xbar;
    const level = xs.map((x) => a + b * x);
    const sse = y.reduce((s, v, i) => s + (v - (level[i] as number)) ** 2, 0);
    const forecast = xf.map((x) => a + b * x);
    return {
      level,
      forecast,
      ...band(forecast, sse / (n - 2), n - 2, (k) => 1 + 1 / n + (xf[k - 1] - xbar) ** 2 / sxx),
    };
  }
  if (method === 'ses') {
    if (n < 3) return null;
    const run = (alpha: number) => {
      let l = y[0];
      const lev = [l];
      let sse = 0;
      for (let t = 1; t < n; t++) {
        sse += (y[t] - l) ** 2;
        l = alpha * y[t] + (1 - alpha) * l;
        lev.push(l);
      }
      return { lev, sse };
    };
    let alpha = inp.alpha;
    if (alpha === null) {
      let best = Infinity;
      for (const a of SES_GRID) {
        const s = run(a).sse;
        if (s < best - 1e-12) {
          best = s;
          alpha = a;
        }
      }
    }
    const a = alpha as number;
    const { lev, sse } = run(a);
    const forecast = xf.map(() => lev[n - 1]);
    return {
      level: lev,
      forecast,
      alpha: a,
      ...band(forecast, sse / (n - 2), n - 2, (k) => 1 + a * a * (k - 1)),
    };
  }
  // holt
  if (n < 3) return null;
  const run = (alpha: number, beta: number) => {
    let l = y[0];
    let b = y[1] - y[0];
    const lev = [l];
    let sse = 0;
    for (let t = 1; t < n; t++) {
      const pred = l + b;
      sse += (y[t] - pred) ** 2;
      const ln = alpha * y[t] + (1 - alpha) * pred;
      b = beta * (ln - l) + (1 - beta) * b;
      l = ln;
      lev.push(l);
    }
    return { lev, sse, b };
  };
  let best = Infinity;
  let [fa, fb] = [inp.alpha ?? 0.5, inp.beta ?? 0.5];
  for (const a of inp.alpha === null ? HOLT_GRID : [inp.alpha]) {
    for (const b of inp.beta === null ? HOLT_GRID : [inp.beta]) {
      const s = run(a, b).sse;
      if (s < best - 1e-12) {
        best = s;
        [fa, fb] = [a, b];
      }
    }
  }
  const r = run(fa, fb);
  const forecast = xf.map((_, k) => r.lev[n - 1] + (k + 1) * r.b);
  return {
    level: r.lev,
    forecast,
    alpha: fa,
    beta: fb,
    ...band(forecast, r.sse / (n - 3), n - 3, (k) => {
      let f = 1;
      for (let j = 1; j < k; j++) f += (fa + fa * fb * j) ** 2;
      return f;
    }),
  };
}

function forecastChart(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Obj | null {
  weightNote(p, t, notes);
  const V = p.cols.value[0];
  const xcol: Col | undefined = p.cols.x?.[0];
  const order = [...p.rows].sort((a, b) => (xcol ? num(xcol, a) - num(xcol, b) : a - b));
  const dated = !!xcol && isDateVar(xcol.v);
  const xs = order.map((r) => (xcol ? (dated ? secondsToDays(num(xcol, r)) : num(xcol, r)) : r + 1));
  const y = order.map((r) => num(V, r));
  const n = y.length;
  const method = optStr(def, 'method', 'trend') as ForecastMethod;
  const h = Math.max(0, Math.min(200, Math.round(optNum(def, 'horizon', 5))));
  // spacing of the future positions: the mean spacing of the observations (1 for case order)
  const step = n > 1 && xs[n - 1] > xs[0] ? (xs[n - 1] - xs[0]) / (n - 1) : 1;
  const xf = Array.from({ length: h }, (_, k) => xs[n - 1] + (k + 1) * step);
  const fixed = (id: string): number | null => {
    const v = def.options[id];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1 ? v : null;
  };
  const res = forecastModel(y, {
    method,
    window: optNum(def, 'window', 3),
    alpha: fixed('alpha'),
    beta: fixed('beta'),
    xs,
    xf,
  });
  if (!res) {
    notes.push(t('graphstudio.note.forecastShort'));
    return null;
  }
  const pad = (k: number): null[] => new Array<null>(k).fill(null);
  const name = varTitle(V.v);
  const methodName = t(`graphstudio.forecast.${method}`);
  const series: { name: string; values: (number | null)[]; dash?: boolean }[] = [
    { name, values: [...y, ...pad(h)] },
    { name: methodName, values: [...res.level, ...pad(h)] },
  ];
  const lastLevel = res.level[n - 1];
  if (h > 0 && lastLevel !== null)
    series.push({
      name: t('graphstudio.chart.forecastLine'),
      dash: true,
      values: [...pad(n - 1), lastLevel, ...res.forecast],
    });
  const bands: {
    name: string;
    lo: (number | null)[];
    hi: (number | null)[];
  }[] = [];
  if (h > 0 && lastLevel !== null && def.options.band !== false && res.lo.every((v) => v !== null)) {
    bands.push({
      name: t('graphstudio.chart.predInterval', { level: 95 }),
      lo: [...pad(n - 1), lastLevel, ...res.lo],
      hi: [...pad(n - 1), lastLevel, ...res.hi],
    });
  } else if (h > 0 && def.options.band !== false) notes.push(t('graphstudio.note.forecastNoBand'));
  if (res.alpha !== undefined)
    notes.push(
      t(res.beta !== undefined ? 'graphstudio.note.fittedAlphaBeta' : 'graphstudio.note.fittedAlpha', {
        alpha: sig(res.alpha),
        beta: res.beta !== undefined ? sig(res.beta) : '',
      }),
    );
  return {
    type: 'sequence',
    xFormat: dated ? 'date' : 'number',
    title: t('graphstudio.chart.forecast', { y: name }),
    xlabel: xcol ? varTitle(xcol.v) : t('graphstudio.chart.caseNumber'),
    ylabel: name,
    x: [...xs, ...xf],
    series,
    ...(bands.length ? { bands } : {}),
  };
}

/* ------------------------------------------------------------------ entry point */

/** One chart of a phase 4 kind from prepared data; null when it cannot be drawn. */
export function buildFour(def: GraphDef, p: Prepared, t: Tf, notes: string[]): Obj | null {
  switch (def.kind) {
    case 'overlay':
      return overlayChart(def, p, t, notes);
    case 'bubble':
      return bubbleChart(p, t, notes);
    case 'mosaic':
      return mosaicChart(def, p, t);
    case 'ridgeline':
      return ridgelineChart(def, p, t, notes);
    case 'radar':
      return radarChart(def, p, t);
    case 'lollipop':
      return { ...barChart(def, p, t), lollipop: true };
    case 'waterfall':
      return waterfallChart(def, p, t, notes);
    case 'forest':
      return forestChart(def, p, t, notes);
    case 'treemap':
      return treemapChart(def, p, t, notes);
    case 'blandaltman':
      return blandAltmanChart(def, p, t, notes);
    case 'forecast':
      return forecastChart(def, p, t, notes);
    default:
      return null;
  }
}
