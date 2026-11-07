/* Chart spec of line charts over a categorical x axis (type 'line'): GLM profile plots of estimated
   marginal means (src/ext/commands/glm.ts) and GRAPH /LINE (src/ext/commands/graphLine.ts).
   Each series has one value per category (null = missing, the line breaks there) and optional
   error bars (lo/hi).  All text arrives in the spec, already translated.  Rendered by line.tsx. */

export interface LineSeries {
  name: string;
  values: (number | null)[];
  lo?: (number | null)[];
  hi?: (number | null)[];
}

export interface LineSpec {
  type: 'line';
  title: string;
  xlabel: string;
  ylabel: string;
  /** title of the legend (the "separate lines" variable) */
  legendTitle: string;
  /** label of the error bars in the legend / data table, e.g. "95% CI" ('' = no bars) */
  errorLabel: string;
  categories: string[];
  series: LineSeries[];
  /** draw a marker at each value (default true) */
  markers: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function parseLine(c: Obj, title: string): LineSpec {
  const categories = arr(c.categories).map(str);
  const n = categories.length;
  const vals = (v: unknown) => Array.from({ length: n }, (_, i) => num(arr(v)[i]));
  return {
    type: 'line',
    title,
    xlabel: str(c.xlabel),
    ylabel: str(c.ylabel),
    legendTitle: str(c.legendTitle),
    errorLabel: str(c.errorLabel),
    categories,
    markers: c.markers !== false,
    series: arr(c.series)
      .filter(isObj)
      .map((s) => ({ name: str(s.name), values: vals(s.values), ...(Array.isArray(s.lo) && Array.isArray(s.hi) ? { lo: vals(s.lo), hi: vals(s.hi) } : {}) })),
  };
}
