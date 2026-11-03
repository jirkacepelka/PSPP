/*
 * User profile and appearance settings, persisted to IndexedDB.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { create } from 'zustand';
import { kvGet, kvSet } from '../lib/storage';

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
}

export const ACCENT_PRESETS = ['#1a73e8', '#0b8043', '#8e24aa', '#d93025', '#e37400', '#00796b', '#3949ab', '#5f6368'];
export const AVATAR_COLORS = ['#1a73e8', '#188038', '#a142f4', '#d93025', '#e8710a', '#12a4af', '#c5221f', '#5f6368', '#9334e6', '#f538a0'];

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
    accent: ACCENT_PRESETS[0],
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
    set({ ...d, profile: get().profile });
    persist(get());
  },
  load: async () => {
    const saved = await kvGet<Partial<Settings>>(KEY);
    if (saved && typeof saved === 'object') set({ ...defaultSettings(), ...saved, profile: { ...defaultSettings().profile, ...(saved.profile ?? {}) } });
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
