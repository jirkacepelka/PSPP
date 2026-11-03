/* SPDX-License-Identifier: GPL-3.0-or-later */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import cs from './cs.json';
import en from './en.json';
import { detectLanguage } from '../store/settings';
import { chartStrings } from '../charts/strings';

type Tree = { [k: string]: string | Tree };

/** Deep-merges B into A (B wins), returning a new object. */
function merge(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = typeof v === 'object' && typeof cur === 'object' ? merge(cur, v) : v;
  }
  return out;
}

/*
 * Feature areas keep their own strings in fragments/<area>.<lang>.json, merged over the base
 * catalogs, so parallel work never edits the same file.
 */
const fragments = import.meta.glob<{ default: Tree }>('./fragments/*.json', { eager: true });
function withFragments(base: Tree, lang: 'cs' | 'en'): Tree {
  return Object.entries(fragments)
    .filter(([path]) => path.endsWith(`.${lang}.json`))
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce((acc, [, mod]) => merge(acc, mod.default), base);
}

export const catalogs = { cs: withFragments(cs as Tree, 'cs'), en: withFragments(en as Tree, 'en') };

void i18n.use(initReactI18next).init({
  resources: {
    cs: { translation: catalogs.cs, charts: chartStrings.cs },
    en: { translation: catalogs.en, charts: chartStrings.en },
  },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
