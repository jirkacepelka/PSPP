/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { TFunction } from 'i18next';
import type { Variable } from '../../engine/types';
import { formatNumber, isDateFormat } from '../../lib/format';

export function typeLabel(v: Variable, t: TFunction): string {
  if (v.type === 'string') return t('varType.string');
  const f = v.print.type.toUpperCase();
  if (isDateFormat(f)) return t('varType.date');
  switch (f) {
    case 'COMMA': return t('varType.comma');
    case 'DOT': return t('varType.dot');
    case 'E': return t('varType.scientific');
    case 'DOLLAR': return t('varType.dollar');
    case 'PCT': return t('varType.percent');
    case 'CCA': case 'CCB': case 'CCC': case 'CCD': case 'CCE': return t('varType.custom');
    default: return t('varType.numeric');
  }
}

export function fmtVal(value: number | string, v: Variable): string {
  return typeof value === 'number' ? (isDateFormat(v.print.type) ? formatNumber(value, v.print) : String(value)) : `"${value}"`;
}

export function valueLabelsSummary(v: Variable, t: TFunction): string {
  if (!v.valueLabels.length) return t('variables.none');
  const shown = v.valueLabels.slice(0, 4).map((l) => `${fmtVal(l.value, v)} = ${l.label}`).join('; ');
  return v.valueLabels.length > 4 ? `${shown}; +${v.valueLabels.length - 4}` : shown;
}

export function missingSummary(v: Variable, t: TFunction): string {
  const parts: string[] = [];
  if (v.missing.range) parts.push(`${v.missing.range.low === -Infinity ? 'LO' : v.missing.range.low} – ${v.missing.range.high === Infinity ? 'HI' : v.missing.range.high}`);
  parts.push(...v.missing.values.map((x) => fmtVal(x, v)));
  return parts.length ? parts.join(', ') : t('variables.none');
}
