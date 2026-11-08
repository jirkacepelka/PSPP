/*
 * User profile and appearance settings, persisted to IndexedDB.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { create } from 'zustand';
import { kvGet, kvSet } from '../lib/storage';
import { ACCENT_PRESETS as PRESETS, DEFAULT_ACCENT } from '../lib/color';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Density = 'compact' | 'comfortable';
export type TableStyle = 'modern' | 'classic' | 'apa' | 'compact';
export type GridFont = 'system' | 'inter' | 'roboto' | 'mono';
export type Lang = 'cs' | 'en';

export interface Profile {
  name: string;
  initials: string;
  color: string;
  avatar?: string;
}

export interface Settings {
  profile: Profile;
  theme: ThemeMode;
  accent: string;
  density: Density;
  fontSize: number;
  gridFont: GridFont;
  tableStyle: TableStyle;
  language: Lang;
  decimalSeparator: '.' | ',';
  defaultDecimals: number;
  dateFormat: 'DATE' | 'EDATE' | 'ADATE' | 'SDATE';
  editorFontSize: number;
  lineNumbers: boolean;
  wordWrap: boolean;
  autoRunSelection: boolean;
  autosave: boolean;
  showToolbar: boolean;
  showFormulaBar: boolean;
  showStatusBar: boolean;
  /** Show value labels instead of codes in the data grid. */
  showValueLabels: boolean;
  /** Plain-language interpretation cards under key results. */
  explainResults: 'always' | 'onDemand' | 'never';
  /** Leading zero for values bounded by 1 (p, r): APA omits it. */
  leadingZero: 'always' | 'apa' | 'never';
  /** p-value display: exact (p = ,032) or thresholds (p < ,05). */
  pFormat: 'exact' | 'threshold';
  /** Default confidence level in dialogs, in percent. */
  ciLevel: number;
  /** Language of APA-style copied tables. */
  apaLocale: Lang;
  /** Data export: value labels instead of codes; CSV with ';' and decimal comma. */
  exportOptions: { labels: boolean; semicolon: boolean };
  /** Output export (HTML / PDF): what to include. */
  outputExport: { syntax: boolean; interpret: boolean; toc: boolean };
  /** Re-running an output result replaces it instead of appending. */
  rerunReplaces: boolean;
  /** How variables are listed in dialogs and pickers. */
  listShows: 'name' | 'label' | 'both';
  /** Live syntax preview in analysis dialogs. */
  showSyntaxPreview: boolean;
  /** Variable View shows all SPSS columns (otherwise the essential ones). */
  variableViewAllColumns: boolean;
  /** Variable inspector side panel open. */
  inspectorOpen: boolean;
  /** Text labels next to the main toolbar icons (on in the calm preset). */
  toolbarLabels: boolean;
  /** Split view layout, or off. */
  splitView: 'off' | 'syntax-output' | 'data-output';
  /** First-run setup guide finished or skipped. */
  onboarded: boolean;
  /** Last visual preset chosen (app/presets.ts); 'custom' after manual tweaks. */
  uiPreset: 'calm' | 'balanced' | 'full' | 'custom';
}

/** Accent preset colours (light-theme values) from the design system; see lib/color.ts. */
export const ACCENT_PRESETS = PRESETS.map((p) => p.light);
export const AVATAR_COLORS = ['#0f7b5f', '#2f6a9a', '#86497a', '#93600c', '#4a55b0', '#0e6e80', '#b3412e', '#4d5966', '#6e8b3d', '#8a4f87'];

export function detectLanguage(): Lang {
  try {
    const langs = (navigator.languages?.length ? navigator.languages : [navigator.language]) ?? [];
    for (const l of langs) {
      const p = l.toLowerCase().slice(0, 2);
      if (p === 'cs' || p === 'sk') return 'cs';
      if (p === 'en') return 'en';
    }
  } catch {
    /* ignore */
  }
  return 'en';
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export const defaultSettings = (): Settings => {
  const lang = detectLanguage();
  return {
    profile: { name: '', initials: '', color: AVATAR_COLORS[0] },
    theme: 'system',
    accent: DEFAULT_ACCENT,
    density: 'comfortable',
    fontSize: 14,
    gridFont: 'system',
    tableStyle: 'modern',
    language: lang,
    decimalSeparator: lang === 'cs' ? ',' : '.',
    defaultDecimals: 2,
    dateFormat: lang === 'cs' ? 'EDATE' : 'ADATE',
    editorFontSize: 14,
    lineNumbers: true,
    wordWrap: false,
    autoRunSelection: true,
    autosave: true,
    showToolbar: true,
    showFormulaBar: true,
    showStatusBar: true,
    showValueLabels: true,
    explainResults: 'always',
    leadingZero: 'apa',
    pFormat: 'exact',
    ciLevel: 95,
    apaLocale: lang,
    exportOptions: { labels: false, semicolon: lang === 'cs' },
    outputExport: { syntax: false, interpret: true, toc: true },
    rerunReplaces: true,
    listShows: 'both',
    showSyntaxPreview: true,
    variableViewAllColumns: false,
    inspectorOpen: true,
    splitView: 'off',
    toolbarLabels: false,
    onboarded: false,
    uiPreset: 'balanced',
  };
};

interface SettingsState extends Settings {
  loaded: boolean;
  set: (patch: Partial<Settings>) => void;
  setProfile: (patch: Partial<Profile>) => void;
  reset: () => void;
  load: () => Promise<void>;
}

const KEY = 'settings.v1';

export const useSettings = create<SettingsState>((set, get) => ({
  ...defaultSettings(),
  loaded: false,
  set: (patch) => {
    set(patch);
    persist(get());
  },
  setProfile: (patch) => {
    set({ profile: { ...get().profile, ...patch } });
    persist(get());
  },
  reset: () => {
    const d = defaultSettings();
    set({ ...d, profile: get().profile, onboarded: get().onboarded });
    persist(get());
  },
  load: async () => {
    const saved = await kvGet<Partial<Settings>>(KEY);
    if (saved && typeof saved === 'object') {
      // Settings saved before the setup guide existed: a named profile means a returning user.
      const onboarded = saved.onboarded ?? !!saved.profile?.name?.trim();
      set({ ...defaultSettings(), ...saved, onboarded, profile: { ...defaultSettings().profile, ...(saved.profile ?? {}) } });
    }
    set({ loaded: true });
  },
}));

function pick(s: SettingsState): Settings {
  const { loaded: _l, set: _s, setProfile: _p, reset: _r, load: _ld, ...rest } = s;
  void _l; void _s; void _p; void _r; void _ld;
  return rest;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function persist(s: SettingsState) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void kvSet(KEY, pick(s)), 200);
}

export function getSettings(): Settings {
  return pick(useSettings.getState());
}
