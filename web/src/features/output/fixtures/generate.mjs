// Generates real PSPP output fixtures (English and Czech) for the interpretation tests.
// Usage: node src/features/output/fixtures/generate.mjs   (from web/)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../../../..');
const { createEngine } = await import(pathToFileURL(path.resolve(web, '../engine/js/engine.mjs')).href);
const { default: createPspp } = await import(pathToFileURL(path.resolve(web, 'public/engine/pspp.js')).href);
const students = JSON.parse(fs.readFileSync(path.resolve(web, 'src/samples/students.json'), 'utf8'));
const trial = JSON.parse(fs.readFileSync(path.resolve(web, 'src/samples/trial.json'), 'utf8'));

const CASES = {
  ttestIndependent: [students, 'T-TEST GROUPS=gender(1, 2) /VARIABLES=gpa.'],
  ttestPaired: [trial, 'T-TEST PAIRS=sbp0 WITH sbp8 (PAIRED).'],
  ttestOneSample: [students, 'T-TEST TESTVAL=7 /VARIABLES=sleep.'],
  oneway: [students, 'ONEWAY stress BY faculty /STATISTICS=DESCRIPTIVES HOMOGENEITY.'],
  correlations: [students, 'CORRELATIONS /VARIABLES=hours sleep stress gpa /PRINT=TWOTAIL NOSIG.'],
  crosstabs: [students, 'CROSSTABS /TABLES=gender BY job /STATISTICS=CHISQ PHI /CELLS=COUNT ROW.'],
  regression: [students, 'REGRESSION /VARIABLES=hours sleep stress /DEPENDENT=gpa /METHOD=ENTER /STATISTICS=COEFF R ANOVA.'],
  frequencies: [students, 'FREQUENCIES faculty satisf /STATISTICS=MEAN MEDIAN MODE STDDEV.'],
  descriptives: [students, 'DESCRIPTIVES age hours sleep gpa.'],
  mannWhitney: [students, 'NPAR TESTS /M-W=gpa BY gender(1, 2).'],
  kruskalWallis: [students, 'NPAR TESTS /K-W=stress BY faculty(1, 5).'],
  wilcoxon: [trial, 'NPAR TESTS /WILCOXON=sbp0 WITH sbp8 (PAIRED).'],
  chisquare: [students, 'NPAR TESTS /CHISQUARE=faculty.'],
  reliability: [trial, "RELIABILITY /VARIABLES=sbp0 sbp4 sbp8 /SCALE('All')=ALL /MODEL=ALPHA."],
};

async function run(lang) {
  const engine = await createEngine(createPspp);
  await engine.init();
  if (lang === 'cs') await engine.setLanguage('cs', fs.readFileSync(path.resolve(web, 'public/engine/locale/cs/pspp.mo')));
  const out = {};
  for (const [k, [ds, syntax]] of Object.entries(CASES)) {
    const r = await engine.run(syntax, ds);
    const flat = (items) => items.flatMap((i) => (i.kind === 'group' ? flat(i.children) : [i]));
    const items = flat(r.items);
    const errs = items.filter((i) => i.kind === 'message' && i.severity === 'error');
    if (errs.length) console.error(lang, k, errs.map((e) => e.text));
    out[k] = { syntax, tables: items.filter((i) => i.kind === 'table').map((t) => ({ title: t.title, html: t.html })) };
  }
  return out;
}

const result = { en: await run('en'), cs: await run('cs') };
fs.writeFileSync(path.join(here, 'tables.json'), JSON.stringify(result, null, 1));
console.log('wrote', Object.keys(result.en).length, 'cases');
