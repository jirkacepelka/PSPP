// Lists i18n keys referenced in the source and checks them against cs.json/en.json.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('../src/', import.meta.url).pathname;
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts')) files.push(p); } })(root);
const PREFIXES = ['common','menu','actions','views','appbar','profile','settings','status','engine','toolbar','formula','data','variables','varType','align','measure','role','typeDialog','valueLabels','missing','dialogs','dlg','stat','agg','output','syntax','start','samples','files','run','palette','goto','find','saveAs','about','shortcuts'];
const IGNORE = new Set(['data.csv', 'data.sav', 'settings.v1', 'syntax.runAll', 'syntax.runCurrent', 'syntax.runSelection', 'syntax.runToEnd', 'syntax.save', 'settings.xml', 'content.xml']);
const keys = new Set();
const re = /['"`]((?:[a-z][A-Za-z]*)(?:\.[A-Za-z0-9_]+)+)['"`]/g;
for (const f of files) { const s = readFileSync(f, 'utf8'); let m; while ((m = re.exec(s))) { const k = m[1]; if (PREFIXES.includes(k.split('.')[0]) && !IGNORE.has(k)) keys.add(k); } }
const get = (o, k) => k.split('.').reduce((a, p) => (a && typeof a === 'object' ? a[p] : undefined), o);
const out = { keys: [...keys].sort() };
for (const lang of ['cs', 'en']) {
  // base catalog deep-merged with src/i18n/fragments/*.<lang>.json, as the app does
  const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return a; };
  const j = JSON.parse(readFileSync(join(root, 'i18n', `${lang}.json`), 'utf8'));
  const fdir = join(root, 'i18n', 'fragments');
  for (const f of readdirSync(fdir).filter((f) => f.endsWith(`.${lang}.json`)).sort()) merge(j, JSON.parse(readFileSync(join(fdir, f), 'utf8')));
  out[lang] = out.keys.filter((k) => get(j, k) === undefined && get(j, `${k}_one`) === undefined && get(j, `${k}_other`) === undefined);
}
if (process.argv[2] === 'list') console.log(out.keys.join('\n'));
else { console.log('missing cs:', out.cs.length, out.cs.join(' ')); console.log('missing en:', out.en.length, out.en.join(' ')); process.exit(out.cs.length + out.en.length ? 1 : 0); }
