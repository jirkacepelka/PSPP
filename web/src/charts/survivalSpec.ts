/* Chart spec of the Kaplan–Meier plots (type 'survival', written by the KM
   extension analysis in src/ext/commands/km.ts) and its defensive parser.
   Rendered by survival.tsx. */

import type { Pt } from './types';

export type SurvivalKind = 'survival' | 'hazard' | 'logsurv' | 'oms';

export interface SurvivalCurve {
  name: string;
  /** (0, start) and the value after every event time, on the plotted scale */
  points: Pt[];
  /** censored observations (time, value) */
  censored: Pt[];
  /** largest observed time: the last step extends to it (null: curve ends at its last point) */
  end: number | null;
}

export interface SurvivalSpec {
  type: 'survival';
  title: string;
  kind: SurvivalKind;
  xlabel: string;
  ylabel: string;
  legendTitle: string;
  censoredLabel: string;
  curves: SurvivalCurve[];
}

/* ---------------------------------------------------------------- parse */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const pts = (v: unknown): Pt[] =>
  arr(v).flatMap((p) => {
    const a = arr(p);
    const x = num(a[0]);
    const y = num(a[1]);
    return x !== null && y !== null ? [[x, y] as Pt] : [];
  });
const KINDS: SurvivalKind[] = ['survival', 'hazard', 'logsurv', 'oms'];

export function parseSurvival(c: Obj, title: string): SurvivalSpec {
  const kind = KINDS.includes(c.kind as SurvivalKind) ? (c.kind as SurvivalKind) : 'survival';
  return {
    type: 'survival',
    title,
    kind,
    xlabel: str(c.xlabel),
    ylabel: str(c.ylabel),
    legendTitle: str(c.legendTitle),
    censoredLabel: str(c.censoredLabel) || 'Censored',
    curves: arr(c.curves)
      .filter(isObj)
      .map((cv) => ({ name: str(cv.name), points: pts(cv.points), censored: pts(cv.censored), end: num(cv.end) })),
  };
}
