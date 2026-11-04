/*
 * Applies appearance settings (theme, accent, density, font sizes) to the document.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { applyAccent } from '../lib/color';
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

export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

let lastFavicon = '';
/** The tab icon follows the chosen accent colour (same mark as the logo). */
function updateFavicon(root: HTMLElement) {
  const cs = getComputedStyle(root);
  const bg = cs.getPropertyValue('--accent').trim() || '#0f7b5f';
  const fg = cs.getPropertyValue('--accent-ink').trim() || '#ffffff';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="5" fill="${bg}"/><rect x="9.3" y="7.2" width="4.4" height="17.6" rx="2.2" fill="${fg}"/><path d="M15.3 13.2H21.3A6 6 0 1 1 15.3 7.2Z" fill="${fg}"/><path d="M16.6 11.9V5.9A6 6 0 0 1 22.6 11.9Z" fill="${fg}" fill-opacity=".72"/></svg>`;
  if (svg === lastFavicon) return;
  lastFavicon = svg;
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  // replace the element: some browsers ignore an href change on an existing icon link
  document.querySelectorAll('link[rel~="icon"]').forEach((l) => l.remove());
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = href;
  document.head.appendChild(link);
}

export function applyAppearance(s: Settings) {
  const root = document.documentElement;
  const dark = resolvedDark(s);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.density = s.density;
  applyAccent(s.accent, dark, root);
  updateFavicon(root);
  root.style.setProperty('--fs-base', `${s.fontSize}px`);
  root.style.setProperty('--font-grid', GRID_FONTS[s.gridFont] ?? GRID_FONTS.system);
  root.lang = s.language;
  root.dataset.reducedMotion = reducedMotion() ? 'true' : 'false';
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', dark ? '#191816' : '#f9f8f5');
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
