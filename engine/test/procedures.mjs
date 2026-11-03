// Runs a broad set of PSPP procedures through the WASM engine on the
// example data files and checks that each produces output without errors
// or crashes.  Usage: node engine/test/procedures.mjs [path/to/pspp.js]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEngine } from '../js/engine.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const modPath = path.resolve(process.argv[2] || path.join(here, '../../web/public/engine/pspp.js'));
const { default: createPspp } = await import(pathToFileURL(modPath).href);
const exdir = path.join(here, '../pspp/examples');
const flat = (items) => items.flatMap((i) => (i.kind === 'group' ? [i, ...flat(i.children)] : [i]));

const cases = [
  ['physiology.sav', 'EXAMINE height weight BY sex /PLOT=BOXPLOT HISTOGRAM NPPLOT SPREADLEVEL /STATISTICS=ALL.'],
  ['physiology.sav', 'CORRELATIONS /VARIABLES=height weight temperature /PRINT=TWOTAIL.'],
  ['physiology.sav', 'REGRESSION /VARIABLES=height temperature /DEPENDENT=weight /STATISTICS=ALL.'],
  ['physiology.sav', 'ONEWAY weight BY sex /STATISTICS=DESCRIPTIVES HOMOGENEITY /POSTHOC=BONFERRONI.'],
  ['physiology.sav', 'GLM weight BY sex /DESIGN=sex.'],
  ['physiology.sav', 'LOGISTIC REGRESSION sex WITH height weight.'],
  ['physiology.sav', 'NPAR TESTS /MANN-WHITNEY=height BY sex(0 1) /KOLMOGOROV-SMIRNOV(NORMAL)=weight /WILCOXON=height WITH weight (PAIRED).'],
  ['physiology.sav', 'ROC height BY sex(1) /PLOT=CURVE(REFERENCE) /PRINT=SE COORDINATES.'],
  ['physiology.sav', 'QUICK CLUSTER height weight /CRITERIA=CLUSTERS(3).'],
  ['physiology.sav', 'MEANS height weight BY sex /CELLS=MEAN COUNT STDDEV.'],
  ['physiology.sav', 'T-TEST /TESTVAL=170 /VARIABLES=height.'],
  ['physiology.sav', 'T-TEST PAIRS=height WITH weight (PAIRED).'],
  ['physiology.sav', 'GRAPH /HISTOGRAM(NORMAL)=height.\nGRAPH /SCATTERPLOT(BIVARIATE)=height WITH weight BY sex.\nGRAPH /BAR=MEAN(weight) BY sex.'],
  ['physiology.sav', 'RANK height /NTILES(4) /PRINT=YES.\nLIST /CASES=FROM 1 TO 5.'],
  ['physiology.sav', 'AGGREGATE OUTFILE=* MODE=ADDVARIABLES /BREAK=sex /mh=MEAN(height).\nDESCRIPTIVES mh.'],
  ['physiology.sav', 'RECODE height (LO THRU 170=1) (ELSE=2) INTO hgrp.\nCROSSTABS sex BY hgrp /STATISTICS=CHISQ PHI /CELLS=COUNT ROW EXPECTED.'],
  ['physiology.sav', 'FREQUENCIES sex /BARCHART /PIECHART.'],
  ['hotel.sav', 'RELIABILITY /VARIABLES=v1 v2 v3 v4 v5 /MODEL=ALPHA /SUMMARY=TOTAL.'],
  ['hotel.sav', 'FACTOR /VARIABLES=v1 v2 v3 v4 v5 /PLOT=EIGEN /EXTRACTION=PC /ROTATION=VARIMAX /PRINT=INITIAL EXTRACTION ROTATION.'],
  ['hotel.sav', 'NPAR TESTS /FRIEDMAN=v1 v2 v3 /COCHRAN=v4 v5 /KENDALL=v1 v2.'],
  ['personnel.sav', 'AUTORECODE occupation /INTO occ.\nSORT CASES BY salary (D).\nSPLIT FILE BY sex.\nDESCRIPTIVES salary.\nSPLIT FILE OFF.'],
  ['personnel.sav', 'CTABLES /TABLE occupation BY sex [COUNT, COLPCT].'],
  ['personnel.sav', 'COMPUTE age = DATEDIFF($TIME, dob, "years").\nDESCRIPTIVES age salary.'],
  ['repairs.sav', 'NPAR TESTS /K-W=mtbf BY factory(1 3) /MEDIAN=mttr BY factory(1 3) /RUNS(MEDIAN)=duty_cycle /BINOMIAL=environment(2).'],
  ['repairs.sav', 'MATRIX.\nCOMPUTE a = {1, 2; 3, 4}.\nPRINT INV(a).\nEND MATRIX.'],
  ['repairs.sav', 'DISPLAY DICTIONARY.\nSHOW VERSION.'],
];

let failed = 0;
for (const [file, syntax] of cases) {
  const engine = await createEngine(createPspp);
  await engine.open({ name: file, bytes: fs.readFileSync(path.join(exdir, file)) });
  const label = syntax.split('\n').map((l) => l.split(/[\s/]/)[0]).join('+');
  try {
    const r = engine.runRaw(syntax);
    const items = flat(r.items);
    const errs = items.filter((i) => i.kind === 'message' && i.severity === 'error');
    const tables = items.filter((i) => i.kind === 'table').length;
    const charts = items.filter((i) => i.kind === 'chart').map((i) => i.chart.type);
    const texts = items.filter((i) => i.kind === 'text').length;
    const bad = errs.length || (tables === 0 && charts.length === 0 && texts === 0);
    if (bad) failed++;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${label}: ${tables} tables${charts.length ? ', charts ' + charts.join(',') : ''}${errs.length ? ' :: ' + errs.map((e) => e.text).join(' | ').slice(0, 300) : ''}`);
  } catch (e) {
    failed++;
    console.log(`CRASH ${label}: ${e.message}`);
  }
}
console.log(failed ? `${failed} problem(s)` : 'all ok');
process.exit(failed ? 1 : 0);
