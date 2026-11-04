/*
 * Registry of declarative analysis dialogs. Add a new spec file and list it here.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { DialogSpec } from '../types';
import { frequencies } from './frequencies';
import { descriptives } from './descriptives';
import { explore } from './explore';
import { crosstabs } from './crosstabs';
import { means } from './means';
import { ttestOneSample } from './ttestOneSample';
import { ttestIndependent } from './ttestIndependent';
import { ttestPaired } from './ttestPaired';
import { oneway } from './oneway';
import { correlations } from './correlations';
import { partialCorr } from './partialCorr';
import { regressionLinear } from './regressionLinear';
import { compute } from './compute';
import { recodeSame } from './recodeSame';
import { recodeDifferent } from './recodeDifferent';
import { count } from './count';
import { rank } from './rank';
import { autorecode } from './autorecode';
import { sortCases } from './sortCases';
import { selectCases } from './selectCases';
import { weightCases } from './weightCases';
import { splitFile } from './splitFile';
import { aggregate } from './aggregate';
import { transpose } from './transpose';
import { binomial, chiSquare, cochran, friedman, jonckheere, kruskalWallis, ksNormal, mannWhitney, mcnemar, medianTest, runs, wilcoxon } from './nonparametric';
import { roc } from './roc';
import { km } from './km';
import { factor, quickCluster, reliability } from './scale';
import { hierCluster } from './cluster';
import { glm, logistic } from './models';
import { plum } from './plum';
import { nomreg } from './nomreg';
import { ctables, variableProperties } from './tables';
import { barChart, boxplot, histogram, scatter } from './graphs';

export const DIALOG_SPECS: DialogSpec[] = [
  frequencies, descriptives, explore, crosstabs, ctables,
  means, ttestOneSample, ttestIndependent, ttestPaired, oneway, glm,
  correlations, partialCorr, regressionLinear, logistic, plum, nomreg,
  factor, reliability, quickCluster, hierCluster,
  chiSquare, binomial, runs, ksNormal, mannWhitney, medianTest, kruskalWallis, jonckheere, wilcoxon, mcnemar, friedman, cochran, roc, km,
  histogram, barChart, scatter, boxplot,
  compute, recodeSame, recodeDifferent, count, rank, autorecode,
  sortCases, selectCases, weightCases, splitFile, aggregate, transpose, variableProperties,
];

export const SPECS_BY_ID: Record<string, DialogSpec> = Object.fromEntries(DIALOG_SPECS.map((s) => [s.id, s]));
