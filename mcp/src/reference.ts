/** A short PSPP syntax cheat sheet returned by the pspp_reference tool. */
export const REFERENCE = `# PSPP syntax cheat sheet

Commands end with a period and each command starts on its own line. Variable names are case-insensitive. Use VARIABLES=a b c (or a TO c).

## Describe
- FREQUENCIES VARIABLES=x /STATISTICS=MEAN MEDIAN STDDEV /BARCHART.
- DESCRIPTIVES VARIABLES=x y /STATISTICS=MEAN STDDEV MIN MAX.
- EXAMINE VARIABLES=x BY group /PLOT=BOXPLOT HISTOGRAM NPPLOT.
- CROSSTABS /TABLES=a BY b /STATISTICS=CHISQ PHI /CELLS=COUNT EXPECTED ROW.
- CORRELATIONS /VARIABLES=x y z. (add /PRINT=TWOTAIL) | NONPAR CORR /VARIABLES=x y /PRINT=SPEARMAN.

## Compare means
- T-TEST GROUPS=group(1 2) /VARIABLES=score.            (independent samples)
- T-TEST PAIRS=pre WITH post (PAIRED).                   (paired samples)
- T-TEST /TESTVAL=100 /VARIABLES=score.                  (one sample)
- ONEWAY score BY group /STATISTICS=DESCRIPTIVES HOMOGENEITY /POSTHOC=TUKEY BONFERRONI ALPHA(0.05).
- NPAR TESTS /M-W=score BY group(1 2). | /K-W=score BY group(1 3). | /WILCOXON=pre WITH post. | /BINOMIAL=x.
- UNIANOVA score BY a b /DESIGN=a b a*b.                 (factorial ANOVA)
- GLM score BY group /DESIGN=group.

## Model
- REGRESSION /DEPENDENT=y /METHOD=ENTER x1 x2 x3 /STATISTICS=COEFF R ANOVA CI.
- LOGISTIC REGRESSION y WITH x1 x2 /CATEGORICAL=x2.
- FACTOR VARIABLES=a b c d /PRINT=INITIAL EXTRACTION ROTATION /CRITERIA=FACTORS(2) /ROTATION=VARIMAX.
- RELIABILITY VARIABLES=q1 TO q10 /SCALE('Scale') ALL /MODEL=ALPHA.
- QUICK CLUSTER x y z /CRITERIA=CLUSTERS(3).

## Transform
- COMPUTE total = a + b. | RECODE x (1 thru 3=1) (4 thru 6=2) INTO xgrp. | IF (age > 30) old = 1.
- SELECT IF (group = 1). | FILTER BY flag. | WEIGHT BY w. | SPLIT FILE BY group. | SORT CASES BY x (D).
- VARIABLE LABELS x 'Label'. | VALUE LABELS g 1 'Control' 2 'Treatment'. | MISSING VALUES x (99).
- FORMATS x (F8.2). | VARIABLE LEVEL x (SCALE) g (NOMINAL).
- AGGREGATE /OUTFILE=* MODE=ADDVARIABLES /BREAK=group /mean_x=MEAN(x).

## Inline data (when not loading a file)
DATA LIST LIST /id (F3) score (F5.1) group (A1).
BEGIN DATA
1 12.5 a
2 15.0 b
END DATA.

## Tips
- Missing numeric values are system-missing (shown as '.'); check MISSING VALUES for codes like 99.
- Report effect sizes yourself: PSPP prints test statistics and CIs but not always Cohen's d or eta squared.
- Always check assumptions (normality, equal variances) and say what was and was not verified.
`;
