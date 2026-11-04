/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import { DIALOG_SPECS, SPECS_BY_ID } from './specs';
import { defaultValues, validateGeneric, type DialogContext, type Values } from './types';
import { makeVariable } from '../../lib/variables';
import { splitCommands } from '../../lib/syntax';
import { commandName } from '../../lib/commands';

const ctx: DialogContext = {
  variables: [
    makeVariable('age'),
    makeVariable('income'),
    makeVariable('score'),
    makeVariable('gender', { measure: 'nominal' }),
    makeVariable('group', { measure: 'nominal' }),
    makeVariable('city', { type: 'string', width: 12 }),
  ],
};

const NEW_FILLED: Record<string, Values> = {
  mannWhitney: { variables: ['score'], group: ['gender'], g1: '1', g2: '2' },
  kruskalWallis: { variables: ['score'], group: ['group'], lo: 1, hi: 3 },
  wilcoxon: { pairs: [{ a: 'age', b: 'score' }] },
  friedman: { variables: ['age', 'score', 'income'] },
  runs: { variables: ['age'] },
  mcnemar: { pairs: [{ a: 'gender', b: 'group' }] },
  cochran: { variables: ['gender', 'group'] },
  medianTest: { variables: ['score'], group: ['group'], lo: 1, hi: 3 },
  jonckheere: { variables: ['score'], group: ['group'], lo: 1, hi: 3 },
  roc: { variables: ['score'], state: ['gender'], positive: '1' },
  km: { time: ['age'], status: ['gender'], eventValue: '1', factor: ['group'], logrank: true },
  chiSquare: { variables: ['group'] },
  binomial: { variables: ['gender'] },
  ksNormal: { variables: ['age'] },
  reliability: { items: ['age', 'score', 'income'] },
  factor: { variables: ['age', 'score', 'income'] },
  quickCluster: { variables: ['age', 'score'] },
  hierCluster: { variables: ['age', 'score'] },
  logistic: { dependent: ['gender'], covariates: ['age'] },
  glm: { dependent: ['score'], factors: ['gender'] },
  ctables: { rows: ['gender'], cols: ['group'] },
  histogram: { variable: ['age'] },
  barChart: { category: ['group'] },
  scatter: { y: ['score'], x: ['age'] },
  boxplot: { variables: ['score'], factor: ['group'] },
  variableProperties: { variables: ['gender'], measure: 'NOMINAL' },
  partialCorr: { variables: ['age', 'score'], controls: ['income'] },
};

function gen(id: string, patch: Values): string {
  const spec = SPECS_BY_ID[id];
  const values = { ...defaultValues(spec), ...patch };
  return spec.toSyntax(values, ctx);
}

function errors(id: string, patch: Values): string | null {
  const spec = SPECS_BY_ID[id];
  const values = { ...defaultValues(spec), ...patch };
  return validateGeneric(spec, values) ?? spec.validate?.(values, ctx) ?? null;
}

describe('dialog specs', () => {
  it('registers unique ids with i18n titles', () => {
    const ids = DIALOG_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of DIALOG_SPECS) expect(s.title).toMatch(/^dlg\./);
  });

  it('every command emitted is a known PSPP command and terminated', () => {
    const filled: Record<string, Values> = {
      frequencies: { variables: ['age'] },
      descriptives: { variables: ['age'] },
      explore: { dependents: ['age'] },
      crosstabs: { rows: ['gender'], cols: ['group'] },
      means: { dependents: ['income'], layer1: ['gender'] },
      ttestOneSample: { variables: ['age'] },
      ttestIndependent: { variables: ['age'], group: ['gender'] },
      ttestPaired: { pairs: [{ a: 'age', b: 'score' }] },
      oneway: { dependents: ['score'], factor: ['group'] },
      correlations: { variables: ['age', 'income'] },
      regressionLinear: { dependent: ['income'], independents: ['age'] },
      compute: { target: 'x', expression: 'age * 2' },
      recodeSame: { variables: ['age'], map: [{ from: '1 thru 5', to: '1' }] },
      recodeDifferent: { pairs: [{ src: 'age', dst: 'agecat', label: '' }], map: [{ from: 'else', to: 'copy' }] },
      count: { target: 'n1', variables: ['age', 'score'], values: [{ value: '1' }] },
      rank: { variables: ['score'] },
      autorecode: { pairs: [{ src: 'city', dst: 'city_n' }] },
      sortCases: { by: ['age'] },
      selectCases: { condition: 'age > 1' },
      weightCases: { weight: ['income'] },
      splitFile: { groups: ['gender'] },
      aggregate: { break: ['group'], functions: [{ target: 'm', func: 'MEAN', source: 'age', label: '' }] },
      transpose: { variables: ['age'] },
      ...NEW_FILLED,
    };
    for (const spec of DIALOG_SPECS) {
      const patch = filled[spec.id];
      expect(patch, `test data for ${spec.id}`).toBeDefined();
      expect(errors(spec.id, patch), `validation of ${spec.id}`).toBeNull();
      const syntax = gen(spec.id, patch);
      const cmds = splitCommands(syntax);
      expect(cmds.length).toBeGreaterThan(0);
      for (const c of cmds) {
        expect(c.text.trimEnd().endsWith('.'), `${spec.id}: ${c.text}`).toBe(true);
        expect(commandName(c.text), `${spec.id}: ${c.text}`).not.toBeNull();
      }
    }
  });

  it('requires variables', () => {
    expect(errors('frequencies', {})).toBe('dlg.errors.needVariables');
    expect(errors('correlations', { variables: ['age'] })).not.toBeNull();
  });
});

