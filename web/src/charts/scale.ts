/* Scales, nice ticks, number formatting and text measurement shared by all
   chart renderers.  No DOM access except the (optional) canvas used to
   measure label widths. */

export interface LinearScale {
  (v: number): number;
  domain: [number, number];
  range: [number, number];
  invert(px: number): number;
}

export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const k = (r1 - r0) / span;
  const f = ((v: number) => r0 + (v - d0) * k) as LinearScale;
  f.domain = domain;
  f.range = range;
  f.invert = (px: number) => d0 + (px - r0) / k;
  return f;
}

/** A "nice" step (1, 2 or 5 × 10^k) that splits `span` into roughly `count` parts. */
export function niceStep(span: number, count: number): number {
  const raw = Math.abs(span) / Math.max(1, count);
  if (!isFinite(raw) || raw <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  const nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  return nf * p;
}

function stepDecimals(step: number): number {
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

function roundTo(v: number, decimals: number): number {
  const r = Number(v.toFixed(Math.min(20, decimals)));
  return Object.is(r, -0) ? 0 : r;
}

/** Expand a degenerate [min, max] into something with a usable span. */
export function safeExtent(min: number, max: number): [number, number] {
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    return [min - pad, max + pad];
  }
  return [min, max];
}

export interface Ticks {
  ticks: number[];
  step: number;
  domain: [number, number];
}

/** Ticks strictly inside [min, max] (domain unchanged). */
export function ticksWithin(min: number, max: number, count: number): Ticks {
  [min, max] = safeExtent(min, max);
  const step = niceStep(max - min, count);
  const dec = stepDecimals(step);
  const ticks: number[] = [];
  const start = Math.ceil(min / step - 1e-9);
  const end = Math.floor(max / step + 1e-9);
  for (let i = start; i <= end && ticks.length < 200; i++) ticks.push(roundTo(i * step, dec));
  return { ticks, step, domain: [min, max] };
}

/** Domain extended outward to whole ticks, so the axis begins and ends on a tick. */
export function niceTicks(min: number, max: number, count: number): Ticks {
  [min, max] = safeExtent(min, max);
  let step = niceStep(max - min, count);
  // A second pass: extending the domain may change the ideal step.
  for (let pass = 0; pass < 2; pass++) {
    const lo = Math.floor(min / step + 1e-9) * step;
    const hi = Math.ceil(max / step - 1e-9) * step;
    const s2 = niceStep(hi - lo, count);
    if (s2 === step) break;
    step = s2;
  }
  const dec = stepDecimals(step);
  const lo = roundTo(Math.floor(min / step + 1e-9) * step, dec);
  const hi = roundTo(Math.ceil(max / step - 1e-9) * step, dec);
  const ticks: number[] = [];
  for (let i = 0; lo + i * step <= hi + step * 1e-6 && i < 200; i++) ticks.push(roundTo(lo + i * step, dec));
  return { ticks, step, domain: [lo, hi === lo ? lo + step : hi] };
}

/** Pad a data extent by a fraction of its span (so points don't sit on the frame). */
export function padExtent(min: number, max: number, frac = 0.05): [number, number] {
  [min, max] = safeExtent(min, max);
  const pad = (max - min) * frac;
  // Don't let padding push an all-positive (or all-negative) extent across zero.
  const lo = min >= 0 && min - pad < 0 ? 0 : min - pad;
  const hi = max <= 0 && max + pad > 0 ? 0 : max + pad;
  return [lo, hi];
}

/* ---------------------------------------------------------------- numbers */

const fmtCache = new Map<string, Intl.NumberFormat>();
function nf(locale: string | undefined, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = (locale ?? '') + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, opts);
    } catch {
      f = new Intl.NumberFormat(undefined, opts);
    }
    fmtCache.set(key, f);
  }
  return f;
}

/** Formatter for tick labels: decimals follow the step; compact (10K) once the axis reaches 10,000. */
export function tickFormatter(step: number, ticks: number[], locale?: string): (v: number) => string {
  const maxAbs = ticks.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (maxAbs >= 10000) {
    const f = nf(locale, { notation: 'compact', maximumFractionDigits: 1 });
    return (v) => f.format(v);
  }
  const dec = stepDecimals(step);
  const f = nf(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return (v) => f.format(v);
}

/** Tick formatter for an axis in percent units (values 0–100). */
export function percentTickFormatter(step: number, locale?: string): (v: number) => string {
  const dec = stepDecimals(step);
  const f = nf(locale, { style: 'percent', minimumFractionDigits: dec, maximumFractionDigits: dec });
  return (v) => f.format(v / 100);
}

/** General-purpose value formatting for tooltips and tables. */
export function formatValue(v: number | null | undefined, locale?: string, maxDecimals?: number): string {
  if (v === null || v === undefined || !isFinite(v)) return '–';
  let dec = maxDecimals;
  if (dec === undefined) {
    const a = Math.abs(v);
    dec = a === 0 || Number.isInteger(v) ? 0 : a >= 1000 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 3 : 4;
    if (a !== 0 && a < 0.0001) return nf(locale, { maximumSignificantDigits: 3, notation: 'scientific' }).format(v);
  }
  return nf(locale, { maximumFractionDigits: dec }).format(v);
}

export function formatPercent(fraction: number, locale?: string): string {
  return nf(locale, { style: 'percent', maximumFractionDigits: 1 }).format(fraction);
}

/* ----------------------------------------------------------- text metrics */

export const CHART_FONT = "Inter, Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif";

let ctx: CanvasRenderingContext2D | null | undefined;
let measureFont = CHART_FONT;

/** Lets the shell tell the measurer which font family the chart really renders in. */
export function setMeasureFont(family: string): void {
  if (family) measureFont = family;
}

export function measureText(text: string, size: number, weight = 400): number {
  if (ctx === undefined) {
    try {
      ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      ctx = null;
    }
  }
  if (!ctx) return text.length * size * 0.56;
  ctx.font = `${weight} ${size}px ${measureFont}`;
  return ctx.measureText(text).width;
}

/** Cut text to fit `maxW` pixels, adding an ellipsis when shortened. */
export function truncateText(text: string, maxW: number, size: number, weight = 400): string {
  if (measureText(text, size, weight) <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measureText(text.slice(0, mid).trimEnd() + '…', size, weight) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '…' : text.slice(0, lo).trimEnd() + '…';
}

/** Greedy word wrap into at most `maxLines` lines; the last line is truncated if needed. */
export function wrapText(text: string, maxW: number, size: number, weight = 400, maxLines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = cur ? cur + ' ' + w : w;
    if (measureText(next, size, weight) <= maxW || !cur) {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) {
        cur = words.slice(i).join(' ');
        break;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => truncateText(l, maxW, size, weight));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
