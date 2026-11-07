import { it } from 'vitest';
import { makeVariable } from '../../lib/variables';
import type { Dataset } from '../../engine/types';
import { runExt, tables, flatItems } from '../testing';
const ds: Dataset = {
  name: 't',
  variables: ['g', 't1', 't2', 't3'].map((n) => makeVariable(n)),
  columns: [
    [1, 1, 1, 1, 2, 2, 2, 2, 2],
    [10, 12, 9, 14, 8, 7, 11, 9, 10],
    [13, 15, 11, 15, 9, 9, 12, 10, 12],
    [16, 18, 15, 17, 9, 11, 12, 10, 14],
  ],
};
it('scratch', () => {
  const out = runExt(process.env.SYN ?? 'GLM t1 t2 t3 BY g /WSFACTOR=time 3 /PRINT=DESCRIPTIVE ETASQ HOMOGENEITY PARAMETER /EMMEANS=TABLES(time) COMPARE ADJ(BONFERRONI) /EMMEANS=TABLES(g*time) COMPARE(g).', ds);
  for (const i of flatItems(out)) if (i.kind === 'message') console.log('MSG', i.text);
  for (const t of tables(out)) {
    console.log('== ' + t.caption);
    for (const r of t.rows) console.log(r.map((c) => c.text).join(' | '));
    for (const f of t.footnotes) console.log('  ' + f);
  }
});