describe('Descriptive statistics', () => {
  it('FREQUENCIES defaults', () => {
    expect(gen('frequencies', { variables: ['age', 'gender'] })).toBe('FREQUENCIES\n  /VARIABLES=age gender\n  /STATISTICS=DEFAULT.');
  });
  it('FREQUENCIES with options', () => {
    const s = gen('frequencies', {
      variables: ['age'], tables: false, order: 'DFREQ', st_MEDIAN: true, st_MODE: true, quartiles: true, percentiles: '10, 90', ntiles: 5, chart: 'histogram', normal: true, includeMissing: true,
    });
    expect(s).toBe(
      'FREQUENCIES\n  /VARIABLES=age\n  /FORMAT=NOTABLE DFREQ\n  /STATISTICS=MEAN MEDIAN MODE STDDEV MINIMUM MAXIMUM\n  /PERCENTILES=10 25 50 75 90\n  /NTILES=5\n  /HISTOGRAM=NORMAL FREQ\n  /MISSING=INCLUDE.',
    );
  });
  it('FREQUENCIES no statistics, bar chart percent', () => {
    const s = gen('frequencies', { variables: ['gender'], st_MEAN: false, st_STDDEV: false, st_MINIMUM: false, st_MAXIMUM: false, chart: 'bar', chartValues: 'PERCENT' });
    expect(s).toContain('/STATISTICS=NONE');
    expect(s).toContain('/BARCHART=PERCENT');
  });
  it('DESCRIPTIVES', () => {
    expect(gen('descriptives', { variables: ['age', 'income'], save: true, st_SKEWNESS: true, listwise: true })).toBe(
      'DESCRIPTIVES\n  /VARIABLES=age income\n  /SAVE\n  /STATISTICS=MEAN STDDEV MIN MAX SKEWNESS\n  /MISSING=LISTWISE.',
    );
  });
  it('EXAMINE', () => {
    expect(gen('explore', { dependents: ['score'], factors: ['gender'], id: ['age'], histogram: true, ci: 99 })).toBe(
      'EXAMINE VARIABLES=score BY gender\n  /ID=age\n  /STATISTICS=DESCRIPTIVES\n  /PLOT=BOXPLOT HISTOGRAM\n  /COMPARE=GROUPS\n  /CINTERVAL 99\n  /MISSING=LISTWISE.',
    );
    expect(gen('explore', { dependents: ['score'], display: 'stats' })).toContain('/PLOT=NONE');
  });
  it('CROSSTABS', () => {
    expect(gen('crosstabs', { rows: ['gender'], cols: ['group'], layers: ['city'], st_CHISQ: true, c_ROW: true, barchart: true })).toBe(
      'CROSSTABS\n  /TABLES=gender BY group BY city\n  /FORMAT=AVALUE TABLES\n  /STATISTICS=CHISQ\n  /CELLS=COUNT ROW\n  /BARCHART.',
    );
  });
});

