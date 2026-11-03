/*
 * Applies appearance settings (theme, accent, density, font sizes) to the document.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { accentPalette } from '../lib/color';
import { useSettings, type Settings } from '../store/settings';
import i18n from '../i18n';

const GRID_FONTS: Record<Settings['gridFont'], string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  inter: "'Inter', system-ui, sans-serif",
  roboto: "'Roboto', system-ui, sans-serif",
  mono: "'Roboto Mono', ui-monospace, monospace",
};

export function resolvedDark(s: Pick<Settings, 'theme'>): boolean {
  if (s.theme === 'dark') return true;
  if (s.theme === 'light') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function applyAppearance(s: Settings) {
  const root = document.documentElement;
  const dark = resolvedDark(s);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.density = s.density;
  const p = accentPalette(s.accent, dark);
  root.style.setProperty('--primary', p.primary);
  root.style.setProperty('--on-primary', p.onPrimary);
  root.style.setProperty('--primary-container', p.container);
  root.style.setProperty('--on-primary-container', p.onContainer);
  root.style.setProperty('--primary-soft', p.soft);
  root.style.setProperty('--fs-base', `${s.fontSize}px`);
  root.style.setProperty('--font-grid', GRID_FONTS[s.gridFont] ?? GRID_FONTS.system);
  root.lang = s.language;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', dark ? '#131314' : '#f9fbfd');
  if (i18n.language !== s.language) void i18n.changeLanguage(s.language);
  window.dispatchEvent(new Event('pspp-theme-changed'));
}

export function startAppearance(): () => void {
  applyAppearance(useSettings.getState());
  const unsub = useSettings.subscribe((s) => applyAppearance(s));
  let mq: MediaQueryList | null = null;
  const onChange = () => applyAppearance(useSettings.getState());
  try {
    mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onChange);
  } catch {
    /* ignore */
  }
  return () => {
    unsub();
    mq?.removeEventListener('change', onChange);
  };
}
