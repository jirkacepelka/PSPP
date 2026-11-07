import { it } from 'vitest';
import students from '../../samples/students.json';
import type { Dataset } from '../../engine/types';
import { runExt, tables, flatItems } from '../testing';
it('smoke', () => {
  const out = runExt('DISCRIMINANT /GROUPS=faculty(1,5) /VARIABLES=hours sleep stress gpa /STATISTICS=ALL /PLOT=COMBINED CASES(3) /SAVE=CLASS SCORES PROBS.', students as unknown as Dataset);
  for (const i of flatItems(out)) if (i.kind === 'message') console.log(i.text);
  for (const t of tables(out)) console.log(t.caption + '\n' + t.rows.map((r) => r.map((c) => c.text).join(' | ')).join('\n') + '\n' + t.footnotes.join('\n'));
  const o2 = runExt('DISCRIMINANT /GROUPS=faculty(1,5) /VARIABLES=hours sleep stress gpa /METHOD=WILKS /FIN=1 /FOUT=0.5.', students as unknown as Dataset);
  for (const t of tables(o2)) console.log(t.caption + '\n' + t.rows.map((r) => r.map((c) => c.text).join(' | ')).join('\n'));
});