describe('Compare means', () => {
  it('MEANS', () => {
    expect(gen('means', { dependents: ['income'], layer1: ['gender'], layer2: ['group'] })).toBe('MEANS TABLES=income BY gender BY group\n  /CELLS=MEAN COUNT STDDEV.');
  });
  it('T-TEST one sample', () => {
    expect(gen('ttestOneSample', { variables: ['age'], testValue: 30 })).toBe('T-TEST\n  /TESTVAL=30\n  /VARIABLES=age\n  /MISSING=ANALYSIS\n  /CRITERIA=CI(0.95).');
  });
  it('T-TEST independent', () => {
    expect(gen('ttestIndependent', { variables: ['score'], group: ['gender'], g1: '1', g2: '2', ci: 90 })).toBe(
      'T-TEST\n  /GROUPS=gender(1, 2)\n  /VARIABLES=score\n  /MISSING=ANALYSIS\n  /CRITERIA=CI(0.9).',
    );
    expect(gen('ttestIndependent', { variables: ['score'], group: ['city'], g1: 'Brno', g2: 'Praha' })).toContain("/GROUPS=city('Brno', 'Praha')");
    expect(gen('ttestIndependent', { variables: ['score'], group: ['age'], define: 'cut', cut: 40 })).toContain('/GROUPS=age(40)');
    expect(errors('ttestIndependent', { variables: ['score'], group: ['age'], define: 'cut', cut: null })).toBe('dlg.errors.cutPoint');
  });
  it('T-TEST paired', () => {
    expect(gen('ttestPaired', { pairs: [{ a: 'age', b: 'score' }, { a: 'income', b: 'score' }] })).toBe(
      'T-TEST\n  /PAIRS=age income WITH score score (PAIRED)\n  /MISSING=ANALYSIS\n  /CRITERIA=CI(0.95).',
    );
    expect(errors('ttestPaired', { pairs: [{ a: 'age', b: '' }] })).toBe('dlg.errors.pairs');
  });
  it('ONEWAY', () => {
    expect(gen('oneway', { dependents: ['score'], factor: ['group'], descriptives: true, ph_TUKEY: true, ph_BONFERRONI: true, contrasts: [{ coef: '-1 1 0' }] })).toBe(
      'ONEWAY\n  /VARIABLES=score BY group\n  /STATISTICS=DESCRIPTIVES\n  /POSTHOC=BONFERRONI TUKEY\n  /CONTRAST=-1 1 0\n  /MISSING=ANALYSIS.',
    );
  });
});

describe('Correlate & regression', () => {
  it('CORRELATIONS', () => {
    expect(gen('correlations', { variables: ['age', 'income', 'score'], descriptives: true })).toBe(
      'CORRELATIONS\n  /VARIABLES=age income score\n  /PRINT=TWOTAIL NOSIG\n  /STATISTICS=DESCRIPTIVES\n  /MISSING=PAIRWISE.',
    );
  });
  it('REGRESSION', () => {
    expect(gen('regressionLinear', { dependent: ['income'], independents: ['age', 'score'], ci: true, pred: true, resid: true })).toBe(
      'REGRESSION\n  /VARIABLES=age score\n  /DEPENDENT=income\n  /METHOD=ENTER\n  /STATISTICS=COEFF R ANOVA CI(95)\n  /SAVE=PRED RESID.',
    );
  });
});

