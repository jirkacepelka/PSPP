/* Contract between the Graph Studio (src/graphstudio) and the chart renderers (src/charts).
   Chart JSON keeps the engine's shape; the studio adds `studio` (the definition, for reopening) and
   `style` (appearance overrides, valid on every chart).  New spec types listed here are produced by the
   studio only (the engine never sends them). */

export type GraphKind =
  | 'bar' | 'line' | 'area' | 'pie' | 'histogram' | 'pyramid' | 'boxplot' | 'errorbar' | 'scatter'
  | 'dot' | 'pareto' | 'scattermatrix' | 'heatmap'
  | 'highlow' | 'dualaxis' | 'qq' | 'pp' | 'sequence' | 'control' | 'violin' | 'density'
  | 'bar3d' | 'scatter3d' | 'surface3d'
  | 'overlay' | 'bubble' | 'mosaic' | 'ridgeline' | 'radar' | 'lollipop' | 'waterfall' | 'forest' | 'treemap' | 'blandaltman' | 'forecast';

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
  /** 3D charts: title of the vertical (z) axis */
  zTitle?: string;
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
  /* On the 3D charts x = the first data axis, y = the second (depth) axis, z = the vertical axis (zMin/zMax). */
  /** 3D charts: range of the vertical axis (null = automatic) */
  zMin?: number | null;
  zMax?: number | null;
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
/* LineSpec:      connect?: boolean (false = markers + error bars only, i.e. error bar chart);
                  xValues?: number[] (numeric position per category, ascending; proportional numeric x axis; also on AreaSpec and HighLowSpec) */
/* ScatterSpec:   fit?: 'linear'|'quadratic'|'cubic'|'loess'|'none'; fitByGroup?: boolean; showR2?: boolean */

