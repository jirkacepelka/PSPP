import { it } from 'vitest';
import students from '../../samples/students.json';
import type { Dataset } from '../../engine/types';
import { runExt, tables, flatItems } from '../testing';
const ds = students as unknown as Dataset;
it('smoke', () => {
  for (const s of [
    'PLUM satisf BY faculty WITH hours gpa /PRINT=FIT PARAMETER SUMMARY TPARALLEL.',
    'NOMREG commute BY gender WITH gpa /PRINT=PARAMETER SUMMARY LRT FIT CLASSTABLE CPS MFI.',
  ]) {
    const out = runExt(s, ds);
    for (const i of flatItems(out)) if (i.kind === 'message') console.log('MSG', i.severity, i.text);
    for (const t of tables(out)) {
      console.log('== ' + t.caption);
      for (const r of t.rows) console.log(r.map((c) => c.text).join(' | '));
      for (const f of t.footnotes) console.log('  ' + f);
    }
  }
});