describe('Transform', () => {
  it('COMPUTE', () => {
    expect(gen('compute', { target: 'bmi', expression: 'weight / (height/100)**2', label: 'Body mass index' })).toBe(
      "COMPUTE bmi = weight / (height/100)**2.\nVARIABLE LABELS bmi 'Body mass index'.\nEXECUTE.",
    );
    expect(gen('compute', { target: 'adult', expression: '1', condition: 'age >= 18' })).toBe('IF (age >= 18) adult = 1.\nEXECUTE.');
    expect(gen('compute', { target: 'name2', expression: "CONCAT(city, 'x')", type: 'string', width: 20 })).toBe("STRING name2 (A20).\nCOMPUTE name2 = CONCAT(city, 'x').\nEXECUTE.");
    expect(errors('compute', { target: '1abc', expression: 'x' })).toBe('dlg.errors.targetName');
  });
  it('RECODE into same', () => {
    expect(gen('recodeSame', { variables: ['age'], map: [{ from: 'lowest thru 17', to: '1' }, { from: '18 thru highest', to: '2' }, { from: 'missing', to: 'sysmis' }] })).toBe(
      'RECODE age (LOWEST THRU 17=1) (18 THRU HIGHEST=2) (MISSING=SYSMIS).\nEXECUTE.',
    );
    expect(gen('recodeSame', { variables: ['city'], map: [{ from: 'Praha, Prague', to: 'PHA' }] })).toBe("RECODE city ('Praha' 'Prague'='PHA').\nEXECUTE.");
    expect(errors('recodeSame', { variables: ['age', 'city'], map: [{ from: '1', to: '2' }] })).toBe('dlg.errors.mixedTypes');
  });
  it('RECODE into different', () => {
    expect(gen('recodeDifferent', { pairs: [{ src: 'age', dst: 'agecat', label: 'Age category' }], map: [{ from: '0 thru 30', to: '1' }, { from: 'else', to: '2' }] })).toBe(
      "RECODE age (0 THRU 30=1) (ELSE=2) INTO agecat.\nVARIABLE LABELS agecat 'Age category'.\nEXECUTE.",
    );
    expect(gen('recodeDifferent', { pairs: [{ src: 'age', dst: 'agestr', label: '' }], map: [{ from: 'else', to: 'old' }], asString: true, width: 5 })).toBe(
      "STRING agestr (A5).\nRECODE age (ELSE='old') INTO agestr.\nEXECUTE.",
    );
  });
  it('COUNT', () => {
    expect(gen('count', { target: 'n_low', label: 'Low answers', variables: ['age', 'score'], values: [{ value: '1' }, { value: '2 thru 3' }, { value: 'sysmis' }] })).toBe(
      "COUNT n_low = age score (1 2 THRU 3 SYSMIS).\nVARIABLE LABELS n_low 'Low answers'.\nEXECUTE.",
    );
  });
  it('RANK', () => {
    expect(gen('rank', { variables: ['score'], by: ['gender'], f_NTILES: true, k: 4, order: 'D' })).toBe(
      'RANK VARIABLES=score (D) BY gender\n  /RANK\n  /NTILES(4)\n  /TIES=MEAN\n  /PRINT=YES.',
    );
    expect(gen('rank', { variables: ['score'], f_NORMAL: true, fraction: 'VW', print: false })).toContain('/FRACTION=VW\n  /PRINT=NO.');
    expect(errors('rank', { variables: ['score'], f_RANK: false })).toBe('dlg.errors.rankFunction');
  });
  it('AUTORECODE', () => {
    expect(gen('autorecode', { pairs: [{ src: 'city', dst: 'city_n' }], order: 'desc', print: true })).toBe('AUTORECODE VARIABLES=city INTO city_n\n  /DESCENDING\n  /PRINT.');
    expect(errors('autorecode', { pairs: [{ src: 'city', dst: 'age' }] })).toBe('dlg.errors.newTargetName');
  });
});