export interface AreaSpec {
  type: 'area';
  title: string;
  xlabel: string;
  ylabel: string;
  legendTitle: string;
  categories: string[];
  /** optional numeric position per category (ascending): proportional numeric x axis instead of category labels */
  xValues?: number[];
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

/* ---- phase 2 ---- */
/* BoxSpec:      group?: string | null (clustered boxplot: boxes with the same label form a cluster, colour by group) */
/* ScatterSpec:  fitCi?: boolean (confidence band around the fit, 95 %) */

/** High-low-close / range bars / difference area over categories. */
export interface HighLowSpec {
  type: 'highlow';
  title: string;
  xlabel: string;
  ylabel: string;
  /** 'hlc' bar from low to high with a close tick, 'range' plain bars, 'diff' area between low and high */
  mode: 'hlc' | 'range' | 'diff';
  categories: string[];
  /** optional numeric position per category (ascending), see AreaSpec.xValues */
  xValues?: number[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[] | null;
}

/** Two value axes over one categorical axis; each side is bars or a line. */
export interface DualAxisSpec {
  type: 'dualaxis';
  title: string;
  xlabel: string;
  categories: string[];
  left: { name: string; ylabel: string; kind: 'bar' | 'line'; values: (number | null)[] };
  right: { name: string; ylabel: string; kind: 'bar' | 'line'; values: (number | null)[] };
}

/** Q-Q (observed vs theoretical quantiles) or P-P (observed vs expected cumulative proportion). */
export interface ProbPlotSpec {
  type: 'probplot';
  title: string;
  mode: 'qq' | 'pp';
  xlabel: string;
  ylabel: string;
  /** [theoretical, observed], sorted by theoretical */
  points: [number, number][];
  /** the reference line as two end points in the same coordinates */
  reference: [[number, number], [number, number]] | null;
}

/** Line chart over a numeric x (case number, time). */
export interface SequenceSpec {
  type: 'sequence';
  title: string;
  xlabel: string;
  ylabel: string;
  x: number[];
  /** how to print x: 'number' (default) or 'date', where x is then days since 1970-01-01 (not PSPP seconds since 1582) */
  xFormat?: 'number' | 'date';
  /** phase 4: dash = draw the whole series dashed (a forecast part is a series of its own) */
  series: { name: string; values: (number | null)[]; dash?: boolean }[];
  /** phase 4: translucent bands aligned with `x` (null = no band at that position); `series` (contract addition, optional)
      is the index of the series whose colour the band takes, default: the band's own index */
  bands?: { name: string; lo: (number | null)[]; hi: (number | null)[]; series?: number }[];
}

/** Shewhart style control chart: points, centre line and per point limits, flagged points out of limits. */
export interface ControlSpec {
  type: 'control';
  title: string;
  xlabel: string;
  ylabel: string;
  labels: string[];
  values: (number | null)[];
  center: number;
  ucl: number[];
  lcl: number[];
  flags: boolean[];
}

/** Kernel density curves (one per group), optionally filled. */
export interface DensitySpec {
  type: 'density';
  title: string;
  xlabel: string;
  ylabel: string;
  curves: { name: string; points: [number, number][] }[];
  fill: boolean;
  /** phase 4: 'ridge' offsets the curves vertically, one baseline per group, group names on the left (default 'overlay') */
  layout?: 'overlay' | 'ridge';
}

/** Violin plot: mirrored density per category with median and quartiles. */
export interface ViolinSpec {
  type: 'violin';
  title: string;
  ylabel: string;
  violins: { label: string; points: [number, number][]; median: number; q1: number; q3: number }[];
}

/** Small multiples: the same chart type once per level of a panel variable. Each `chart` is a full chart JSON. */
export interface PanelsSpec {
  type: 'panels';
  title: string;
  columns: number;
  /** true: all panels share axis ranges (the studio computes them and writes them into each panel's style) */
  sharedAxes: boolean;
  panels: { title: string; chart: unknown }[];
}

/* ---- phase 3: 3D (SVG with a software projection, rotated by dragging) ---- */

/** 3D scatter; optional least squares plane. Groups colour the points like the 2D scatter. */
export interface Scatter3dSpec {
  type: 'scatter3d';
  title: string;
  xlabel: string;
  ylabel: string;
  zlabel: string;
  points: { x: number; y: number; z: number; group: string | null }[];
  /** 'plane' draws the least squares plane z = a + bx + cy (computed by the renderer) */
  fit?: 'none' | 'plane';
  groupLabel?: string | null;
}

/** 3D bars over a grid of two categorical axes; values[yi][xi], null = no bar. */
export interface Bar3dSpec {
  type: 'bar3d';
  title: string;
  xlabel: string;
  ylabel: string;
  zlabel: string;
  xs: string[];
  ys: string[];
  values: (number | null)[][];
}

/** 3D surface over a regular grid; z[yi][xi], null = hole. */
export interface Surface3dSpec {
  type: 'surface3d';
  title: string;
  xlabel: string;
  ylabel: string;
  zlabel: string;
  xs: number[];
  ys: number[];
  z: (number | null)[][];
}

/* ChartStyle additions for 3D (optional): azimuth/elevation in degrees (initial view), perspective: boolean.
   Stored in `chart.view3d` = { azimuth, elevation, perspective } so a rotated view survives save and edit. */
export interface View3d {
  azimuth: number;
  elevation: number;
  perspective: boolean;
  /** zoom factor, 1 = fit */
  zoom?: number;
}

/* ---- phase 4: more chart types ---- */
/* ScatterSpec:  marginals?: 'none'|'histogram'|'density'|'box' (small marginal plots on top and right of the scatter) */
/* DensitySpec:  layout?: 'overlay'|'ridge' (ridge = curves offset vertically, one baseline per group) */
/* BarSpec:      lollipop?: boolean (stem and dot instead of a bar) */
/* SequenceSpec: series[].dash?: boolean; bands?: { name: string; lo: (number|null)[]; hi: (number|null)[] }[] (translucent
                 prediction bands; x positions as in the sequence x array, forecasts simply extend x) */

export interface BubbleSpec {
  type: 'bubble';
  title: string;
  xlabel: string;
  ylabel: string;
  sizeLabel: string;
  points: { x: number; y: number; size: number; group: string | null; label?: string }[];
}

/** Mosaic plot: tile widths by x totals, heights by the y share within each x; counts[yi][xi]. `shade` colours tiles by Pearson residual. */
export interface MosaicSpec {
  type: 'mosaic';
  title: string;
  xlabel: string;
  ylabel: string;
  xs: string[];
  ys: string[];
  counts: number[][];
  shade: boolean;
}

export interface RadarSpec {
  type: 'radar';
  title: string;
  axes: string[];
  series: { name: string; values: (number | null)[] }[];
  min: number | null;
  max: number | null;
}

/** Waterfall: running total; steps with total=true draw the cumulative sum as a full bar. */
export interface WaterfallSpec {
  type: 'waterfall';
  title: string;
  xlabel: string;
  ylabel: string;
  steps: { label: string; value: number; total?: boolean }[];
}

/** Forest plot: estimates with intervals on a common axis, a reference line (null effect). */
export interface ForestSpec {
  type: 'forest';
  title: string;
  xlabel: string;
  refValue: number;
  /** draw the x axis on a log scale (ratios) */
  log: boolean;
  rows: { label: string; est: number; lo: number; hi: number; weight?: number | null; group?: string | null }[];
}

/** Treemap: squarified tiles by value, optionally coloured by group. */
export interface TreemapSpec {
  type: 'treemap';
  title: string;
  tiles: { label: string; value: number; group?: string | null }[];
}
