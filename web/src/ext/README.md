# Extension analyses (`src/ext`)

Procedures that PSPP 2.1.3 does not implement, computed in the browser and spliced into a run in
place of the command. They use **SPSS syntax and output layout**, so SPSS scripts run and the
output view, APA copy, interpretation cards, journal and syntax editor treat them like engine
results.

## How a run works
`app/engine.ts` → `runWithExtensions` (`runner.ts`) when the syntax contains a command listed in
`names.ts`. Consecutive PSPP commands go to the engine as one chunk (padded with blank lines, so
message line numbers stay those of the full syntax); each extension command runs on the dataset
the engine left behind.

## Adding a command
1. Add its canonical SPSS name to `EXT_COMMAND_NAMES` in `names.ts` (command matching,
   highlighting, "unimplemented" lists use it).
2. Create `commands/<name>.ts` exporting `export const commands: ExtCommand[] = [...]`
   (discovered by `import.meta.glob`, no registry edit).
3. `run(cmd, ctx)` returns `OutputItem[]`: usually one `groupItem(title, NAME, [tables…, charts…])`.
   Throw `ExtError('…')` for syntax/data errors – it becomes an error message at the command line.

## Rules
- **Data** (`data.ts`): always go through `splitGroups(ds)` (FILTER, positive WEIGHT, SPLIT FILE
  as contiguous groups – emit `textItem(group.label)` before each group's output when the label is
  non-empty), `isMissing(v, x, includeUser)` (system- and user-missing), `weights(ds)` (frequency
  weights). If a procedure cannot honour weights, emit a warning message saying they were ignored.
- **Parsing** (`parse.ts`): `cmd.head`, `sub(cmd, 'VARIABLES')`, `varList(tokens, i, vars, stop)`
  (supports `TO`, `ALL`), `keywords(tokens)`, `kwArg(tokens, 'CI')`. Accept SPSS abbreviations.
- **Output** (`table.ts`): `tableItem({ caption, head, body, footnotes }, NAME)`; cells via `th()`
  and `td()`; numbers via `fmt(x, decimals, ctx)` (PSPP style: `.264`, decimal comma when
  `ctx.decimal === ','`), `fmtP` (3 decimals), `fmtN` (counts). Same table names, row/column
  order and decimals as SPSS where SPSS defines them.
- **Strings**: every visible string through `ctx.t('ext.<command>.<key>')`, with keys in a fragment
  pair `src/i18n/fragments/ext-<area>.cs.json` / `.en.json` (identical key sets – a test checks).
  Variable and value labels come from the data (`varTitle`, `valueText`).
- **Maths**: `dist.ts` (normal, t, chi², F, incomplete beta/gamma, quantiles), `linalg.ts`.
- **Charts**: return `chartItem(title, spec)` with a spec whose `type` the renderer in
  `src/charts` understands (add a new type there if needed).
- **Correctness**: every statistic is checked in a Vitest file against reference values computed
  independently (scipy / statsmodels are installed: `python3 -c "import scipy, statsmodels"`), on
  the bundled samples and on edge cases (ties, missing values, a single group, n < 3, constant
  variable, FILTER/WEIGHT/SPLIT). Paste the reference numbers into the test with the script that
  produced them in a comment.
- Helpers for tests: `testing.ts` (`runExt`, `runMixed` through the real engine, `tables`,
  `errorsOf`).