describe('Data', () => {
  it('SORT CASES', () => {
    expect(gen('sortCases', { by: ['gender', 'age'], order: 'D' })).toBe('SORT CASES BY gender (D) age (D).');
  });
  it('SELECT IF / FILTER', () => {
    expect(gen('selectCases', { condition: 'age > 30' })).toBe(
      "COMPUTE filter_$ = (age > 30).\nVARIABLE LABELS filter_$ 'age > 30 (FILTER)'.\nVALUE LABELS filter_$ 0 'Not selected' 1 'Selected'.\nFORMATS filter_$ (F1.0).\nFILTER BY filter_$.\nEXECUTE.",
    );
    expect(gen('selectCases', { condition: 'age > 30', output: 'delete' })).toBe('SELECT IF (age > 30).\nEXECUTE.');
    expect(gen('selectCases', { mode: 'all' })).toBe('FILTER OFF.\nUSE ALL.\nEXECUTE.');
    expect(gen('selectCases', { mode: 'range', first: 5, last: 10, output: 'delete' })).toBe('SELECT IF ($CASENUM >= 5 AND $CASENUM <= 10).\nEXECUTE.');
    expect(gen('selectCases', { mode: 'random', percent: 25, output: 'delete' })).toBe('SAMPLE 0.25.\nEXECUTE.');
    expect(gen('selectCases', { mode: 'random', sampleType: 'exact', n: 10, from: 100, output: 'delete' })).toBe('SAMPLE 10 FROM 100.\nEXECUTE.');
    expect(errors('selectCases', { mode: 'range', first: 10, last: 5 })).toBe('dlg.errors.range');
  });
  it('WEIGHT', () => {
    expect(gen('weightCases', { weight: ['income'] })).toBe('WEIGHT BY income.');
    expect(gen('weightCases', { mode: 'off' })).toBe('WEIGHT OFF.');
  });
  it('SPLIT FILE', () => {
    expect(gen('splitFile', { groups: ['gender', 'group'] })).toBe('SORT CASES BY gender group.\nSPLIT FILE LAYERED BY gender group.');
    expect(gen('splitFile', { groups: ['gender'], mode: 'SEPARATE', sort: false })).toBe('SPLIT FILE SEPARATE BY gender.');
    expect(gen('splitFile', { mode: 'off' })).toBe('SPLIT FILE OFF.');
  });
  it('AGGREGATE', () => {
    expect(
      gen('aggregate', {
        break: ['group'],
        functions: [
          { target: 'age_mean', func: 'MEAN', source: 'age', label: 'Mean age' },
          { target: 'n', func: 'N', source: '', label: '' },
        ],
        nBreak: true,
      }),
    ).toBe("AGGREGATE OUTFILE=* MODE=ADDVARIABLES\n  /BREAK=group\n  /age_mean 'Mean age'=MEAN(age)\n  /n=N\n  /N_BREAK=N.");
    expect(gen('aggregate', { dest: 'replace', functions: [{ target: 's', func: 'SUM', source: 'income', label: '' }], presorted: true })).toBe(
      'AGGREGATE OUTFILE=*\n  /PRESORTED\n  /s=SUM(income).',
    );
    expect(errors('aggregate', { functions: [{ target: 's', func: 'SUM', source: '', label: '' }] })).toBe('dlg.errors.aggregateSource');
  });
  it('FLIP', () => {
    expect(gen('transpose', { variables: ['age', 'income'], newnames: ['city'] })).toBe('FLIP\n  /VARIABLES=age income\n  /NEWNAMES=city.');
  });
});

