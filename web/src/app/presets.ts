/*
 * Visual presets: one click sets how much chrome and detail the workspace shows.
 * "Klidný" (calm) for first steps, "Vyvážený" (balanced, the defaults) and "Plný" (full) for
 * experienced users. The active preset is derived from the current values (activePreset), so
 * any manual change elsewhere reads as "custom" without extra bookkeeping.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useSettings, type Settings } from '../store/settings';

export type PresetId = 'calm' | 'balanced' | 'full';
export type PresetState = PresetId | 'custom';

/** The settings a preset controls. */
export type PresetPatch = Pick<
  Settings,
  'density' | 'fontSize' | 'showToolbar' | 'showFormulaBar' | 'showStatusBar' | 'inspectorOpen' | 'explainResults' | 'showSyntaxPreview' | 'variableViewAllColumns' | 'listShows' | 'toolbarLabels'
>;

export interface UiPreset {
  id: PresetId;
  /** i18n key prefix: `${key}.name`, `${key}.desc`, `${key}.who` */
  key: string;
  icon: string;
  patch: PresetPatch;
}

export const UI_PRESETS: readonly UiPreset[] = [
  {
    id: 'calm',
    key: 'onboarding.presets.calm',
    icon: 'light_mode',
    patch: {
      density: 'comfortable',
      fontSize: 15,
      showToolbar: true,
      showFormulaBar: false,
      showStatusBar: true,
      inspectorOpen: false,
      explainResults: 'always',
      showSyntaxPreview: false,
      variableViewAllColumns: false,
      listShows: 'label',
      toolbarLabels: true,
    },
  },
  {
    id: 'balanced',
    key: 'onboarding.presets.balanced',
    icon: 'balance',
    patch: {
      density: 'comfortable',
      fontSize: 14,
      showToolbar: true,
      showFormulaBar: true,
      showStatusBar: true,
      inspectorOpen: true,
      explainResults: 'always',
      showSyntaxPreview: true,
      variableViewAllColumns: false,
      listShows: 'both',
      toolbarLabels: false,
    },
  },
  {
    id: 'full',
    key: 'onboarding.presets.full',
    icon: 'dataset',
    patch: {
      density: 'compact',
      fontSize: 13,
      showToolbar: true,
      showFormulaBar: true,
      showStatusBar: true,
      inspectorOpen: true,
      explainResults: 'onDemand',
      showSyntaxPreview: true,
      variableViewAllColumns: true,
      listShows: 'both',
      toolbarLabels: false,
    },
  },
];

export function getPreset(id: PresetId): UiPreset {
  return UI_PRESETS.find((p) => p.id === id) ?? UI_PRESETS[1];
}

/** Applies a preset's values and records it as the chosen one. */
export function applyPreset(id: PresetId): void {
  useSettings.getState().set({ ...getPreset(id).patch, uiPreset: id });
}

/** The preset whose values all match `s`, or 'custom'. */
export function activePreset(s: Partial<Settings>): PresetState {
  const hit = UI_PRESETS.find((p) => (Object.keys(p.patch) as (keyof PresetPatch)[]).every((k) => s[k] === p.patch[k]));
  return hit ? hit.id : 'custom';
}

/** React hook: the preset matching the current settings. */
export function useActivePreset(): PresetState {
  return useSettings((s) => activePreset(s));
}

/**
 * Optional: keeps the stored `uiPreset` field in sync with the values (flips to 'custom'
 * after a manual change, back to a preset when the values match one again).
 * Returns an unsubscribe function.
 */
export function startPresetTracking(): () => void {
  return useSettings.subscribe((s) => {
    if (!s.loaded) return;
    const now = activePreset(s);
    if (now !== s.uiPreset) s.set({ uiPreset: now });
  });
}
