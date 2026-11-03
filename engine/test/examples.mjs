// Runs every examples/*.sps from the PSPP sources through the WASM engine,
// each in a fresh engine instance, and reports errors and crashes.
// Usage: node engine/test/examples.mjs [path/to/pspp.js]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEngine } from '../js/engine.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const modPath = path.resolve(process.argv[2] || path.join(here, '../../web/public/engine/pspp.js'));
const { default: createPspp } = await import(pathToFileURL(modPath).href);
const exdir = path.join(here, '../pspp/examples');
const flat = (items) => items.flatMap((i) => (i.kind === 'group' ? [i, ...flat(i.children)] : [i]));

let failed = 0;
for (const f of fs.readdirSync(exdir).filter((f) => f.endsWith('.sps')).sort()) {
  const engine = await createEngine(createPspp);
  // Make the example data files available at the same relative paths.
  for (const d of fs.readdirSync(exdir)) {
    if (!d.endsWith('.sps')) engine.FS.writeFile('/work/' + d, fs.readFileSync(path.join(exdir, d)));
  }
  engine.FS.chdir('/work');
  const src = fs.readFileSync(path.join(exdir, f), 'utf8');
  try {
    const r = engine.runRaw(src);
    const items = flat(r.items);
    const errs = items.filter((i) => i.kind === 'message' && i.severity === 'error');
    const counts = ['table', 'chart', 'text'].map((k) => `${items.filter((i) => i.kind === k).length} ${k}`).join(', ');
    console.log(`${errs.length ? 'ERR ' : 'ok  '} ${f}: ${counts}${errs.length ? ' :: ' + errs.map((e) => e.text).join(' | ').slice(0, 300) : ''}`);
    if (errs.length) failed++;
  } catch (e) {
    console.log(`CRASH ${f}: ${e.message}`);
    failed++;
  }
}
console.log(failed ? `${failed} file(s) with problems` : 'all ok');