describe('New dialogs (WP3)', () => {
  it('nonparametric tests', () => {
    expect(gen('mannWhitney', NEW_FILLED.mannWhitney)).toBe('NPAR TESTS\n  /M-W=score BY gender(1, 2).');
    expect(gen('mannWhitney', { ...NEW_FILLED.mannWhitney, group: ['city'], g1: 'Brno', g2: 'Praha', descriptives: true })).toBe("NPAR TESTS\n  /M-W=score BY city('Brno', 'Praha')\n  /STATISTICS=DESCRIPTIVES.");
    expect(gen('kruskalWallis', NEW_FILLED.kruskalWallis)).toBe('NPAR TESTS\n  /K-W=score BY group(1, 3).');
    expect(errors('kruskalWallis', { ...NEW_FILLED.kruskalWallis, hi: 1 })).toBe('dlg.errors.range');
    expect(gen('wilcoxon', { ...NEW_FILLED.wilcoxon, sign: true })).toBe('NPAR TESTS\n  /WILCOXON=age WITH score (PAIRED)\n  /SIGN=age WITH score (PAIRED).');
    expect(gen('runs', { variables: ['age'], cut: 'custom', value: 30 })).toBe('NPAR TESTS\n  /RUNS(30)=age.');
    expect(gen('medianTest', { ...NEW_FILLED.medianTest })).toBe('NPAR TESTS\n  /MEDIAN=score BY group(1, 3).');
    expect(gen('roc', NEW_FILLED.roc)).toContain('ROC score BY gender(1)');
    expect(errors('roc', { variables: ['score'], state: ['gender'] })).toBe('dlg.errors.rocPositive');
    expect(gen('friedman', { ...NEW_FILLED.friedman, kendall: true })).toBe('NPAR TESTS\n  /FRIEDMAN=age score income\n  /KENDALL=age score income.');
    expect(gen('chiSquare', NEW_FILLED.chiSquare)).toBe('NPAR TESTS\n  /CHISQUARE=group\n  /EXPECTED=EQUAL.');
    expect(gen('chiSquare', { variables: ['group'], expected: 'values', freqs: '10 20 30' })).toContain('/EXPECTED=10, 20, 30');
    expect(gen('binomial', { variables: ['age'], p: 0.3, define: 'cut', cut: 40 })).toBe('NPAR TESTS\n  /BINOMIAL(0.3)=age(40).');
    expect(gen('ksNormal', NEW_FILLED.ksNormal)).toBe('NPAR TESTS\n  /KOLMOGOROV-SMIRNOV(NORMAL)=age.');
  });
  it('scale and multivariate', () => {
    expect(gen('reliability', { ...NEW_FILLED.reliability, scale: 'Wellbeing' })).toBe("RELIABILITY\n  /VARIABLES=age score income\n  /SCALE('Wellbeing')=ALL\n  /MODEL=ALPHA\n  /SUMMARY=TOTAL.");
    expect(gen('factor', NEW_FILLED.factor)).toBe(
      'FACTOR VARIABLES=age score income\n  /EXTRACTION=PC\n  /ROTATION=VARIMAX\n  /CRITERIA=MINEIGEN(1)\n  /PRINT=INITIAL EXTRACTION ROTATION KMO\n  /PLOT=EIGEN\n  /FORMAT=SORT\n  /MISSING=LISTWISE.',
    );
    expect(gen('factor', { ...NEW_FILLED.factor, nfactors: 'fixed', factors: 2, blank: 0.3, rotation: 'NOROTATE' })).toContain('/CRITERIA=FACTORS(2)');
    expect(gen('quickCluster', { ...NEW_FILLED.quickCluster, saveCluster: true })).toBe('QUICK CLUSTER age score\n  /CRITERIA=CLUSTERS(3) MXITER(10)\n  /SAVE=CLUSTER.');
  });
  it('CLUSTER (hierarchical)', () => {
    expect(gen('hierCluster', NEW_FILLED.hierCluster)).toBe('CLUSTER age score\n  /MEASURE=SEUCLID\n  /METHOD=BAVERAGE\n  /PRINT=SCHEDULE\n  /PLOT=DENDROGRAM.');
    expect(
      gen('hierCluster', { ...NEW_FILLED.hierCluster, id: ['city'], method: 'WARD', measure: 'MINKOWSKI', p: 3, proximity: true, memMode: 'range', saveMode: 'single', saveN: 3, dendrogram: false }),
    ).toBe('CLUSTER age score\n  /MEASURE=MINKOWSKI(3)\n  /METHOD=WARD\n  /ID=city\n  /PRINT=SCHEDULE CLUSTER(2,4) DISTANCE\n  /PLOT=NONE\n  /SAVE=CLUSTER(3).');
    expect(gen('hierCluster', { ...NEW_FILLED.hierCluster, schedule: false, measure: 'POWER', p: 2, r: 1 })).toContain('/MEASURE=POWER(2,1)\n  /METHOD=BAVERAGE\n  /PRINT=NONE');
    expect(errors('hierCluster', { ...NEW_FILLED.hierCluster, memMode: 'range', memMin: 5, memMax: 3 })).toBe('dlg.hierCluster.errRange');
    expect(errors('hierCluster', { variables: ['age'], measure: 'PEARSON' })).toBe('dlg.hierCluster.errPearson');
  });
  it('models', () => {
    expect(gen('logistic', { dependent: ['gender'], covariates: ['age'], categorical: ['group'] })).toBe(
      'LOGISTIC REGRESSION gender WITH age group\n  /CATEGORICAL=group\n  /PRINT=CI(95)\n  /CRITERIA=CUT(0.5) ITERATE(20).',
    );
    expect(errors('logistic', { dependent: ['gender'] })).toBe('dlg.errors.predictors');
    expect(gen('glm', { dependent: ['score'], factors: ['gender', 'group'], design: 'main' })).toBe('GLM score BY gender group\n  /METHOD=SSTYPE(3)\n  /INTERCEPT=INCLUDE\n  /DESIGN=gender group.');
  });
  it('tables and graphs', () => {
    expect(gen('ctables', { rows: ['gender', 'age'], cols: ['group'], colpct: true })).toBe(
      'CTABLES\n  /TABLE=gender [C] [COUNT, COLPCT] + age [S] [MEAN, STDDEV] BY group [C]\n  /CATEGORIES VARIABLES=gender group TOTAL=YES.',
    );
    expect(gen('histogram', NEW_FILLED.histogram)).toBe('GRAPH\n  /HISTOGRAM(NORMAL)=age.');
    expect(gen('barChart', { category: ['group'], cluster: ['gender'], func: 'MEAN', variable: ['score'] })).toBe('GRAPH\n  /BAR=MEAN(score) BY group BY gender.');
    expect(gen('scatter', { ...NEW_FILLED.scatter, by: ['gender'] })).toBe('GRAPH\n  /SCATTERPLOT(BIVARIATE)=age WITH score BY gender.');
    expect(gen('boxplot', NEW_FILLED.boxplot)).toBe('EXAMINE VARIABLES=score BY group\n  /PLOT=BOXPLOT\n  /STATISTICS=NONE\n  /COMPARE=GROUPS.');
  });
  it('variable properties', () => {
    expect(
      gen('variableProperties', { variables: ['gender'], measure: 'NOMINAL', role: 'INPUT', label: 'Pohlaví', labels: [{ value: '1', label: 'Žena' }, { value: '2', label: 'Muž' }], missing: '9, 99' }),
    ).toBe("VARIABLE LEVEL gender (NOMINAL).\nVARIABLE ROLE /INPUT gender.\nVARIABLE LABELS gender 'Pohlaví'.\nADD VALUE LABELS gender 1 'Žena' 2 'Muž'.\nMISSING VALUES gender (9, 99).");
    expect(gen('variableProperties', { variables: ['age'], missing: '90 thru hi' })).toBe('MISSING VALUES age (90 THRU HIGHEST).');
    expect(errors('variableProperties', { variables: ['age'] })).toBe('dlg.errors.nothingToDo');
  });
  it('correlation methods', () => {
    expect(gen('correlations', { variables: ['age', 'score'], method: 'SPEARMAN' })).toBe('NONPAR CORR\n  /VARIABLES=age score\n  /PRINT=SPEARMAN TWOTAIL NOSIG\n  /MISSING=PAIRWISE.');
    expect(gen('correlations', { variables: ['age', 'score'], method: 'BOTH', flag: false, missing: 'LISTWISE' })).toBe('NONPAR CORR\n  /VARIABLES=age score\n  /PRINT=BOTH TWOTAIL SIG\n  /MISSING=LISTWISE.');
    expect(gen('partialCorr', { variables: ['age', 'score'], controls: ['income'] })).toBe('PARTIAL CORR\n  /VARIABLES=age score BY income\n  /SIGNIFICANCE=TWOTAIL\n  /MISSING=LISTWISE.');
    expect(gen('partialCorr', { variables: ['age', 'score'], controls: ['income', 'gender'], tails: 'ONETAIL', showSig: false, descriptives: true, zeroOrder: true, missing: 'ANALYSIS' })).toBe('PARTIAL CORR\n  /VARIABLES=age score BY income gender\n  /SIGNIFICANCE=ONETAIL\n  /STATISTICS=DESCRIPTIVES CORR\n  /FORMAT=CONDENSED\n  /MISSING=ANALYSIS.');
    expect(errors('partialCorr', { variables: ['age', 'score'] })).toBe('dlg.errors.needVariables');
  });
});

