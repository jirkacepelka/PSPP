// Smoke test for the PSPP WebAssembly engine.
// Usage: node engine/test/smoke.mjs [path/to/pspp.js]
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEngine } from '../js/engine.mjs';

const modPath = path.resolve(process.argv[2] || new URL('../../web/public/engine/pspp.js', import.meta.url).pathname);
const { default: createPspp } = await import(pathToFileURL(modPath).href);
const engine = await createEngine(createPspp);

const { version } = await engine.init();
console.log('version:', version);

// 1. Inline data + procedures.
let r = await engine.run(`
DATA LIST LIST /id (F3) score (F5.1) group (A1).
BEGIN DATA
1 12.5 a
2 15.0 b
3 9.5 a
4 20.0 b
5 . a
END DATA.
VARIABLE LABELS score 'Test score'.
VALUE LABELS group 'a' 'Control' 'b' 'Treatment'.
FREQUENCIES group /STATISTICS=ALL.
DESCRIPTIVES score.
T-TEST GROUPS=group('a' 'b') /VARIABLES=score.
`, null);
const flat = (items) => items.flatMap((i) => (i.kind === 'group' ? [i, ...flat(i.children)] : [i]));
let items = flat(r.items);
const errs = items.filter((i) => i.kind === 'message' && i.severity === 'error');
assert.equal(errs.length, 0, JSON.stringify(errs));
const tables = items.filter((i) => i.kind === 'table');
console.log('tables:', tables.map((t) => t.title).join(' | '));
assert.ok(tables.length >= 4);
assert.match(tables[0].html, /<table/);
assert.equal(r.dataset.variables.length, 3);
assert.deepEqual(r.dataset.columns[1], [12.5, 15, 9.5, 20, null]);
assert.equal(r.dataset.variables[1].label, 'Test score');
assert.equal(r.dataset.variables[2].valueLabels[1].label, 'Treatment');

// 2. Transformation round-trips back into the dataset.
r = await engine.run('COMPUTE double = score * 2.\nEXECUTE.', r.dataset);
assert.deepEqual(r.dataset.columns[3], [25, 30, 19, 40, null]);

// 3. Editing in JS, then running against the edited dataset.
const edited = structuredClone(r.dataset);
edited.columns[1][4] = 30;
r = await engine.run('DESCRIPTIVES score /STATISTICS=MEAN.', edited);
assert.ok(flat(r.items).some((i) => i.kind === 'table' && /17\.40/.test(i.html)), 'mean 17.40');

// 4. Errors carry line numbers.
r = await engine.run('FREQUENCIES nosuchvar.', r.dataset);
const e = flat(r.items).find((i) => i.kind === 'message' && i.severity === 'error');
assert.ok(e && e.line === 1, JSON.stringify(e));
assert.equal(r.ok, false);

// 5. Charts serialize to JSON.
r = await engine.run('FREQUENCIES score /FORMAT=NOTABLE /HISTOGRAM=NORMAL.\nGRAPH /BAR=COUNT BY group.\nGRAPH /SCATTERPLOT(BIVARIATE)=score WITH id.', r.dataset);
const charts = flat(r.items).filter((i) => i.kind === 'chart');
console.log('charts:', charts.map((c) => c.chart.type).join(', '));
assert.deepEqual(charts.map((c) => c.chart.type), ['histogram', 'bar', 'scatter']);

// 6. Save and re-open .sav / .por / .csv.
for (const fmt of ['sav', 'zsav', 'por', 'csv']) {
  const bytes = await engine.save(r.dataset, fmt);
  assert.ok(bytes.length > 50, fmt);
  if (fmt !== 'csv') {
    const o = await engine.open({ name: `test.${fmt}`, bytes });
    assert.ok(o.dataset, `reopen ${fmt}: ${JSON.stringify(o.items)}`);
    assert.equal(o.dataset.columns[0].length, 5);
    assert.equal(o.dataset.variables[1].label, 'Test score');
  }
}
console.log('OK');
