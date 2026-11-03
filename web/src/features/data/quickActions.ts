/*
 * Analyses opened pre-filled with variables from the grid, the inspector or Variable View (DV-5).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { openDialog } from '../../app/actions';
import { useData } from '../../store/data';
import { useSettings } from '../../store/settings';
import { useActiveVariable } from '../../app/gridBus';

export type QuickAnalysis = 'frequencies' | 'descriptives' | 'explore' | 'recode' | 'compute';

export function quickAnalysis(kind: QuickAnalysis, names: string[]) {
  switch (kind) {
    case 'frequencies':
      return openDialog('frequencies', { variables: names });
    case 'descriptives':
      return openDialog('descriptives', { variables: names });
    case 'explore':
      return openDialog('explore', { dependents: names });
    case 'recode':
      return openDialog('recodeDifferent', { pairs: names.map((n) => ({ src: n, dst: '', label: '' })) });
    case 'compute':
      return openDialog('compute', { expression: names.join(' + ') });
  }
}

/** Opens the inspector on variable INDEX. */
export function inspectVariable(index: number) {
  useActiveVariable.getState().setActive(index);
  if (!useSettings.getState().inspectorOpen) useSettings.getState().set({ inspectorOpen: true });
}

/** Names of variable indices in the current dataset. */
export function namesOf(indices: number[]): string[] {
  const vars = useData.getState().dataset?.variables ?? [];
  return indices.map((i) => vars[i]?.name).filter((n): n is string => !!n);
}
