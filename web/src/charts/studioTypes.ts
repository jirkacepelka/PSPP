/* Contract between the Graph Studio (src/graphstudio) and the chart renderers (src/charts).
   Chart JSON keeps the engine's shape; the studio adds `studio` (the definition, for reopening) and
   `style` (appearance overrides, valid on every chart).  New spec types listed here are produced by the
   studio only (the engine never sends them). */

export type GraphKind =
  | 'bar' | 'line' | 'area' | 'pie' | 'histogram' | 'pyramid' | 'boxplot' | 'errorbar' | 'scatter'
  | 'dot' | 'pareto' | 'scattermatrix' | 'heatmap'
  | 'highlow' | 'dualaxis' | 'qq' | 'pp' | 'sequence' | 'control' | 'violin' | 'density'
  | 'bar3d' | 'scatter3d' | 'surface3d';

/** Saved with the chart so the studio can reopen it. `bind` maps a slot id to variable names. */
export interface GraphDef {
  v: 1;
  kind: GraphKind;
  /** e.g. 'clustered', 'stacked', 'stacked100', 'horizontal' (kind specific) */
  variant?: string;
  bind: Record<string, string[]>;
  /** kind specific options: summary function ('mean', 'count', ...), bin count, interval, fit type... */
  options: Record<string, unknown>;
}

export interface RefLine {
  axis: 'x' | 'y';
  value: number;
  label?: string;
  /** css colour or null for the default reference colour */
  color?: string | null;
  dash?: boolean;
}

export interface Annotation {
  /** data coordinates (x is a number, or a category index for categorical axes) */
  x: number;
  y: number;
  text: string;
}

/** Appearance overrides; every field optional, absent = renderer default. Applies to any chart. */
export interface ChartStyle {
  title?: string;
  subtitle?: string;
  xTitle?: string;
  yTitle?: string;
  /** false hides the title/axis titles entirely */
  showTitle?: boolean;
  legend?: 'auto' | 'none';
  legendTitle?: string;
  /** series colours by index (css colours); null keeps the default for that index */
  palette?: (string | null)[];
  grid?: boolean;
  xMin?: number | null;
  xMax?: number | null;
  yMin?: number | null;
  yMax?: number | null;
  refLines?: RefLine[];
  annotations?: Annotation[];
  /** print values on bars / points where it makes sense */
  valueLabels?: boolean;
  /** multiplies all text sizes, 1 = default */
  fontScale?: number;
}

/* ---- additions to existing specs (all optional, engine charts unaffected) ---- */
/* BarSpec:       stack?: 'none'|'stack'|'stack100'; horizontal?: boolean; xlabel?: string;
                  err?: ({lo:number;hi:number}|null)[] aligned with bars (error whiskers) */
/* HistogramSpec: series?: {name:string; counts:number[]}[] (stacked, same bins) ; mode?: 'bars'|'polygon' */
/* LineSpec:      connect?: boolean (false = markers + error bars only, i.e. error bar chart) */
/* ScatterSpec:   fit?: 'linear'|'quadratic'|'cubic'|'loess'|'none'; fitByGroup?: boolean; showR2?: boolean */

export interface AreaSpec {
  type: 'area';
  title: string;
  xlabel: string;
  ylabel: string;
  legendTitle: string;
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
  stack: 'none' | 'stack' | 'stack100';
}

/** Stacked dot plot: one dot per case, stacked in value bins. */
export interface DotSpec {
  type: 'dot';
  title: string;
  xlabel: string;
  bins: { x: number; count: number; group?: string | null }[];
}

export interface ParetoSpec {
  type: 'pareto';
  title: string;
  xlabel: string;
  ylabel: string;
  /** already sorted descending */
  bars: { label: string; count: number }[];
  total: number;
}

/** Scatterplot matrix; rows are cases (the studio samples at most 2000), one value per var. */
export interface MatrixSpec {
  type: 'matrix';
  title: string;
  vars: string[];
  rows: (number | null)[][];
  groups: (string | null)[] | null;
  byvar: string | null;
}

/** Binned scatter: counts[yi][xi] over the cell edges. */
export interface HeatmapSpec {
  type: 'heatmap';
  title: string;
  xlabel: string;
  ylabel: string;
  xEdges: number[];
  yEdges: number[];
  counts: number[][];
}

/** Population pyramid: two back to back histograms sharing the bins. */
export interface PyramidSpec {
  type: 'pyramid';
  title: string;
  xlabel: string;
  leftName: string;
  rightName: string;
  /** [lower, upper, leftCount, rightCount] */
  bins: [number, number, number, number][];
}

export type StudioSpecType = AreaSpec['type'] | DotSpec['type'] | ParetoSpec['type'] | MatrixSpec['type'] | HeatmapSpec['type'] | PyramidSpec['type'];
