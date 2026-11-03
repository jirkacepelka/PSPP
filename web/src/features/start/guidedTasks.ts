/*
 * Guided sample tasks for beginners (audit ST-1 / F16): a question in plain words, the sample it
 * uses and the pre-filled dialog that answers it.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import i18n from '../../i18n';
import { openDialog } from '../../app/actions';
import { openSample, type SampleId } from '../../app/files';
import { useUi } from '../../store/ui';

export interface GuidedTask {
  id: string;
  sample: SampleId;
  /** i18n key prefix: <key>.q (question), <key>.method (method name) */
  key: string;
  icon: string;
  specId: string;
  preset: Record<string, unknown>;
}

export const GUIDED_TASKS: GuidedTask[] = [
  { id: 'st-satisf', sample: 'students', key: 'shell.tasks.stSatisf', icon: 'bar_chart', specId: 'frequencies', preset: { variables: ['satisf'] } },
  { id: 'st-gpa', sample: 'students', key: 'shell.tasks.stGpa', icon: 'compare_arrows', specId: 'ttestIndependent', preset: { variables: ['gpa'], group: ['gender'], define: 'values', g1: '1', g2: '2' } },
  { id: 'st-stress', sample: 'students', key: 'shell.tasks.stStress', icon: 'scatter_plot', specId: 'correlations', preset: { variables: ['stress', 'sleep', 'hours'] } },
  { id: 'em-salary', sample: 'employees', key: 'shell.tasks.emSalary', icon: 'functions', specId: 'descriptives', preset: { variables: ['salary', 'salbegin'] } },
  { id: 'em-jobcat', sample: 'employees', key: 'shell.tasks.emJobcat', icon: 'stacked_bar_chart', specId: 'oneway', preset: { dependents: ['salary'], factor: ['jobcat'], descriptives: true } },
  { id: 'em-predict', sample: 'employees', key: 'shell.tasks.emPredict', icon: 'trending_up', specId: 'regressionLinear', preset: { dependent: ['salary'], independents: ['educ', 'salbegin'] } },
  { id: 'tr-drop', sample: 'trial', key: 'shell.tasks.trDrop', icon: 'trending_down', specId: 'ttestPaired', preset: { pairs: [{ a: 'sbp0', b: 'sbp8' }] } },
  { id: 'tr-drug', sample: 'trial', key: 'shell.tasks.trDrug', icon: 'medication', specId: 'oneway', preset: { dependents: ['sbp8'], factor: ['group'], descriptives: true, ph_TUKEY: true } },
  { id: 'tr-smoke', sample: 'trial', key: 'shell.tasks.trSmoke', icon: 'table_chart', specId: 'crosstabs', preset: { rows: ['group'], cols: ['smoker'] } },
];

export function runGuidedTask(task: GuidedTask) {
  void openSample(task.sample, () => {
    openDialog(task.specId, task.preset);
    useUi.getState().toast(i18n.t('shell.tasks.started', { question: i18n.t(`${task.key}.q`) }));
  });
}
