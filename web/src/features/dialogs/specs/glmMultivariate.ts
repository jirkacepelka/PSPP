/*
 * General linear model – multivariate (several dependent variables, MANOVA). Runs as the GLM
 * extension analysis (src/ext/commands/glm.ts).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogSpec } from '../types';
import { command, vars, wrap } from '../syntaxUtil';
import { glmOptions, glmOptionSubs, glmPlot, glmPlotSub } from './glmRepeated';

export const glmMultivariate: DialogSpec = {
  id: 'glmMultivariate',
  kind: 'analysis',
  title: 'dlg.glmMultivariate.title',
  icon: 'view_column',
  command: 'GLM',
  fields: [
    { kind: 'varlist', id: 'dependents', label: 'dlg.glmMultivariate.dependents', filter: 'numeric', min: 2, prefer: ['scale'] },
    { kind: 'varlist', id: 'factors', label: 'dlg.glmMultivariate.factors', prefer: ['nominal', 'ordinal'], groups: true },
    { kind: 'varlist', id: 'covariates', label: 'dlg.glmMultivariate.covariates', filter: 'numeric', prefer: ['scale'] },
    {
      kind: 'radio',
      id: 'design',
      label: 'dlg.glm.design',
      default: 'full',
      inline: true,
      options: [
        { value: 'full', label: 'dlg.glm.full' },
        { value: 'main', label: 'dlg.glm.main' },
      ],
    },
    glmPlot,
    glmOptions,
  ],
  toSyntax: (v) => {
    const f = vars(v, 'factors');
    const c = vars(v, 'covariates');
    return command('GLM', wrap([...vars(v, 'dependents'), ...(f.length ? ['BY', ...f] : []), ...(c.length ? ['WITH', ...c] : [])]), [
      'METHOD=SSTYPE(3)',
      'INTERCEPT=INCLUDE',
      ...glmOptionSubs(v, f),
      glmPlotSub(v, f[0], f[1]),
      v.design === 'main' && f.length > 1 && wrap([`DESIGN=${[...c, ...f].join(' ')}`]),
    ]);
  },
};
