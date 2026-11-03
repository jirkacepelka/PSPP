/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { Variable } from '../engine/types';
import { isDateFormat } from '../lib/format';

export function variableIcon(v: Variable): string {
  if (v.type === 'string') return 'text_fields';
  if (isDateFormat(v.print.type)) return 'event';
  if (v.measure === 'nominal') return 'category';
  if (v.measure === 'ordinal') return 'signal_cellular_alt';
  return 'straighten';
}
