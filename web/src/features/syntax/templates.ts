/*
 * Commented syntax templates for commands that do not (yet) have a dialog.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { manualUrl } from '../../app/help';
import { PSPP_COMMANDS } from '../../lib/commands';

const T: Record<string, string> = {
  'SYSFILE INFO': "SYSFILE INFO FILE='data.sav'.",
  'DISPLAY': 'DISPLAY DICTIONARY.',
  'DOCUMENT': 'DOCUMENT  Describe the data file here.\n  Every line is stored in the file.',
  'SHOW': 'SHOW ALL.',
  'SET': '* Common settings:\nSET DECIMAL=DOT\n  /FORMAT=F8.2\n  /SEED=RANDOM.',
  'SORT VARIABLES': '* Sort by NAME, TYPE, FORMAT, LABEL, VALUES, MISSING, MEASURE, ROLE, COLUMNS or ALIGNMENT.\nSORT VARIABLES BY NAME (A).',
  'ADD FILES': "ADD FILES\n  /FILE=*\n  /FILE='other.sav'.\nEXECUTE.",
  'MATCH FILES': "* Both files must be sorted by the key variables.\nMATCH FILES\n  /FILE=*\n  /TABLE='lookup.sav'\n  /BY id.\nEXECUTE.",
  'UPDATE': "UPDATE\n  /FILE=*\n  /FILE='changes.sav'\n  /BY id.\nEXECUTE.",
  'DATASET': 'DATASET NAME main.\nDATASET COPY copy1.\nDATASET ACTIVATE copy1.',
  'DATASET COPY': 'DATASET COPY copy1.',
  'APPLY DICTIONARY': "APPLY DICTIONARY FROM 'template.sav'.",
  'VARIABLE LEVEL': '* SCALE, ORDINAL or NOMINAL.\nVARIABLE LEVEL var1 var2 (NOMINAL).',
  'MRSETS': "MRSETS\n  /MDGROUP NAME=$set1 LABEL='Multiple dichotomy set'\n    VARIABLES=v1 v2 v3 VALUE=1.",
  'DO IF': 'DO IF (cond1).\n  COMPUTE y = 1.\nELSE IF (cond2).\n  COMPUTE y = 2.\nELSE.\n  COMPUTE y = 3.\nEND IF.\nEXECUTE.',
  'LOOP': 'LOOP #i = 1 TO 10.\n  COMPUTE x = x + #i.\nEND LOOP.\nEXECUTE.',
  'DO REPEAT': 'DO REPEAT v = var1 TO var5 / n = 1 TO 5.\n  COMPUTE v = v * n.\nEND REPEAT.\nEXECUTE.',
  'IF': 'IF (age >= 18) adult = 1.\nEXECUTE.',
  'MISSING VALUES': 'MISSING VALUES var1 var2 (9, 99).',
  'VALUE LABELS': "VALUE LABELS var1\n  1 'Yes'\n  2 'No'.",
  'VARIABLE LABELS': "VARIABLE LABELS var1 'Label for var1'\n  /var2 'Label for var2'.",
  'FORMATS': 'FORMATS var1 (F8.2) var2 (DATE11).',
  'NUMERIC': 'NUMERIC newvar (F8.2).',
  'STRING': 'STRING newstr (A20).',
  'RENAME VARIABLES': 'RENAME VARIABLES (oldname = newname).',
  'DELETE VARIABLES': 'DELETE VARIABLES var1 var2.',
  'SAMPLE': 'SAMPLE 0.10.\nEXECUTE.',
  'TEMPORARY': '* The next transformation only applies to the next procedure.\nTEMPORARY.\nSELECT IF (gender = 1).\nFREQUENCIES /VARIABLES=age.',
  'N OF CASES': 'N OF CASES 100.',
  'LIST': 'LIST\n  /VARIABLES=ALL\n  /CASES=FROM 1 TO 20.',
  'GLM': 'GLM dependent BY factor1 factor2\n  /DESIGN=factor1 factor2 factor1*factor2\n  /CRITERIA=ALPHA(0.05).',
  'QUICK CLUSTER': 'QUICK CLUSTER var1 var2 var3\n  /CRITERIA=CLUSTERS(3) MXITER(20)\n  /PRINT=INITIAL CLUSTER.',
  'FACTOR': 'FACTOR\n  /VARIABLES=item1 TO item10\n  /PRINT=INITIAL EXTRACTION ROTATION KMO\n  /PLOT=EIGEN\n  /EXTRACTION=PC\n  /ROTATION=VARIMAX\n  /CRITERIA=MINEIGEN(1) ITERATE(25).',
  'RELIABILITY': "RELIABILITY\n  /VARIABLES=item1 TO item10\n  /SCALE('Scale') ALL\n  /MODEL=ALPHA\n  /SUMMARY=TOTAL.",
  'LOGISTIC REGRESSION': 'LOGISTIC REGRESSION outcome WITH pred1 pred2\n  /CATEGORICAL=pred2\n  /PRINT=CI(95)\n  /CRITERIA=CUT(0.5) ITERATE(20).',
  'NPAR TESTS': '* Choose a test subcommand:\n*   /CHISQUARE  /BINOMIAL  /RUNS  /K-S  /M-W  /WILCOXON  /SIGN  /FRIEDMAN  /KENDALL  /COCHRAN  /K-W  /MEDIAN  /MCNEMAR  /J-T.\nNPAR TESTS\n  /CHISQUARE=var1\n  /EXPECTED=EQUAL.',
  'NPAR TESTS CHISQUARE': 'NPAR TESTS\n  /CHISQUARE=var1\n  /EXPECTED=EQUAL.',
  'NPAR TESTS BINOMIAL': 'NPAR TESTS\n  /BINOMIAL (0.5)=var1.',
  'NPAR TESTS RUNS': 'NPAR TESTS\n  /RUNS (MEDIAN)=var1.',
  'NPAR TESTS K-S': 'NPAR TESTS\n  /K-S (NORMAL)=var1.',
  'NPAR TESTS M-W': 'NPAR TESTS\n  /M-W=score BY group (1, 2).',
  'NPAR TESTS K-W': 'NPAR TESTS\n  /K-W=score BY group (1, 3).',
  'NPAR TESTS WILCOXON': 'NPAR TESTS\n  /WILCOXON=before WITH after (PAIRED).',
  'NPAR TESTS FRIEDMAN': 'NPAR TESTS\n  /FRIEDMAN=t1 t2 t3.',
  'ROC': 'ROC score BY outcome (1)\n  /PLOT=CURVE(REFERENCE)\n  /PRINT=SE COORDINATES.',
  'CTABLES': 'CTABLES\n  /TABLE gender [COUNT COLPCT] BY faculty.',
  'GRAPH SCATTERPLOT': 'GRAPH\n  /SCATTERPLOT(BIVAR)=xvar WITH yvar.',
  'GRAPH HISTOGRAM': 'GRAPH\n  /HISTOGRAM(NORMAL)=var1.',
  'GRAPH BAR': 'GRAPH\n  /BAR(SIMPLE)=COUNT BY category.',
  'GRAPH BAR MEAN': 'GRAPH\n  /BAR(GROUPED)=MEAN(score) BY category BY gender.',
  'MATRIX': 'MATRIX.\nCOMPUTE a = {1, 2; 3, 4}.\nPRINT INV(a).\nEND MATRIX.',
  'OUTPUT MODIFY': 'OUTPUT MODIFY\n  /SELECT TABLES\n  /TABLECELLS SELECT=[ALL] FORMAT=F8.1.',
  'FILE LABEL': "FILE LABEL 'Description of the data file'.",
  'TITLE': "TITLE 'Report title'.",
  'ECHO': "ECHO 'Text to print in the output'.",
  'GET DATA': "GET DATA\n  /TYPE=TXT\n  /FILE='data.csv'\n  /ARRANGEMENT=DELIMITED\n  /DELIMITERS=','\n  /FIRSTCASE=2\n  /VARIABLES=id F8.0 name A20 score F8.2.",
  'DATA LIST': 'DATA LIST LIST /id (F3) name (A10) score (F5.1).\nBEGIN DATA\n1 Alice 12.5\n2 Bob 9.0\nEND DATA.',
  'IDENTIFY DUPLICATES': '* Flag duplicate cases by key variables.\nSORT CASES BY id.\nMATCH FILES\n  /FILE=*\n  /BY id\n  /FIRST=first_case.\nCOMPUTE duplicate = 1 - first_case.\nEXECUTE.',
  'VISUAL BINNING': '* Bin a scale variable into categories.\nRECODE age (LOWEST THRU 24=1) (25 THRU 44=2) (45 THRU 64=3) (65 THRU HIGHEST=4) INTO age_bin.\nVALUE LABELS age_bin 1 \'<25\' 2 \'25–44\' 3 \'45–64\' 4 \'65+\'.\nEXECUTE.',
  'SHIFT VALUES': 'SHIFT VALUES VARIABLE=score RESULT=score_lag LAG=1.\nEXECUTE.',
  'EXECUTE': 'EXECUTE.',
};

/** Returns a commented template for the command (used by menu entries without a dialog). */
export function syntaxTemplate(command: string, lang: 'cs' | 'en' = 'en'): string {
  const body = T[command] ?? `${command.replace(/^(GRAPH|NPAR TESTS) .*/, '$1')} .`;
  const cmd = command.replace(/^(GRAPH|NPAR TESTS) .*/, '$1');
  const known = PSPP_COMMANDS.includes(cmd) || cmd === 'DATA LIST';
  const help = known ? (lang === 'cs' ? `\n* Nápověda: ${manualUrl(cmd)}` : `\n* Help: ${manualUrl(cmd)}`) : '';
  const header = lang === 'cs' ? `* ${cmd}: upravte šablonu a spusťte ji (Ctrl+Enter).${help}` : `* ${cmd}: edit this template and run it (Ctrl+Enter).${help}`;
  return `${header}\n${body}\n`;
}
