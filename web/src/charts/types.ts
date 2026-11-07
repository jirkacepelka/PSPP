/* Chart JSON as written by engine/bridge/chart-json.c, plus defensive
   parsing from `unknown`.  The serializer maps system-missing and
   non-finite numbers to null. */

import { parseSurvival, type SurvivalSpec } from './survivalSpec';
import { parseDendrogram, type DendrogramSpec } from './dendrogram';
import { parseLine, type LineSpec } from './lineSpec';

export type Pt = [number, number];

export interface HistogramSpec {
  type: 'histogram';
  title: string;
  n: number | null;
  mean: number | null;
  stddev: number | null;
  showNormal: boolean;
  /** the variable holds whole numbers only (set by the app from the dataset): bins are labelled by the values they hold */
  integer: boolean;
  /** [lower, upper, count] per bin. */
  bins: [number, number, number][];
}

export interface BarSpec {
  type: 'bar';
  title: string;
  percent: boolean;
  ylabel: string;
  total: number;
  bars: { x: string; group: string | null; count: number }[];
}

export interface PieSpec {
  type: 'pie';
  title: string;
  slices: { label: string; value: number }[];
}

export interface BoxSpec {
  label: string;
  hinges: [number, number, number];
  whiskers: [number | null, number | null];
  outliers: { value: number; label: string; extreme: boolean }[];
}

export interface BoxplotSpec {
  type: 'boxplot';
  title: string;
  yMin: number | null;
  yMax: number | null;
  boxes: BoxSpec[];
}

export interface NpSpec {
  type: 'np';
  title: string;
  detrended: boolean;
  slope: number | null;
  intercept: number | null;
  yFirst: number | null;
  yLast: number | null;
  xLower: number | null;
  xUpper: number | null;
  points: Pt[];
}

export interface RocSpec {
  type: 'roc';
  title: string;
  reference: boolean;
  curves: { name: string; points: Pt[] }[];
}

export interface ScatterSpec {
  type: 'scatter';
  title: string;
  xlabel: string;
  ylabel: string;
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
  byvar: string | null;
  points: { x: number; y: number; group: string | null }[];
}

export interface ScreeSpec {
  type: 'scree';
  title: string;
  xlabel: string;
  values: number[];
}

export interface SpreadLevelSpec {
  type: 'spreadlevel';
  title: string;
  power: number | null;
  points: Pt[];
}

export interface UnknownSpec {
  type: 'unknown';
  title: string;
  rawType: string;
}

export type ChartSpec =
  | HistogramSpec
  | BarSpec
  | PieSpec
  | BoxplotSpec
  | NpSpec
  | RocSpec
  | ScatterSpec
  | ScreeSpec
  | SpreadLevelSpec
  | SurvivalSpec
  | DendrogramSpec
  | LineSpec
  | UnknownSpec;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** PSPP pads labels with trailing blanks; collapse whitespace. */
export const clean = (s: string): string =>
  s.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();

function pts(v: unknown): Pt[] {
  const out: Pt[] = [];
  for (const p of arr(v)) {
    const a = arr(p);
    const x = num(a[0]);
    const y = num(a[1]);
    if (x !== null && y !== null) out.push([x, y]);
  }
  return out;
}

/** Accepts either a bare chart object or an output item `{ kind: 'chart', chart }`. */
export function parseChart(input: unknown): ChartSpec {
  let c: unknown = input;
  let itemTitle = '';
  if (isObj(c) && isObj(c.chart)) {
    itemTitle = str(c.title);
    c = c.chart;
  }
  if (!isObj(c)) return { type: 'unknown', title: clean(itemTitle), rawType: typeof input };
  const title = clean(str(c.title) || itemTitle);
  const type = str(c.type);
  switch (type) {
    case 'histogram': {
      const bins: [number, number, number][] = [];
      for (const b of arr(c.bins)) {
        const a = arr(b);
        const lo = num(a[0]);
        const hi = num(a[1]);
        if (lo !== null && hi !== null) bins.push([lo, hi, num(a[2]) ?? 0]);
      }
      return { type, title, n: num(c.n), mean: num(c.mean), stddev: num(c.stddev), showNormal: c.showNormal === true, integer: c.integer === true, bins };
    }
    case 'bar':
      return {
        type,
        title,
        percent: c.percent === true,
        ylabel: clean(str(c.ylabel)),
        total: num(c.total) ?? 0,
        bars: arr(c.bars)
          .filter(isObj)
          .map((b) => ({ x: clean(str(b.x)), group: b.group === null || b.group === undefined ? null : clean(str(b.group)), count: num(b.count) ?? 0 })),
      };
    case 'pie':
      return {
        type,
        title,
        slices: arr(c.slices)
          .filter(isObj)
          .map((s) => ({ label: clean(str(s.label)), value: num(s.value) ?? 0 })),
      };
    case 'boxplot':
      return {
        type,
        title,
        yMin: num(c.yMin),
        yMax: num(c.yMax),
        boxes: arr(c.boxes)
          .filter(isObj)
          .flatMap((b): BoxSpec[] => {
            const h = arr(b.hinges).map(num);
            if (h.length < 3 || h[0] === null || h[1] === null || h[2] === null) return [];
            const w = arr(b.whiskers).map(num);
            return [
              {
                label: clean(str(b.label)),
                hinges: [h[0], h[1], h[2]],
                whiskers: [w[0] ?? null, w[1] ?? null],
                outliers: arr(b.outliers)
                  .filter(isObj)
                  .flatMap((o) => {
                    const v = num(o.value);
                    return v === null ? [] : [{ value: v, label: clean(str(o.label)), extreme: o.extreme === true }];
                  }),
              },
            ];
          }),
      };
    case 'np':
      return {
        type,
        title,
        detrended: c.detrended === true,
        slope: num(c.slope),
        intercept: num(c.intercept),
        yFirst: num(c.yFirst),
        yLast: num(c.yLast),
        xLower: num(c.xLower),
        xUpper: num(c.xUpper),
        points: pts(c.points),
      };
    case 'roc':
      return {
        type,
        title: c.title === null ? '' : title === 'Chart' ? '' : title,
        reference: c.reference === true,
        curves: arr(c.curves)
          .filter(isObj)
          .map((cv) => ({ name: clean(str(cv.name)), points: pts(cv.points) })),
      };
    case 'scatter': {
      const points: ScatterSpec['points'] = [];
      for (const p of arr(c.points)) {
        const a = arr(p);
        const x = num(a[0]);
        const y = num(a[1]);
        if (x !== null && y !== null) points.push({ x, y, group: a.length > 2 ? clean(str(a[2])) : null });
      }
      return {
        type,
        title,
        xlabel: clean(str(c.xlabel)),
        ylabel: clean(str(c.ylabel)),
        xMin: num(c.xMin),
        xMax: num(c.xMax),
        yMin: num(c.yMin),
        yMax: num(c.yMax),
        byvar: typeof c.byvar === 'string' ? c.byvar : null,
        points,
      };
    }
    case 'scree':
      return {
        type,
        title: c.title === null || title === 'Chart' ? '' : title,
        xlabel: clean(str(c.xlabel)),
        values: arr(c.values).map(num).filter((v): v is number => v !== null),
      };
    case 'spreadlevel':
      return { type, title, power: num(c.power), points: pts(c.points) };
    case 'survival':
      return parseSurvival(c, title);
    case 'dendrogram':
      return parseDendrogram(c, title);
    case 'line':
      return parseLine(c, title);
    default:
      return { type: 'unknown', title, rawType: type || 'unknown' };
  }
}