describe('Kaplan–Meier', () => {
  it('KM syntax with event list, strata, tests and plots', () => {
    expect(gen('km', { time: ['age'], status: ['gender'], eventValue: '1' })).toBe('KM age\n  /STATUS=gender(1)\n  /PRINT=TABLE MEAN\n  /PLOT=SURVIVAL.');
    expect(
      gen('km', {
        time: ['age'], status: ['group'], eventType: 'list', eventList: '1, 3', factor: ['gender'], strata: ['city'],
        logrank: true, tarone: true, compare: 'PAIRWISE', pool: 'STRATA', table: false, quartiles: true, plotHazard: true,
      }),
    ).toBe('KM age BY gender\n  /STRATA=city\n  /STATUS=group(1 3)\n  /PRINT=MEAN\n  /PERCENTILES\n  /PLOT=SURVIVAL HAZARD\n  /TEST=LOGRANK TARONE\n  /COMPARE=PAIRWISE STRATA.');
    expect(gen('km', { time: ['age'], status: ['group'], eventType: 'range', lo: 2, hi: 4, table: false, mean: false, plotSurvival: false })).toBe('KM age\n  /STATUS=group(2 THRU 4)\n  /PRINT=NONE.');
    // tests need a factor
    expect(gen('km', { time: ['age'], status: ['gender'], logrank: true })).not.toContain('TEST');
    expect(errors('km', { time: ['age'], status: ['gender'], eventValue: 'x' })).toBe('dlg.errors.kmEvent');
    expect(errors('km', { time: ['age'], status: ['gender'], eventType: 'range', lo: 3, hi: 1 })).toBe('dlg.errors.kmEvent');
  });
});
