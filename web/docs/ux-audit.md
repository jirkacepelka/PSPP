# PSPP Studio: UX audit

**Date:** 2026-11-03 · **Build:** `main` working tree at audit time (`c8a5a34` plus uncommitted engine and style work in progress) · **Engine:** real PSPP/WASM (`public/engine/pspp.js`); the mock engine was only used to check older screenshots
**Method:** code read of `src/**`; scripted Playwright walkthroughs at 1440×900, 1024, 720 and 390 px (scripts kept outside the repo); heuristic review with the *design-critique*, *accessibility-review* (WCAG 2.1/2.2 AA) and *ux-copy* methods; comparison with SPSS Statistics 29, PSPPIRE 2.0, JASP 0.19, jamovi 2.5, plus Linear, Raycast and Notion for interaction patterns.
**Screenshots:** `docs/ux-audit/*.png` (index in Appendix A). Older reference shots are in `docs/screenshots/`.
**Scope:** layout, information architecture, component choice, interaction, workflows, copy and accessibility. Colour and visual styling are out of scope, because the "Calm Workspace" restyle is happening in parallel. The classic menu bar is treated as a fixed requirement.

> Line numbers refer to the tree as it was during the audit. Other agents are editing styles and engine files at the same time, so use the **function or component name** as the stable anchor.

---

## 0. How to read this

- **Priority.** **P0**: blocks a core task, loses work, or is a correctness bug; fix first. **P1**: large friction for beginners or experts, or a strong differentiator. **P2**: polish or nice-to-have.
- **Effort.** **S**: under 1 day. **M**: 1–3 days. **L**: more than 3 days or touches several modules.
- **Impact** is given separately for **B** (beginner: a student in their first statistics course, Czech UI, has never used SPSS) and **E** (expert: a researcher or analyst with years of SPSS who writes syntax and wants speed).
- Finding IDs (`SH-3`, `DV-5`…) are referenced in the work packages (§8).

---

## 1. Executive summary: top 10

PSPP Studio already has a solid base. It has one action registry behind the menus, toolbar and palette, declarative dialog specs with Paste, a real PSPP engine, Czech plurals, autosave, undo across transformations, and dialog variable lists that show measurement-level icons. Today it is a **faithful, cleaner SPSS clone**. That gives an SPSS user nothing they did not already have, and it gives a beginner the same maze SPSS gives them. These ten changes would make it *better than SPSS*:

| # | Issue / opportunity | Why it matters | P | Effort |
|---|---|---|---|---|
| 1 | **Ctrl+S in the syntax editor fires two actions.** It downloads `Syntax_1.sps` *and* opens "Uložit datovou sadu" (Save dataset). `SyntaxView` binds `Mod-s` and the global handler in `App.tsx` also runs `file.save`, because `isEditable()` lists `file.save` in `GLOBAL_IN_INPUT` and the handler never checks `e.defaultPrevented`. Evidence: `29-syntax-view.png`. | Correctness bug on the most-used shortcut. | P0 | S |
| 2 | **Half of Analýza and all of Grafy open syntax templates, not dialogs.** 16 of 29 Analyze items, 4 of 4 Graphs items and "Definovat vlastnosti proměnných" paste English placeholder syntax (`score BY group`) into the editor. The item looks identical to a dialog item (`…` suffix), and the submenu header even says "Klasické dialogy". Evidence: `14-menu-nonparametric.png`, `15-template-mann-whitney.png`. | A beginner clicks "Mann-Whitney…" and lands in a code editor with invented variable names. That is a dead end. | P0 | S (label it) → L (real dialogs) |
| 3 | **Dialogs know nothing about the data.** No spec uses the `measures` filter. Frequencies on a *nominal* variable prints mean, SD and "Minimum = Science" by default (`35-frequencies-chart-output.png`). Group values in the t-test are free text `1`/`2` and ignore the value labels Female/Male. Quick "Četnosti…" from a column header opens an **empty** dialog (`07-quick-freq-not-prefilled.png`, `DataView.tsx` `headerMenu`). | The single biggest gap against SPSS and against JASP/jamovi. The app holds the metadata that would prevent wrong analyses and does not use it. | P0 | M |
| 4 | **Analysis dialog work is lost easily, and dialogs cannot be recalled.** A click on the scrim, or Escape, throws away all selections, because `lastValues` is only written in `finish()`. Values live in an in-memory `Map` (`DialogRenderer.tsx`), so they disappear on reload. There is no Dialog Recall (SPSS has one) and no "Upravit a spustit znovu" (edit and run again) on an output entry. | "Re-run with a change" is the most common analyst loop. Today it means rebuilding the dialog or editing syntax. | P0 | M |
| 5 | **Output has no interpretation, cannot be copied in APA style, and wide tables are clipped.** The t-test table is cut off on the right on a 1440 px screen, because the paper is about 880 px wide and has 19 px of hidden overflow (`31-ttest-table-hover.png`). P-values print as `,414` and there is no effect size. The only actions are copy table, delete and paste syntax. | Beginners cannot read the results. Experts re-type tables into Word. | P1 | M–L |
| 6 | **Data View hides meaning.** Value labels are off by default, so you see `gender = 1/2` (`02-data-default.png`). Column headers show only storage type (`123`/`A`), not measurement level. User-missing values are painted in the *error* colour (red "9" / "No answer"). Phantom columns are labelled "prom". A labelled cell cannot be edited by picking a label (`05-cell-editor-labels-on.png`). | A beginner cannot tell that "gender" is a category. An expert cannot see data quality at a glance. | P1 | M |
| 7 | **No contextual surface for a variable.** Understanding a variable means switching to an 11-column, SPSS-identical Variable View. Width, Decimals, Columns, Align and Role are noise for 95 % of tasks (`08-variable-view.png`). A **Variable inspector** side panel (type, label chips, missing, mini distribution, quick actions) would replace about 70 % of trips to Variable View. | Core beginner orientation. It is also a power-user accelerator. | P1 | L |
| 8 | **No guidance on which test to choose.** The command palette cannot find goals ("porovnat skupiny" → "Nic nenalezeno", `27-palette-goal-query.png`) or variables (`gpa` → nothing). An **Analysis assistant** (goal → recommended test based on measurement levels) plus palette search over variables and goals would be the clearest "better than SPSS" story. | Beginner orientation, and faster for experts too. | P1 | M–L |
| 9 | **Chrome eats the screen, and the toolbar is not contextual.** App bar (2 rows) + toolbar + formula bar + view bar + tabs + status bar take about 260 px of vertical space. The toolbar shows data-grid actions (insert case, value labels, split/weight chips) in Output and Syntax, and Syntax has **two** Run buttons (`29-syntax-view.png`). At ≤760 px the menu bar disappears into a hamburger (`40-width-720.png`), which conflicts with the "menu stays visible" requirement. | Wasted space, ambiguous controls, and a broken product rule on tablets. | P1 | M |
| 10 | **Weak keyboard model for power users, plus accessibility gaps.** No Alt mnemonics (Alt+A does nothing). No Ctrl+Enter to run from a dialog. Target lists in dialogs cannot be navigated with arrow keys. The output outline is `role="tree"` without tree keyboard support. The view tabs mix `role="tab"` inside `role="presentation"` containers and have no panels. There is no `h1`. | Experts cannot "fly", and WCAG 2.1.1 / 4.1.2 issues remain. | P1 | M |

**Biggest strategic recommendation:** keep the SPSS mental model (Data/Variable View, menu bar, dialogs with Paste, output navigator), but make every surface **data-aware** (measurement level, value labels, missing values) and **loop-friendly** (recall, re-run, pin, journal). Those two properties are exactly what SPSS lacks and what JASP and jamovi got right.

---

## 2. What already works (keep it)

- **One action registry** (`src/app/actions.ts`) feeds the menus, toolbar and palette. That is the right foundation for shortcuts, recall and palette extensions.
- **Declarative dialog specs** with a generic renderer, live syntax preview, **Paste** ("Vložit do syntaxe"), Help, Reset, drag-and-drop and double-click to move variables. The measurement-level icons in dialog lists (`variableIcon`) are already better than PSPPIRE.
- **Real PSPP output in Czech** with decimal comma (`21-descriptives-output.png`). Correct Czech plurals (`status.cases_one/few/many/other`).
- **Undo/redo covers transformations**, because `runSyntax` loads the new dataset with `keepHistory: true`. SPSS cannot undo a COMPUTE. Make this visible (see DV-11).
- **Autosave plus "Pokračovat, kde jste skončili"** (continue where you left off), recent files, and drag-and-drop anywhere.
- **Status chips for Split/Weight/Filter** in the toolbar. SPSS hides these in the status bar. Keep the idea and make the chips contextual.
- **Error lines carry line numbers**, the syntax tab gets an error badge, and diagnostics show in the CodeMirror gutter.
- **Value labels dialog** is a clean editable table (`09-value-labels-dialog.png`), far better than SPSS's Add/Change/Remove triad.
- **Accessible basics:** skip link, focus-trapped `Dialog`, `menubar`/`menuitem` roles with arrow keys, listbox roles in dialogs, `aria-live` engine status, visible focus ring on the menu bar (`37-f10-menubar-focus.png`), and `prefers-reduced-motion`.

---

## 3. Findings by area

Format: **ID: title.** Problem · *Evidence* · Impact B/E · **Recommendation** · Priority · Effort.

### 3.1 Shell & navigation (`features/shell`, `App.tsx`, `app/menus.ts`)

**SH-1: Ctrl+S runs twice in the syntax editor.**
`SyntaxView.makeExtensions()` binds `Mod-s → saveSyntaxFile()`. The window listener in `App.tsx` then also matches `file.save`, because it is in `GLOBAL_IN_INPUT` and the listener ignores `e.defaultPrevented`. Result: a `.sps` download and the "Uložit datovou sadu" modal. *Evidence:* `29-syntax-view.png`; the walkthrough log shows one download plus the modal.
Impact: B confusion, E annoyance and a risk of saving the wrong thing.
**Fix:** in the global handler, `if (e.defaultPrevented) return;` at the top. Decide on a **view-scoped meaning** for Ctrl+S: in Syntax it saves the syntax tab, elsewhere it saves the dataset. Put that rule in the `Action` registry (`scope?: View[]`), not in two places.
**P0 · S**

**SH-2: Template menu items look like dialogs.**
`tpl:*` actions have the same rendering as `dialog:*` and keep the `…` suffix. The non-parametric submenu header says "Klasické dialogy" (`menu.legacyDialogs`), but every item in it opens syntax. Templates use invented variable names (`var1`, `score`, `group`) and English comments only partly translated. *Evidence:* `14-menu-nonparametric.png`, `15-template-mann-whitney.png`, `templates.ts`.
Impact: B dead end. E acceptable but slow, because they must rename placeholders.
**Fix (staged):**
1. *Now (S):* render templates with a trailing "Syntaxe" badge and a `code` icon, and drop the `…`. Rename the header to "Jako syntaxe" or remove it. Tooltip: "Otevře šablonu příkazu v editoru syntaxe." (Opens a command template in the syntax editor.)
2. *Next (M):* **fill templates with real variables.** Use the current grid selection or the first variables of a fitting measurement level, for example `NPAR TESTS /M-W=<first scale var> BY <first nominal var with 2 labels> (v1, v2)`.
3. *Later (L):* real dialogs for the top templates by expected use: Chí-kvadrát, Mann-Whitney, Kruskal-Wallis, Wilcoxon, Reliability (Cronbach α), Factor, Binary logistic, Histogram, Bar chart, Scatterplot, Define variable properties. See work package 3.

**P0 (stage 1) / P1 (2–3) · S → L**

**SH-3: The menu bar disappears at ≤760 px.**
`app.css @media (max-width: 760px) .menubar{display:none}`. At 720 px (an iPad in portrait) there is only a hamburger (`40-width-720.png`). The product rule says the classic menu bar stays visible.
**Fix:** keep the menu bar down to 600 px. Shorten the title row (the title moves into the menu row as in Google Docs at narrow widths), and let the menu bar scroll horizontally with fade edges. Use the drawer only below 600 px.
**P1 · S**

**SH-4: The toolbar is not contextual.**
`Toolbar.tsx` always shows Open/Save/Print, Undo/Redo, Zoom, Value labels, Go to, Find, Insert case/variable, Frequencies/Descriptives/Crosstabs, and the Split/Weight/Filter chips. Grid actions stay enabled in Output and Syntax and act on an invisible grid (`gridCommands` holds the last registered grid). In Syntax a second **"Spustit"** (Run) button duplicates the syntax bar's "Spustit vše" (Run all). Output has its own extra bar (Export/Print/Clear).
**Fix:** one **contextual command bar** per view that replaces both the global toolbar and the per-view bars (`syntax-bar`, `output-bar`):
- *Data:* Undo/Redo · Value labels toggle · Find · Insert case/variable · Sort · ‖ Filter/Weight/Split chips · ‖ "Analyzovat…" (assistant) · Recall last dialog.
- *Variables:* Undo/Redo · Add variable · Bulk set measurement level · Copy properties · "Zobrazit všechny sloupce" (show all columns) toggle.
- *Output:* Outline toggle · Collapse/expand all · Export ▾ (HTML, PDF, Word-ready copy) · Clear.
- *Syntax:* Run ▾ (current / selection / to end / all) · Format · Errors chip · Journal toggle.

Global actions (Open, Save, Print) live in Soubor and in shortcuts. Zoom moves to Zobrazit and the status bar, as in Google Sheets and VS Code. This saves one row of chrome in Output and Syntax.
**P1 · M**

**SH-5: The chrome stack is too tall.**
App bar with two rows (≈64 px) + toolbar (≈48) + formula bar (≈36, Data only) + view tabs (≈40) + status bar (≈26). Output and Syntax add another 48 px bar. On a 768 px laptop the grid shows about 17 rows.
**Fix:** merge the per-view bars into the toolbar (SH-4). Put the status-bar facts (cases, variables, engine) into the right side of the view-tab row and remove the status bar by default (keep it as an option). Target: 3 chrome rows on desktop.
**P1 · M**

**SH-6: The star button is a dead feature.**
`StarButton` writes `starred` to IndexedDB by *title*, and nothing ever reads it: no starred list on the start screen, no filter. A renamed dataset loses its star.
**Fix:** remove it, or implement "Připnuté soubory" (pinned files) on the start screen keyed by recent-file id. Prefer **removing** it; pinned *results* (OUT-6) are worth more.
**P2 · S**

**SH-7: The theme toggle sits in the app bar.**
It duplicates Zobrazit → Motiv and the profile popover. It takes premium app-bar space that the **engine/run status** should use. Engine status is today only in the status bar.
**Fix:** remove the theme toggle from the app bar. Show a compact run indicator ("Počítám…" with spinner and a Cancel button when the engine supports it) next to the search pill.
**P2 · S**

**SH-8: No Alt mnemonics, F10 only.**
SPSS and PSPPIRE users press Alt+A (Analyze) and Alt+T. Here Alt+A does nothing (walkthrough log).
**Fix:** underline mnemonics on Alt press. Suggested set: **S**oubor, Úp**r**avy, **Z**obrazit, **D**ata, **T**ransformace, **A**nalýza, **G**rafy, **N**ástroje, **N**ápo**v**ěda → use Alt+V for Nápověda, because N is taken by Nástroje. Add a `mnemonic` field to `TopMenu` and a handler in `MenuBar`. Check that Alt+letter does not collide with the `view:*` shortcuts (Alt+1…4).
**P1 · S**

**SH-9: The view tabs sit at the bottom, and their roles are wrong.**
Data/Variables/Output/Syntax tabs at the bottom follow the spreadsheet convention, but these are the app's **primary navigation**. New users look for them at the top, as in JASP/jamovi, and on mobile the bottom bar competes with the OS gesture area. ARIA: `role="tablist"` contains an `IconButton`, a scrolling div and `role="presentation"` wrappers around `role="tab"`. There is no `aria-controls`/`tabpanel`, no roving tabindex and no arrow-key support.
**Fix:** keep them at the bottom on desktop if the visual redesign prefers it, but (a) fix the semantics: tabs get roving tabindex and ←/→, the main area gets `role="tabpanel"` with `aria-labelledby`, and "+" moves outside the tablist; (b) add a clear **Data ⇄ Proměnné segmented switch** at the top of the grid area, because these are two faces of one dataset (as SPSS does with its bottom tabs, but discoverable); (c) Syntax tabs are documents, so give them a distinct group with a separator and a "Syntaxe" label.
**P1 · M**

**SH-10: Drag-and-drop and the empty states.**
The drop overlay is good. While a file loads after a drop there is no progress indicator, only a toast at the end.
**Fix:** show an inline progress card on the start screen or in the main area: "Načítám data.sav… (2,1 MB)".
**P2 · S**

**SH-11: Engine-loading state.**
Analysis actions are clickable while `engineStatus === 'loading'`, and the first run waits silently.
**Fix:** queue the action and show "Jádro PSPP se načítá… spustí se automaticky." (The PSPP engine is loading… it will run automatically.) inline in the dialog footer.
**P2 · S**

### 3.2 Data View (`features/data/DataView.tsx`, `features/shell/FormulaBar.tsx`, `features/grid`)

**DV-1: Value labels are off by default.**
`useUi.valueLabels: false`, so a beginner sees `gender 1/2`, `faculty 1…5`, `job 0/1` (`02-data-default.png`). SPSS defaults to off too, which is one of its worst defaults.
**Fix:** default **on**, and persist per user in settings (`showValueLabels`). Labelled cells show the label. When a label is shown, the code appears in the formula bar ("Female · kód 1").
**P1 · S**

**DV-2: Labelled cells cannot be edited by picking a label.**
With labels on, the overlay editor shows a raw `2` (`05-cell-editor-labels-on.png`). Typing "Male" in a labelled numeric cell fails validation.
**Fix:** for variables with value labels, open a **combo editor**: type-ahead over labels *and* codes, show `1 Female` and `2 Male` with a "jiná hodnota…" (other value) option. Accept the label text as input and map it to the code. Glide supports custom cells and editors (`provideEditor`).
**P1 · M**

**DV-3: Column headers do not show measurement level or label.**
`GridColumnIcon.HeaderNumber/HeaderString/HeaderDate` show *storage* type only. The variable label never appears in the grid.
**Fix:** draw the header icon from `variableIcon()`, the same nominal/ordinal/scale/text/date glyphs the dialogs use, so one visual language runs across the app. Add an optional second header line with the variable label (setting "Zobrazit popisky proměnných v záhlaví", show variable labels in header). Tooltip on header: name, label, type, measurement level, N valid / missing.
**P1 · M**

**DV-4: User-missing values use the error colour.**
In `getCellContent`, a user-missing value gets `themeOverride: { textDark: m.error }`. Red signals an *error*. In SPSS semantics user-missing is a *deliberate code*.
**Fix:** render user-missing as muted italic text with a small "∅" marker. Keep red, or better a warning tone, for **invalid** values: values outside the defined labels or range (DV-6).
**P1 · S**

**DV-5: Quick actions from a header ignore the column.**
The header menu's "Četnosti…" (`headerMenu`) opens Frequencies with an empty target list (`07-quick-freq-not-prefilled.png`).
**Fix:** extend `Modal` `analysis` with `preset?: Values` (or `variables?: string[]`) and prefill the first accepting var-list. Apply the same rule to *every* analysis opened while a grid selection exists: selected columns prefill the dialog. Add header-menu entries for "Popisné statistiky" (Descriptives), "Graf rozložení" (distribution chart), "Seřadit" (sort) and "Najít v proměnné…" (find in variable).
**P0 · S**

**DV-6: No data-quality flags.**
Values outside the defined value labels (`satisf = 7` when labels cover 1–5 and 9), out-of-range values, or string values with stray whitespace are not visible.
**Fix:** a subtle corner triangle (as in spreadsheet comments) on cells whose value is not among the labels for nominal/ordinal variables with labels. Tooltip: "Hodnota 7 nemá popisek. Proměnná satisf má popisky pro 1–5 a 9." (Value 7 has no label…). A toggle in the Data toolbar: "Zvýraznit podezřelé hodnoty" (highlight suspicious values). This feeds the Inspector's "Kontrola dat" (data check) section.
**P1 · M**

**DV-7: The formula bar overpromises.**
The `fx` (`function`) icon suggests formulas, but this is a value bar. The cell reference reads `2 : gender` in monospace, which is cryptic.
**Fix:** replace `fx` with the variable's measurement icon. Format the reference as "Případ 2 · gender" (Case 2). Show the variable label as muted text after it. Keep "Řádek hodnot" (value row) as the setting name.
**P2 · S**

**DV-8: Phantom columns are labelled "prom".**
`data.newVarHeader = "prom"` repeated about 8 times is noise, and "prom" is an unexplained abbreviation.
**Fix:** leave phantom headers empty. Show a single trailing "+ Nová proměnná" (new variable) header cell. Typing into any empty column still creates `var00013` as now.
**P2 · S**

**DV-9: Phantom rows are unclear.**
200+ empty rows look like data. The row count in the status bar is the only cue.
**Fix:** draw a hairline "end of data" separator below the last case and dim the row markers below it.
**P2 · S**

**DV-10: Sorting from the header permanently reorders cases without saying so.**
`sortBy` is undoable but silent.
**Fix:** toast "Případy seřazeny podle age (vzestupně). [Zpět]" (Cases sorted by age, ascending. [Undo]), and the same pattern for delete cases/variables.
**P1 · S**

**DV-11: Undo is invisible and anonymous.**
The toolbar undo has no label for *what* will be undone, and a transformation's undo is not announced.
**Fix:** store an action label with each history snapshot (`past: {ds, label}[]`). Tooltip "Zpět: Vypočítat sleep_def (Ctrl+Z)" (Undo: Compute sleep_def). After every dialog that modifies data, toast "Vytvořena proměnná sleep_def. [Zpět]" (Variable sleep_def created. [Undo]).
**P1 · M**

**DV-12: There is no "go to variable".**
Ctrl+G goes to a case. SPSS has "Go to Variable", which matters in wide surveys with 300+ variables.
**Fix:** extend the Go to dialog with a Case | Variable segmented control, and make variables searchable in the palette (PAL-2).
**P1 · S**

**DV-13: Find has no Replace and no recode bridge.**
Find (`FindDialog`) only finds.
**Fix:** add Replace / Replace all, scoped to a variable, undoable as one step. Offer "Vytvořit překódování…" (create recode) as an alternative for categorical variables.
**P2 · M**

**DV-14: Sample data is English in a Czech UI.**
Variable labels and value labels ("Male", "Public transport", "3rd year") are English. The output therefore mixes languages ("Grade point average" in a Czech table).
**Fix:** generate localized sample datasets in `scripts/make-samples.mjs` (labels in cs/en, chosen by UI language). Keep variable *names* ASCII.
**P1 · S**

### 3.3 Variable View (`features/variables/*`)

**VV-1: Eleven SPSS columns with no progressive disclosure.**
Name, Type, Width, Decimals, Label, Values, Missing, Columns, Align, Measure, Role (`08-variable-view.png`). For a beginner, Width, Columns, Align and Role are meaningless. For an expert they are rare.
**Fix:** default column set: **Název · Popisek · Typ · Úroveň měření · Popisky hodnot · Chybějící hodnoty**. A toolbar toggle "Všechny sloupce" (all columns) reveals Width, Decimals, Columns, Align and Role, persisted per user. Put Měření (measurement level) next to the name, because it drives analysis.
**P1 · S**

**VV-2: The measurement level is hard to scan and edit.**
It is shown as text "Nominální ▾" plus a small grey icon at the *right edge of the name cell* (`drawCell`). The choice menu shows no current check mark (`choiceMenu` measure items lack `checked`). New variables default to **Spojitá** (scale), even when the values are clearly categorical.
**Fix:** draw the measurement-level icon *before* the name, consistent with dialogs and headers. Show the current value as a check in the menu. Allow keyboard cycling (Space). **Auto-suggest** the level on import and on new variables: a string → nominal; numeric with ≤ 10 distinct integer values and labels → nominal/ordinal; otherwise scale. Show a dismissible banner "U 4 proměnných jsme odhadli úroveň měření. [Zkontrolovat]" (We estimated the measurement level for 4 variables. [Check]).
**P1 · M**

**VV-3: No bulk editing.**
You cannot select 10 Likert items and set Measure = Ordinal, or copy value labels to all of them. SPSS has "Copy Data Properties" and paste-on-column, and it is clumsy.
**Fix:** multi-row selection plus a toolbar or context menu: "Nastavit úroveň měření ▸", "Kopírovat vlastnosti z…" (copy properties from), "Použít popisky hodnot na vybrané" (apply value labels to selected), "Nastavit chybějící hodnoty…" (set missing values). Each is one undo step.
**P1 · M**

**VV-4: The value labels summary is cryptic.**
`{1, Female} +2 …`, the SPSS notation, carried over unchanged.
**Fix:** render chips: `1 Female` `2 Male` `+1`, truncated, with a click opening the dialog. This is the same chip component as the Inspector.
**P1 · S (after the chip component exists)**

**VV-5: The value labels dialog ignores the data.**
`ValueLabelsDialog` starts from existing labels or one empty row. It does not show which values actually occur, or how often.
**Fix:** a "Doplnit z dat" (fill from data) button that adds rows for every observed value without a label, with counts (`walk ×34`). Show the count column muted. Warn when a labelled value never occurs. Support paste from Excel (two columns → rows).
**P1 · M**

**VV-6: The missing-values dialog copies SPSS's worst UI.**
"Rozsah a jedna volitelná hodnota" (range plus one optional value), with LO/HI typed as text.
**Fix:** a chip input "Kódy chybějících hodnot: [9] [99] + přidat" (missing-value codes) and an optional range row with "od nejnižší" / "do nejvyšší" (from lowest / to highest) checkboxes. Show "Tento kód má popisek: No answer" (this code has a label) inline, and suggest labelled codes such as "No answer", "Nevím" (don't know) or "Bez odpovědi" (no answer) as candidates.
**P2 · M**

**VV-7: Type changes are destructive and silent.**
The Type dialog mentions conversion (`typeDialog.convertWarning`), but there is no preview of how many values will become missing.
**Fix:** a live line "Převod: 118 hodnot zůstane, 2 se změní na chybějící (např. „n/a")" (Conversion: 118 values stay, 2 become missing, e.g. "n/a") before OK.
**P2 · S**

**VV-8: Invalid name errors arrive as a toast after the edit is lost.**
`variables.invalidName` is shown as a toast and the cell reverts.
**Fix:** inline validation in the overlay editor (red outline plus message) that keeps the typed text. Explain the rule: "Název musí začínat písmenem, bez mezer, max. 64 znaků, a nesmí se opakovat." (A name must start with a letter, have no spaces, max. 64 characters, and must be unique.)
**P2 · S**

### 3.4 Syntax (`features/syntax/*`)

**SY-1: The Ctrl+S double action.** See SH-1. **P0 · S**

**SY-2: Two Run toolbars.**
The global toolbar has "Spustit". The syntax bar has "Spustit vše", "Výběr" (selection), "Aktuální" (current) and "Do konce" (to end) (`29-syntax-view.png`).
**Fix:** one split button "▶ Spustit aktuální (Ctrl+Enter)" with a menu: Výběr, Do konce, Vše (Ctrl+Shift+Enter, F5). Put it in the contextual command bar (SH-4). Add **gutter run buttons**: a ▶ next to the first line of each command, on hover, as in Jupyter or RStudio.
**P1 · M**

**SY-3: Autocomplete is shallow.**
Completion offers command names (`28-syntax-autocomplete.png`). There is no subcommand or keyword help and no signature.
**Fix:**
- subcommand completion per command from a small grammar table (`/VARIABLES=`, `/STATISTICS=` with allowed keywords);
- variable completion that shows label and measurement icon (partially exists through `setKnownVariables`; surface the label in the completion info);
- **hover docs** for a command: one Czech sentence plus a link to the manual anchor;
- snippet completion with tab stops for common commands (FREQUENCIES, DESCRIPTIVES, T-TEST, CROSSTABS, RECODE, COMPUTE).

**P1 · M**

**SY-4: Errors do not link from Output back to the source line.**
Output callouts show "řádek 1" as plain text (`19-after-compute.png`).
**Fix:** make "řádek N" a link that opens the producing syntax tab at that line. Store `tabId` on `OutputEntry`. For dialog-generated syntax, the link reopens the dialog (OUT-3).
**P1 · S**

**SY-5: No journal.**
Dialog runs go straight to the engine. Only "Paste" puts syntax into a tab. There is no complete, ordered record of what was done, which reproducibility needs. SPSS has a journal *file* that nobody finds.
**Fix:** **Deník** (journal), a read-only, auto-appended syntax log of every run (dialogs, grid edits summarised as comments, transformations), timestamped, with "Kopírovat do nové karty syntaxe" (copy to a new syntax tab) and "Stáhnout .sps" (download). It shows as a pinned tab "Deník" or as a toggle panel in Syntax. Data edits in the grid are summarised as comments (`* Ruční úprava: případ 12, satisf 9 → 3.`, manual edit: case 12) so the record stays honest even when not replayable.
**P1 · M**

**SY-6: Pasted syntax lands invisibly in the current tab.**
`pasteSyntax` appends to the *active* syntax tab and switches view. With several tabs, users lose track of where it went.
**Fix:** after Paste, scroll to and briefly highlight the inserted block, and toast "Vloženo do Syntax 1. [Spustit] [Zpět k dialogu]" (Pasted into Syntax 1. [Run] [Back to dialog]).
**P2 · S**

**SY-7: The placeholder reads like content.**
The syntax placeholder `FREQUENCIES /VARIABLES=ALL.` and the dialog text placeholders (`MEAN(x1, x2) * 10`, `1 THRU 5`, `new_var`) look like filled values (`16-recode-different.png`, `17-compute.png`).
**Fix:** use hint text that cannot be mistaken for a value ("Např. MEAN(x1, x2) * 10"), or show examples *below* the field as helper text. See CP-6.
**P2 · S**

**SY-8: Formatting and outline.**
There is no "Formátovat syntaxi" (format syntax) and no outline of commands for long scripts.
**Fix:** a simple formatter (uppercase keywords, one subcommand per line, two-space indent) and a command outline in a dropdown ("Přejít na příkaz…", go to command, Ctrl+Shift+O).
**P2 · M**

### 3.5 Output (`features/output/*`, `styles/output.css`)

**OUT-1: Wide tables are clipped, and the paper wastes width.**
The fixed paper (about 880 px) on a 1440 screen with a 260 px outline leaves about 300 px unused, while the t-test table overflows by 19 px with the last column cut ("Horn…", `,2`) (`31-ttest-table-hover.png`). The hover action pill overlaps the table title.
**Fix:** let the paper grow to `min(100%, 1200px)`. For tables wider than the paper, use horizontal scroll with a **visible** fade or shadow at the edge, sticky row headers and an "Rozbalit na celou šířku" (expand to full width) button. Move item actions to the table title row (right-aligned, visible on hover and focus, always visible on touch), not floating over content.
**P1 · M**

**OUT-2: The outline adds a redundant level.**
Entry "T-test" → group "T-test" → tables (`31-ttest-table-hover.png`). "COMPUTE +1" is an unreadable entry title (`19-after-compute.png`).
**Fix:** collapse an entry's single top-level group into the entry. Title entries by the *dialog* that produced them, in Czech ("Vypočítat proměnnou sleep_def", "T-test: gpa podle gender"), and fall back to command names for raw syntax. Show the time muted on the right, and a status dot for errors.
**P1 · S**

**OUT-3: No "edit and run again".**
The paper header offers "Vložit syntaxi do editoru" (paste syntax to editor) and Delete only (walkthrough log `paper actions`).
**Fix:** store `{specId, values}` on `OutputEntry` when a dialog produced it, then:
- **"Upravit…"**: reopens the dialog with exactly those values (Ctrl+E on a selected entry);
- **"Spustit znovu"**: re-runs on the current data, for example after fixing a value. With the "Nahradit výsledek" (replace result) option, the new run replaces the old entry, which gives a clean report.

This is the core expert loop, and it beats SPSS's Dialog Recall because it is tied to a specific result.
**P0 · M**

**OUT-4: No plain-language interpretation.**
Beginners face `Sig. (oboustranná) ,414` and Levene's test with no explanation.
**Fix:** an optional **"Co to znamená"** (what it means) card under key tables, generated client-side from the table values. It is collapsible and controlled by a setting "Vysvětlovat výsledky" (explain results: Vždy / Na vyžádání / Nikdy, always / on request / never; default "Na vyžádání" for new profiles). See §5 feature F5 for templates and rules.
**P1 · L**

**OUT-5: Copying is plain, with no APA option.**
"Kopírovat tabulku" (copy table) copies the HTML/TSV of the styled table. Researchers need APA 7: no vertical rules, a title in italics, a note line, two decimals, p as `< .001`, and no leading zero for bounded statistics.
**Fix:** a "Kopírovat ▾" split button: *Jako tabulka* (as table, current behaviour), *Ve stylu APA* (APA style: HTML for Word/Docs, with the number format following the UI locale or an override), *Jako text* (as text, TSV), *Jako obrázek* (as image, PNG, for charts and tables). Add **"Kopírovat výsledek větou"** (copy result as a sentence): `t(113) = 0,82; p = 0,414; d = 0,16` (Czech) or `t(113) = 0.82, p = .414, d = 0.16` (APA EN).
**P1 · M**

**OUT-6: No pinning, comparison or history.**
Every run appends. After 20 runs the document is a log, not a report.
**Fix:** **Pin** (📌) an entry: pinned entries collect in a "Připnuté" (pinned) section at the top of the outline and can be exported alone as "Report". **Historie spuštění** (run history): the outline groups entries by session or day, entries can be multi-selected and deleted together, and "Porovnat" (compare) shows two versions of the same analysis side by side (diff highlights changed cells).
**P1 · M (pin) / L (compare)**

**OUT-7: Number formatting conventions.**
PSPP prints `,414` and `-,09`, the SPSS style with no leading zero, everywhere including means. Czech typography and APA both want a leading zero for unbounded statistics.
**Fix:** a setting in "Data a čísla": "Úvodní nula u desetinných čísel" (leading zero: Vždy / Jen kde dává smysl (APA) / Nikdy jako SPSS; always / only where meaningful (APA) / never as in SPSS). Default "Vždy". Apply it via a post-process in table HTML (`engine` output → `formatOutputNumbers`).
**P1 · S–M**

**OUT-8: Deletion has no undo.**
Delete entry or item is immediate (`remove(id)`). Only "Vymazat vše" (clear all) asks for confirmation.
**Fix:** a toast with "Zpět" (undo) for entry or item deletion, and keep the last 20 deletions in memory.
**P1 · S**

**OUT-9: Effect sizes are missing.**
PSPP's T-TEST and ONEWAY lack Cohen's d and η².
**Fix:** compute from the group statistics already in the output (n, mean, SD) and append a small table "Velikost účinku" (effect size) with d, a 95 % CI and an interpretation label (malý/střední/velký, small/medium/large, after Cohen). Do the same for ONEWAY (η² from the sums of squares) and crosstabs (Cramérovo V from χ²). Mark it "dopočteno v PSPP Studiu" (computed in PSPP Studio) for transparency.
**P1 · M**

**OUT-10: Chart actions.**
Charts have Delete only (`actions(false)`), with no copy or download as PNG/SVG, although `src/charts/export.ts` exists.
**Fix:** add Copy image, Download SVG/PNG, and "Upravit graf…" (edit chart: title, axis labels, sort order) as a light inspector.
**P1 · S**

**OUT-11: The empty Output only offers Frequencies and Descriptives.**
**Fix:** use the assistant entry point: "Co chcete zjistit?" (What do you want to find out?) with 4 goal cards (popsat proměnné / porovnat skupiny / vztah dvou proměnných / ověřit spolehlivost škály: describe variables / compare groups / relation of two variables / check scale reliability) and "nebo otevřete nabídku Analýza" (or open the Analýza menu).
**P2 · S**

### 3.6 Analysis dialogs (`features/dialogs/*`)

**DLG-1: Dialog work is lost on dismiss, and settings are not persisted.**
A scrim click calls `onClose`, which discards everything (walkthrough log: Descriptives selections lost after a scrim click). `lastValues` is an in-memory `Map`, so it is empty after a reload and not tied to a dataset.
**Fix:** (a) a scrim click does **not** close analysis dialogs; only ✕, Esc or Zrušit (cancel) do; (b) save the draft on *any* close, so reopening restores it, with "Obnovit" (reset) to clear; (c) persist `lastValues` per dataset in the autosave state; (d) a toolbar **"Poslední dialog"** (last dialog) button and Ctrl+Shift+R, listing the last 10 dialogs as SPSS Dialog Recall does.
**P0 · S–M**

**DLG-2: The dialogs ignore measurement level and labels.**
No spec sets `measures`, so nothing warns about a mean of a nominal variable. Frequencies uses the same default statistics for all variables (`35-frequencies-chart-output.png`: mean 2.61 for "Faculty").
**Fix (data-aware dialogs):**
- In source lists, **sort or group by suitability**: for t-test test variables show *scale* first; for the grouping slot show nominal/ordinal variables with exactly 2 labelled values first, with a badge "2 skupiny" (2 groups).
- **Soft validation.** Accept any variable, but warn inline: "faculty je nominální, průměr nedává smysl. Použijte Četnosti nebo změňte úroveň měření." (faculty is nominal, the mean is meaningless. Use Frequencies or change the measurement level.) with a [Změnit na spojitou] (change to scale) action.
- **Smart defaults.** Frequencies: statistics *off* for nominal variables, median and quartiles for ordinal, and suggest a histogram for scale and a bar chart for categorical variables. Crosstabs: suggest χ² when both are nominal.
- **Group definition from labels.** In the t-test, once a grouping variable is set, show two selects filled with its value labels (`1 · Female`, `2 · Male`), pre-select the two most frequent values, and keep "Dělicí bod" (cut point) as an alternative.

Implementation: a `DialogSpec.hints?: (values, ctx) => Hint[]` and `VarListField.prefer?: Measure[]` (sort, not filter). Pass value labels and per-variable distinct counts in `DialogContext`.
**P0 · M**

**DLG-3: Sub-dialogs are modal on top of modal.**
"Statistiky…", "Grafy…", "Formát…" and "Možnosti…" open a second modal (`sub && <Dialog>`), the classic SPSS maze. You cannot see the main dialog's choices while in a sub-dialog, and there is no summary of what was changed inside it.
**Fix:** render sub-dialogs as **collapsible sections or tabs inside the same dialog** (accordion on mobile, a tabs row on desktop: *Proměnné · Statistiky · Grafy · Možnosti*, variables / statistics / charts / options). Each section header shows a summary of non-default choices ("Statistiky: průměr, SD, medián", mean, SD, median), and a dot marks sections that changed. Keep the button labels for SPSS familiarity as tab names.
**P1 · M**

**DLG-4: No keyboard path to run or paste.**
Enter in a field does nothing, and there is no Ctrl+Enter. Target lists cannot be navigated with arrow keys and their items are not focusable (`renderVarList` handles only Delete/Backspace). The arrow buttons are disabled until a source item is selected.
**Fix:** **Ctrl+Enter = OK/Spustit**, **Ctrl+Shift+Enter = Vložit do syntaxe**, shown in button tooltips. Target lists get the same keyboard model as the source list: ↑/↓, Shift+↑/↓, Delete/← to move back. **→ / Enter** in the source list moves to the first suitable target, and **Ctrl+1/2/3** moves to target list 1, 2 or 3. Type-ahead in the source list. Ctrl+A selects all filtered variables.
**P1 · S–M**

**DLG-5: The primary button says "OK".**
`dialogs.ok = "OK"` is vague. It does not tell the user that pressing it runs a computation.
**Fix:** "Spustit" (Run) for analyses and "Použít" (Apply) for transformations and data commands. Keep "Vložit do syntaxe" (paste to syntax) as a secondary button, and "Zrušit" (cancel) as text. SPSS users adapt instantly. The verb is what matters for beginners.
**P1 · S**

**DLG-6: Validation is late and global.**
Errors show only after OK, as one red bar ("Zadejte výraz.", enter an expression: `19-after-compute.png` sequence). The field is not marked (`aria-invalid` missing) and the OK button stays enabled.
**Fix:** field-level messages next to the offending field, `aria-invalid` plus `aria-describedby`, and the error bar names the field and focuses it. Keep OK enabled but make the first click focus the first invalid field, which beats a disabled button for discoverability.
**P1 · S**

**DLG-7: The expression editor (Compute) is heavy and fragile.**
- The token keyboard is rendered **twice** (expression *and* condition), 46 chips (`17-compute.png`).
- Inserting a variable sets the caret in `requestAnimationFrame`. Fast typing right after a double-click insert produced `sleep  6<` instead of `sleep < 6` (`18-compute-filled.png`). Slow typing worked (walkthrough log). This is a race.
- There is no expression validation, so a syntax error only appears in Output after the run. The failed COMPUTE still **created** an empty `sleep_def` variable (status went from 12 to 13 variables; `19-after-compute.png`).

**Fix:** one shared token and function palette that targets the last-focused expression field, with functions grouped and searchable (Aritmetické, Statistické, Textové, Datum, Chybějící hodnoty: arithmetic, statistical, text, date, missing values) and a one-line Czech description each. Use a CodeMirror single-line editor with PSPP highlighting and variable autocomplete in place of the textarea; that removes the caret race. Validate client-side (balanced parentheses, known variables and functions) and show "Náhled: prvních 5 hodnot" (preview: first 5 values) by evaluating on the mock engine for 5 rows. On engine error, offer to undo automatically ("Výpočet selhal, změny byly vráceny.", the computation failed and changes were reverted).
**P0 (caret race, phantom variable) / P1 (rest) · M**

**DLG-8: Recode requires PSPP grammar.**
"Stará hodnota" (old value) expects `1 THRU 5`, `LOWEST THRU 3`, `SYSMIS`, `ELSE`, typed by hand (`16-recode-different.png`). The input/output pair uses a `<select>`, inconsistent with the var-list paradigm used everywhere else.
**Fix:** each old-value row gets a type selector (Hodnota / Rozsah / Od nejnižší do / Od … do nejvyšší / Chybějící / Vše ostatní: value / range / lowest to / … to highest / missing / everything else) with typed inputs. Pre-fill rows from the source variable's labels and observed values ("Doplnit hodnoty z dat", fill values from data). Add a "Popisky nových hodnot" (labels for new values) column so the new variable gets value labels in the same step, the most-missed SPSS feature. Live preview: "Překóduje se 120 případů: 1–2 → 1 (54×), 3 → 2 (31×), 4–5 → 3 (33×), chybějící 2×." (120 cases will be recoded…)
**P1 · L**

**DLG-9: Help leaves the app, in English.**
"Nápověda" (help) opens the GNU PSPP manual (English) in a new tab.
**Fix:** a "?" popover with **2–3 Czech sentences per dialog**: *kdy použít* (when to use), *předpoklady* (assumptions), *co uvidíte ve výstupu* (what you will see in the output), plus "Celá příručka (anglicky)" (full manual, in English) as a link. The text lives in `i18n` keys `help.<specId>.*`.
**P1 · M**

**DLG-10: The source list counts only its own items, and labels are truncated.**
The badge shows the remaining count. Long labels are truncated with no tooltip on touch. The dialog cannot show variable *labels instead of names* (an SPSS option).
**Fix:** setting "V seznamech zobrazit: název · popisek · obojí" (show in lists: name · label · both), plus a tooltip that includes the measurement level.
**P2 · S**

**DLG-11: The syntax preview is collapsed and its state is forgotten.**
`showPreview` is local state that resets every time.
**Fix:** persist it as a user setting. Experts keep it open, beginners closed. Add syntax highlighting and a copy button.
**P2 · S**

### 3.7 Settings & profile (`features/settings`, `features/shell/ProfileMenu.tsx`)

**SET-1: Settings open on Profile.**
`useState(section ?? 'profile')`. For a local-only app, display name, initials, avatar colour and photo are the least valuable settings, yet they are the first thing you see (`39-settings-default.png`).
**Fix:** open on **Vzhled** (appearance) or on a new **Obecné** (general) page that holds language, theme, decimal separator, value-labels default and "Vysvětlovat výsledky" (explain results). Move Profile to the bottom.
**P1 · S**

**SET-2: No analysis or output preferences.**
Missing: leading zero (OUT-7), p-value format (`p < 0,001`), default CI level, show interpretation (OUT-4), APA copy locale, default charts for Frequencies, output table style per export, "Spustit znovu nahrazuje výsledek" (re-run replaces result).
**Fix:** a new section **"Analýza a výstup"** (analysis and output).
**P1 · S**

**SET-3: No search in Settings, and no shortcut customisation.**
**Fix:** a search field at the top of the settings nav (filters rows), and an editable shortcut list later (P2).
**P2 · M**

**SET-4: The profile popover is overloaded.**
Greeting, "Místní profil" (local profile), Manage, language, theme, Settings and About sit in one popover. It duplicates the menus.
**Fix:** keep language and theme quick toggles and Settings. Drop the greeting and "Spravovat profil" (manage profile), because the avatar click already says who you are. Consider removing the avatar entirely until accounts or sharing exist, and replace it with a "⚙︎" button. The redesign team should decide.
**P2 · S**

### 3.8 Start screen & files (`features/start`, `app/files.ts`)

**ST-1: The start screen is a template gallery, not an on-ramp.**
Six equal tiles (blank, 3 samples, open, syntax) (`01-start.png`). There is no guidance on *what to do next* after opening a sample, and the samples do not explain what can be learnt from them.
**Fix:**
- Primary row: **Otevřít soubor** (open file, the largest tile; SPSS users come with a `.sav`) · **Prázdná data** (blank data) · **Nová syntaxe** (new syntax).
- "Vyzkoušejte na ukázce" (try a sample): sample cards with 2–3 **guided tasks** each, for example "Studenti: Liší se prospěch mužů a žen? → t-test" (Students: does GPA differ between men and women? → t-test). Clicking a task opens the sample *and* the prefilled dialog with an explanatory banner. This turns samples into a tutorial, which no competitor does well.
- The recent files list shows dataset dimensions ("120 × 12") and lets you remove items.

**P1 · M**

**ST-2: The start screen re-appears in a confusing way.**
`showStart` is a global overlay over the views. The logo click goes "home" while data is open, and the bottom tabs still show Data/Variables as active (no `aria-selected`, but visually present).
**Fix:** treat Start as a real view with its own tab-less state, hide the view tabs while it is shown, and show "Zpět k datům: Průzkum mezi studenty" (back to data) prominently (exists as `start.backToData`, but small and top-right).
**P2 · S**

**ST-3: The import path for CSV, Excel and ODS is invisible.**
The tile says ".sav, .zsav, .por, .csv, .ods, .sps". There is no import wizard (delimiter, header row, decimal comma, types). Czech CSVs use `;` and `,` as decimal separator.
**Fix:** a light **import preview** dialog for CSV/TXT/ODS: detected delimiter, decimal separator, header row, a 10-row preview with a type and measurement-level guess per column, "Importovat". This is the most common real-world entry point, and PSPPIRE's text import is notoriously painful.
**P1 · M**

**ST-4: Saving is ambiguous.**
"Uloženo v tomto prohlížeči" (saved in this browser) with a cloud icon next to the title suggests cloud sync. Ctrl+S opens a "Save as" dialog the first time.
**Fix:** wording "Automaticky uloženo v prohlížeči" (autosaved in the browser) with an info tooltip "Pro sdílení nebo zálohu stáhněte soubor .sav (Ctrl+S)." (To share or back up, download a .sav file.) Use a device or browser icon, not a cloud. Once a file has a name, Ctrl+S re-downloads silently with a toast.
**P2 · S**

### 3.9 Accessibility (WCAG 2.1/2.2 AA)

**A11Y summary.** About 18 issues: 3 critical, 9 major, 6 minor. Contrast is excluded because the palette is being replaced. Check it again on the new tokens: muted text (`--muted`), placeholder text, hairline borders against 1.4.11 at 3:1, and the focus ring.

| # | Issue | WCAG | Sev. | Recommendation |
|---|---|---|---|---|
| A-1 | The data and variable grids are canvas (Glide). The grid exposes `role="grid"` with row and column counts but **no `aria-label`**. Cell editing, header menus and the Variable View choice cells (`▾`, `…`) are reachable only by mouse or by second-click activation; the header menu has no keyboard trigger. | 2.1.1, 4.1.2 | Critical | `aria-label="Data: Průzkum mezi studenty"` (and "Proměnné"). Shift+F10 / context-menu key opens the header or cell menu for the focused cell. Enter on Type/Values/Missing opens the dialog, and Space on Measure/Align/Role opens the choice menu (`onCellActivated` exists; make sure keyboard activation reaches it). |
| A-2 | Dialog target lists: items are not focusable and there is no arrow navigation, so variables cannot be removed by keyboard (`renderVarList`). | 2.1.1 | Critical | Roving `aria-activedescendant` as in the source list, plus DLG-4. |
| A-3 | Output outline `role="tree"` with `treeitem`s containing buttons. There is no ↑/↓/←/→ handling and selection is not keyboard-driven. | 2.1.1, 4.1.2 | Major | Implement the WAI-ARIA tree pattern, or downgrade to a plain nested list of links (simpler and fully valid). |
| A-4 | View tabs: mixed roles, no `tabpanel`, no arrow keys (SH-9). | 4.1.2 | Major | See SH-9. |
| A-5 | No `<h1>` anywhere in the app shell. Output paper titles are `h2`, the start screen has an `h1` only on Start. | 1.3.1, 2.4.6 | Minor | A visually hidden `h1` with the dataset title plus view ("Průzkum mezi studenty: Data"). |
| A-6 | Dialog errors are not tied to fields (DLG-6). | 3.3.1, 3.3.3 | Major | `aria-invalid`, `aria-describedby`, focus the first invalid field. |
| A-7 | Toasts carry actions ("Zpět") but disappear after 4.5 s, or 8 s with an action. Keyboard users cannot reach them in time. | 2.2.1 | Major | Pause on hover or focus, keep action toasts until dismissed (with a max-stack), and announce them via `role="status"` (errors: `role="alert"`). F6 cycles into the toast region. |
| A-8 | Hover-only item actions in Output (copy, delete) are revealed on hover. On touch they overlap content (`57-mobile-output.png`). Keyboard reveal on `:focus-within` needs verification. | 2.1.1, 1.4.13 | Major | Always visible in the title row on coarse pointers, `:focus-within` reveal on desktop. |
| A-9 | Menu bar items are 24 px high (`.menubar-item {height:24px}`), at the WCAG 2.2 target-size minimum. The chip tokens in Compute are around 26 px. | 2.5.8 | Minor | 28–32 px height on desktop, ≥ 44 px on coarse pointers (the media query exists; extend it to the menu bar and chips). |
| A-10 | The scrim click closes dialogs (also a data-loss issue). Combined with drag-and-drop in dialogs, an imprecise drag release outside closes the dialog. | 3.2.2 (predictability) | Major | DLG-1(a). |
| A-11 | Colour as the only signal: user-missing in red, error badges on tabs (a number in a red pill), engine status as a dot. | 1.4.1 | Minor | Icon plus text: "∅" for missing, "⚠ 2" for errors, and the status text is already present. |
| A-12 | Canvas-drawn measurement icon in Variable View is not exposed to assistive technology. | 1.1.1 | Minor | Include the measurement level in the cell's accessible text ("gender, nominální"). |
| A-13 | `prefers-reduced-motion` exists, but smooth scrolling in Output (`scrollIntoView({behavior:'smooth'})`) ignores it. | 2.3.3 (AAA) / comfort | Minor | Check `matchMedia` before smooth scrolling. |
| A-14 | Zoom: UI zoom via the toolbar select scales the grid, but browser zoom at 200 % on 1280 px collapses to the 640 px layout, where the menu bar is hidden (SH-3). | 1.4.10 | Major | Fix SH-3. Verify reflow of dialogs at 320 CSS px (the mobile dialog is OK, `54-mobile-ttest-dialog.png`). |
| A-15 | The palette `combobox` has `aria-expanded="true"` always, and results are not announced (no live count). | 4.1.3 | Minor | `aria-live="polite"` text "12 výsledků" (12 results). |
| A-16 | The language of dataset content (English labels) inside a `lang="cs"` document. Screen readers read English labels with Czech phonetics. | 3.1.2 | Minor | Fix with localized samples (DV-14). For user data this is acceptable. |
| A-17 | The profile popover `role="dialog"` does not trap focus and does not return focus on outside click. | 2.4.3 | Major | Use the shared `Dialog`/popover primitive with focus management. |
| A-18 | Glide's overlay editor for value-labelled cells has no accessible name for the column. | 4.1.2 | Major | Pass `aria-label="${v.name}, případ ${row+1}"` (case N) to the custom editor (DV-2). |

**Keyboard map today vs proposed** (experts): see §5 F12.

### 3.10 Copy & microcopy (`src/i18n/cs.json`)

**Voice:** calm, concrete and helpful. Use the polite plural "vy" without capital letters. Prefer verbs. Use SPSS terms where a Czech SPSS user expects them (případ, proměnná, popisek hodnoty, úroveň měření: case, variable, value label, measurement level), and explain them on first encounter instead of replacing them.

**CP-1: Primary actions are vague.**

| Key | Now | Proposed | Note |
|---|---|---|---|
| `dialogs.ok` | OK | **Spustit** (analysis) / **Použít** (transform, data) | needs `spec.kind: 'analysis'│'transform'│'data'` |
| `common.ok` (variable dialogs) | OK | **Uložit** (save) | ValueLabels, Missing, Type |
| `valueLabels.clearAll` | Odstranit vše | **Odstranit všechny popisky** (remove all labels) | destructive, so specify the object |
| `output.clearConfirm` | Vymazat | **Vymazat výstup** (clear output) | button = action + object |
| `files.discardConfirm` | Zahodit | **Zahodit změny** (discard changes) | — |
| `start.resume` | Pokračovat | **Obnovit relaci** (restore session) | "Pokračovat" (continue) is generic |

**CP-2: Jargon without explanation (keep the term, add a hint).**

| Term | Where | Proposed tooltip / helper |
|---|---|---|
| Případ (case) | status bar, menus | "Případ = jeden řádek dat (např. jeden respondent)." (case = one row of data, e.g. one respondent) |
| Úroveň měření (measurement level) | Variable View | "Nominální: kategorie bez pořadí (obor). Ordinální: kategorie s pořadím (spokojenost 1–5). Spojitá: měřené číslo (věk, mzda)." (Nominal: categories without order (field of study). Ordinal: ordered categories (satisfaction 1–5). Scale: a measured number (age, salary).) |
| Spojitá (scale) | measure.scale | keep, add "(škála)" in the menu: "Spojitá (škála)" |
| Chybějící hodnoty (missing values) | Variable View | "Kódy, které znamenají „bez odpovědi" a nemají se počítat (např. 9 nebo 99)." (codes that mean "no answer" and should not be counted, e.g. 9 or 99) |
| Rozdělení / Vážení / Filtr (split / weight / filter) chips | toolbar | "Bez rozdělení" → "Rozdělit soubor: ne" (split file: no)? Prefer short chips with a tooltip: "Analýzy se počítají zvlášť pro každou skupinu" (analyses run separately for each group) etc. |
| Sig. (oboustranná) | output (PSPP) | covered by the interpretation card (OUT-4) |
| Provést čekající transformace (run pending transformations) | Transformace | "Provést čekající transformace (EXECUTE)": experts know it as EXECUTE |

**CP-3: Inconsistent command names in labels.**
Some items carry the PSPP command in parentheses ("Přidat případy (ADD FILES)…", "Podmíněná transformace (DO IF)…", "Jednorozměrná analýza (GLM)…", "Proměnné (DISPLAY)…"), most do not.
**Rule:** never in the label. Show the command as muted secondary text in menus ("Přidat případy… · ADD FILES") and in the palette. This keeps labels clean for beginners and searchable for experts, since `keywords` already contain the command.

**CP-4: Error messages: what happened + why + how to fix.**

| Key | Now | Proposed |
|---|---|---|
| `data.invalidValue` | „x" není platná hodnota proměnné age. | **„x" nelze uložit do proměnné age – očekává se číslo. Pro text změňte typ proměnné.** ("x" cannot be stored in age, a number is expected. To store text, change the variable type.) [Změnit typ] |
| `variables.invalidName` | „1abc" není platný nebo jedinečný název proměnné. | Split into two: **„1abc" musí začínat písmenem.** (must start with a letter) / **Proměnná „age" už existuje.** (variable "age" already exists) |
| `run.errors` (toast) | Výpočet skončil s 1 chybou. | **Výpočet skončil s chybou na řádku 1: očekáván konec příkazu.** (The computation failed on line 1: end of command expected.) [Zobrazit] [Upravit dialog] (Show / Edit dialog) |
| `files.needsEngine` | (long) | **Tento formát potřebuje jádro PSPP, které se nenačetlo. Zkuste stránku obnovit, nebo otevřete CSV.** (This format needs the PSPP engine, which did not load. Try reloading the page, or open a CSV.) |
| `dlg.errors.needVariables` | (generic) | name the list: **Přidejte aspoň jednu proměnnou do „Testované proměnné".** (Add at least one variable to "Test variables".) |

**CP-5: Empty states: what this is + why it is empty + how to start.**

| Surface | Proposed |
|---|---|
| Output (`output.emptyText`) | **Zatím jste nic nespustili.** (You have not run anything yet.) Výsledky analýz se tu skládají do dokumentu, který můžete exportovat. (Results collect here into a document you can export.) → [Co chcete zjistit?] [Četnosti] [Popisné statistiky] |
| Data without dataset | **Žádná data.** (No data.) Otevřete soubor .sav nebo CSV, začněte psát do prázdné tabulky, nebo si vyzkoušejte ukázku. (Open a .sav or CSV file, start typing into an empty table, or try a sample.) |
| Recent files | **Tady uvidíte soubory, které otevřete.** (Files you open will appear here.) Zůstávají jen v tomto prohlížeči. (They stay only in this browser.) |
| Palette no results | **Nic jsme nenašli pro „…".** (Nothing found for "…".) Zkuste název proměnné, příkaz PSPP nebo cíl, např. „porovnat skupiny". (Try a variable name, a PSPP command or a goal, e.g. "compare groups".) |
| Outline empty | ok as is |

**CP-6: Placeholders vs examples.**
Replace value-like placeholders (`new_var`, `1 THRU 5`, `MEAN(x1, x2) * 10`, `age >= 18`) with helper text below the field: "Např. MEAN(x1, x2) * 10" (e.g.). Placeholders that look like values get submitted mentally but not actually, a known usability trap.

**CP-7: Small fixes.**
- `data.newVarHeader` "prom" → remove (DV-8).
- `menu.legacyDialogs` "Klasické dialogy" → remove (SH-2).
- `appbar.savedInBrowser` → "Automaticky uloženo v prohlížeči" (ST-4).
- `syntax.hint` "Ctrl+Enter spustí aktuální příkaz" (Ctrl+Enter runs the current command): good, keep.
- `start.subtitle` "Statistická analýza přímo v prohlížeči, poháněná GNU PSPP." → "Statistika v prohlížeči. Vaše data neopouštějí počítač." (Statistics in the browser. Your data never leaves your computer.) Privacy is the stronger promise for Czech academic users. GNU PSPP credit moves to About.
- `formula.selectCell` "Vyberte buňku" (select a cell) → "Klikněte na buňku a uvidíte její hodnotu" (click a cell to see its value), only while no selection exists.
- Use the typographic ellipsis `…` consistently (done) and the en dash in ranges (`1–5`).
- Use "Výstup" consistently for the view, never "Protokol" (`output.log`) for the entry title of a raw run. Proposed: "Syntaxe (bez výstupu)" (syntax, no output).

### 3.11 Mobile (390 px)

**MOB-1: Desktop chrome shrunk, not a mobile layout.**
At 390 px the toolbar shows Open/Save/Print/Undo/Redo/Zoom (`51-mobile-data.png`). The formula bar (with `fx`) takes another row, leaving about 60 % of the height for data.
**Fix:** on `max-width: 600px` hide the toolbar and formula bar. Put Undo/Redo in the app bar, and use a bottom **action sheet** for cell actions (tap a cell → sheet with value editor and label picker). The view tabs become a 4-item bottom nav (Data, Proměnné, Výstup, Syntaxe), with syntax tabs in a sheet.
**P1 · M**

**MOB-2: Dialogs are long single columns, and the main action needs scrolling.**
The t-test dialog is about 2.5 screens. The footer is sticky (good, `54-mobile-ttest-dialog.png`), but "Testované proměnné" (test variables) sits below the source list, so the user scrolls between list and target.
**Fix:** on mobile, replace the source/target paradigm with **slot pickers**: each target is a field "Testované proměnné: [+ Přidat]" that opens a full-screen searchable picker with measurement icons and checkboxes. This is the jamovi-mobile and iOS pattern. Same spec, a different renderer for var-lists.
**P1 · M**

**MOB-3: Output on mobile.**
Tables clip with no scroll cue, and the floating action pill covers the title of the next table (`57-mobile-output.png`).
**Fix:** OUT-1, plus "Zobrazit tabulku na celou obrazovku" (show table full screen) with pinch-zoom. Show the interpretation card (OUT-4) *above* the table on mobile.
**P1 · S**

**MOB-4: The drawer menu is a long accordion** (`53-mobile-drawer.png`).
That is acceptable, but put **Hledat** (search, the palette) at the top of the drawer and a "Časté" (frequent) section (last 5 dialogs). Most mobile use will be "look at results, run a quick frequency".
**P2 · S**

---

## 4. Benchmark: what users expect and where SPSS fails

| Area | SPSS / PSPPIRE convention (users expect) | SPSS pain point | Who does it better | PSPP Studio today | Target |
|---|---|---|---|---|---|
| Data entry | Data View / Variable View tabs, value-label toggle | Labels off by default, no label picker in cells (SPSS has a dropdown only with the "value labels" toolbar on) | jamovi: labels everywhere, level icons in headers | same as SPSS | DV-1/2/3 |
| Variable setup | 11-column grid, Define Variable Properties wizard | Wizard hidden, bulk edit clumsy | jamovi: side "setup" panel per variable; Notion: property panel | 11 columns, template for Define Properties | Inspector (F1) + VV-1/3 |
| Dialogs | source → target lists, sub-dialog buttons, **Paste** | Modal maze, no recall per result, no test guidance | JASP/jamovi: live results while you edit options, no OK button | faithful clone + preview | DLG-1/2/3, OUT-3 |
| Test choice | Analyze menu taxonomy | Must know the test name | JASP "Analyses" ribbon with simple names; Intellectus/Statkat decision trees | none | Assistant (F5) |
| Output | Viewer with navigator, pivot tables | Cryptic, verbose, ugly copy-paste, no interpretation | JASP: APA tables, copy as LaTeX/HTML; jamovi: inline results; R Markdown | navigator plus paper, clipping | OUT-1…10 |
| Reproducibility | Syntax + journal file | Journal hidden, dialogs not recorded unless pasted | Observable/Jupyter: every cell recorded; jamovi: syntax mode per analysis | Paste only | Journal (SY-5) |
| Speed | Alt mnemonics, Dialog Recall, toolbar | Repetitive clicking | Raycast/Linear: command palette with entity search and actions; Linear: "repeat last" and shortcuts on everything | palette over menus only | F10–F12 |
| Charts | Chart Builder | Complex, ugly defaults | jamovi/JASP: plots as dialog options; Datawrapper: tidy defaults | 4 templates only | real chart dialogs (WP3) |

**The positioning in one line:** *"SPSS you already know, but it reads your data, explains your results, and remembers your work."*

---

## 5. New features: evaluated

Value: **★** (low) to **★★★★★** (high). Effort: S/M/L. Verdict: **Build**, **Refine** (build in a changed form) or **Reject/Defer**.

| ID | Feature | Value B | Value E | Effort | Verdict |
|---|---|---|---|---|---|
| F1 | Variable inspector side panel | ★★★★★ | ★★★★ | L | **Build** (refined) |
| F2 | Value-label chips in grid cells + edit by picking a label | ★★★★ | ★★★ | M | **Refine**: label *text* in cells, chips only in the inspector and Variable View |
| F3 | Measurement-level indicators in column headers and dialog lists | ★★★★ | ★★★ | S | **Build** (lists already done; headers missing) |
| F4 | Flags for values outside labels / out of range | ★★★ | ★★★★ | M | **Build** |
| F5 | Goal-based Analysis assistant (menu stays) | ★★★★★ | ★★ | M–L | **Build** (refined) |
| F6 | Plain-language interpretation in Czech | ★★★★★ | ★★ | L | **Build** for 6 procedures first |
| F7 | APA-style table copy | ★★★ | ★★★★★ | M | **Build** |
| F8 | Pinned results / run history | ★★★ | ★★★★ | M | **Build** pin + history; **Defer** compare |
| F9 | Split view data + output | ★★ | ★★★★ | M | **Refine**: split *Output ∥ Data or Syntax*, desktop ≥ 1280 px only |
| F10 | Journal of syntax generated by every action | ★★ | ★★★★★ | M | **Build** |
| F11 | Repeat last analysis / dialog recall / re-run from output | ★★★ | ★★★★★ | S–M | **Build** (P0) |
| F12 | Command palette extensions (variables, actions on selection) | ★★★ | ★★★★★ | M | **Build** |
| F13 | Keyboard shortcuts everywhere | ★ | ★★★★★ | M | **Build** (with a cheat sheet) |
| F14 | Better empty states | ★★★★ | ★ | S | **Build** |
| F15 | Undo for transformations | ★★★★ | ★★★★ | S | **Already exists**; **Refine**: named undo + toast (DV-11) |
| F16 *(new)* | Guided sample tasks on the start screen | ★★★★★ | ★ | M | **Build** |
| F17 *(new)* | Effect sizes appended to t-test / ANOVA / crosstabs | ★★★★ | ★★★★ | M | **Build** |
| F18 *(new)* | CSV/ODS import preview with type and level detection | ★★★★ | ★★★★ | M | **Build** |
| F19 *(new)* | Data-aware dialogs (preferred variables, smart defaults, label-based groups) | ★★★★★ | ★★★★ | M | **Build** (P0) |
| F20 *(new)* | Live result preview inside dialogs (jamovi-style) | ★★★★ | ★★★ | L | **Defer**: needs fast engine round trips; revisit after F11/F19 |
| — | AI chat "ask your data" | ★★★ | ★★ | L | **Reject for now**: offline/privacy promise, and the interpretation templates (F6) give 80 % of the value deterministically |

### F1: Variable inspector (refined)

- **Where:** a right-side panel (320 px, resizable, collapsible; toggle with **Ctrl+I** and a toolbar button "Vlastnosti", properties) in **Data** and **Proměnné** views. It follows the selected column (Data) or row (Variables). On mobile it is a bottom sheet from the column header.
- **Sections** (top to bottom):
  1. **Header:** measurement icon + name (editable) + label (editable, placeholder "Přidat popisek…", add a label). The type is shown as a muted pill "Číselná · F8.2", which opens the Type dialog.
  2. **Úroveň měření** (measurement level): a 3-option segmented control with icons (Nominální · Ordinální · Spojitá) and a one-line explainer. A suggestion appears if it looks wrong ("Proměnná má jen 2 hodnoty, není spíš nominální?", the variable has only 2 values, isn't it nominal?).
  3. **Popisky hodnot** (value labels): **chips** `1 Female` `2 Male`, with click to edit inline, "+ Přidat" (add), "Doplnit z dat" (fill from data, observed unlabeled values), and "Kopírovat na…" (copy to, other variables).
  4. **Chybějící hodnoty** (missing values): chips `9 No answer` plus "Žádné" (none); add or remove.
  5. **Rozložení** (distribution): a mini histogram (scale) or bar list with counts and % (categorical, top 8 + "další", more). N valid / missing, plus mean/SD or median/IQR for scale. This is computed client-side from the column (cheap, no engine call), with a debounced recompute on data change.
  6. **Kontrola dat** (data check, F4): "2 hodnoty bez popisku (7, 8)", two values without a label, with [Zobrazit] (show), which filters the grid to them.
  7. **Rychlé akce** (quick actions): Četnosti · Popisné statistiky · Graf · Překódovat… · Vypočítat z této proměnné… · Seřadit (frequencies · descriptives · chart · recode… · compute from this variable… · sort). All open prefilled dialogs.
- **Why refined:** the original idea lists everything. The order above prioritises *meaning* (level, labels) over *storage* (type, width). Width, decimals, align and columns appear only in a collapsed "Formát a zobrazení" (format and display) section.
- **Ownership:** new `src/features/inspector/` (WP2). The shell exposes a right-panel slot (WP1).

### F2: Value labels in cells (refined)

Chips inside every grid cell would be visually noisy at 120 rows × 12 columns and slower on the canvas. **Instead:** cells show the label *text* (DV-1), with an optional thin coloured left tick per category (a setting, off by default), and **editing** uses the label combo editor (DV-2). Chips appear in the inspector, Variable View, the dialog group pickers and the recode rows.

### F3: Measurement indicators

Already in dialog lists (`variableIcon`). Add to: grid headers (DV-3), the Variable View name cell (VV-2, move the icon to the left), inspector, palette results (F12) and the output table headers? (no; keep output clean). **One icon set, one helper** (`app/varIcons.ts`). Also add **text-variable** and **date** icons in all places (exists).

### F4: Out-of-label / out-of-range flags

The rules (computed client-side, memoised per column revision):
- nominal/ordinal with ≥ 2 value labels: a value that is not labelled and not missing → flag "bez popisku" (no label);
- scale with an optional **valid range** (a new optional variable property `validRange {min,max}`, stored in-app and exported as a DOCUMENT/comment): outside the range → flag "mimo rozsah" (out of range);
- string: leading or trailing whitespace, or case variants of an existing label → flag "možný překlep" (possible typo).

Surfaces: a cell corner mark (DV-6), an inspector section, a Variable View column "Kontrola" (check, count) in all-columns mode, and Data toolbar "Zvýraznit podezřelé hodnoty" (highlight suspicious values).

### F5: Analysis assistant (refined)

- **Entry points:** toolbar button **"Analyzovat…"** (Ctrl+Shift+A), empty Output, start-screen tasks, palette goal queries, and the Analýza menu top item "Průvodce výběrem analýzy…" (analysis selection guide; the menu stays).
- **Flow (one dialog, 3 steps, no wizard pages):**
  1. *Co chcete zjistit?* (What do you want to find out?) Goal cards: **Popsat proměnnou** · **Porovnat skupiny** · **Porovnat měření u stejných lidí** · **Vztah dvou proměnných** · **Předpovědět hodnotu** · **Spolehlivost dotazníku** (describe a variable · compare groups · compare measurements on the same people · relation of two variables · predict a value · questionnaire reliability).
  2. *Které proměnné?* (Which variables?) Slot pickers filtered and sorted by suitable measurement level ("Co porovnáváte?" → scale; "Podle čeho jsou skupiny?" → nominal with group counts; what are you comparing? / what defines the groups?).
  3. *Doporučení* (recommendation): the recommended test with a one-sentence reason and the alternative ("2 skupiny, spojitá proměnná → **T-test pro nezávislé výběry**. Pokud data nejsou normální nebo je skupina malá (n < 30), použijte **Mann-Whitneyův test**." 2 groups, scale variable → independent-samples t-test; if the data are not normal or a group is small, use the Mann-Whitney test). Buttons: **[Spustit]** (run with sensible defaults) · **[Otevřít dialog]** (open the dialog: the regular SPSS-style dialog, prefilled) · **[Vložit do syntaxe]** (paste to syntax).
- **Decision table** (v1; keep it as data in `features/assistant/rules.ts`):

| Goal | DV level | IV / groups | → Test | Alternative |
|---|---|---|---|---|
| Describe | nominal/ordinal | — | Frequencies + bar chart | — |
| Describe | scale | — | Descriptives + histogram (Explore) | — |
| Compare groups | scale | 2 independent | Independent t-test | Mann-Whitney |
| Compare groups | scale | ≥ 3 independent | One-way ANOVA (+ post hoc) | Kruskal-Wallis |
| Compare groups | ordinal | 2 / ≥ 3 | Mann-Whitney / Kruskal-Wallis | — |
| Compare groups | nominal | nominal | Crosstabs + χ² | Fisher (2×2) |
| Same people | scale | 2 measurements | Paired t-test | Wilcoxon |
| Same people | scale | ≥ 3 measurements | (GLM repeated: syntax template) | Friedman |
| Relation | scale × scale | — | Pearson correlation + scatter | Spearman |
| Relation | ordinal × any | — | Spearman | — |
| Predict | scale DV | ≥ 1 predictors | Linear regression | — |
| Predict | binary DV | ≥ 1 predictors | Logistic regression | — |
| Reliability | ≥ 3 items (ordinal/scale) | — | Reliability (Cronbach α) | — |
| Compare to value | scale | test value | One-sample t-test | Wilcoxon one-sample (syntax) |

- **Refinement vs the original idea:** no separate "assistant mode". The assistant is a *router into the existing dialogs* plus explanations, so experts never pay for it and beginners learn the real menu path ("Příště najdete v Analýza › Porovnání průměrů › T-test pro nezávislé výběry", next time find it in…).

### F6: Plain-language interpretation (Czech)

- **Scope v1:** T-TEST (independent, paired, one-sample), ONEWAY, CORRELATIONS, CROSSTABS χ², REGRESSION (R², coefficients), FREQUENCIES (mode or median sentence). Parse values from the engine's structured table data. Prefer the engine's pivot-table JSON if available in `OutputItem`; otherwise parse table HTML (fragile).
- **Template example (independent t-test):**
  > **Co to znamená:** Průměrný prospěch (gpa) se mezi skupinami **statisticky významně neliší** (t(113) = 0,82; p = 0,414). Ženy: M = 2,78 (SD 0,44), muži: M = 2,71 (SD 0,41). Rozdíl 0,07 bodu je **malý** (d = 0,16). Levenův test (p = 0,146) nenaznačuje rozdílné rozptyly, proto platí první řádek tabulky.
  > *Pozor:* „nevýznamný" neznamená „stejný"; může jít o malý vzorek.

  (Translation: GPA does not differ significantly between the groups, t(113) = 0.82, p = 0.414. Women: M = 2.78 (SD 0.44), men: M = 2.71 (SD 0.41). The 0.07-point difference is small (d = 0.16). Levene's test (p = 0.146) does not suggest unequal variances, so the first table row applies. Note: "not significant" does not mean "the same"; the sample may be small.)
- **Rules:** α from the dialog (default 0.05). Report the direction ("vyšší u…", higher for…). Effect-size labels after Cohen (0.2/0.5/0.8; r 0.1/0.3/0.5; V by df). Always one caveat line. Never claim causality ("souvisí", is related, not "způsobuje", causes).
- **UI:** a collapsible card *under* the table group, a "Kopírovat větu" (copy sentence) button, and a per-entry hide control. Setting "Vysvětlovat výsledky" (SET-2).

### F7: APA copy

OUT-5. One `toApa(tableHtml, locale)` transformer: strip vertical rules and backgrounds, set the title in italics above the table, apply 2 decimals by default and 3 for p, write `p < 0,001` / `< .001`, drop the leading zero for p, r and other bounded statistics, add a note row for Levene/assumptions. Put `text/html` and `text/plain` on the clipboard. Locale: the "Formát APA: české / anglické" setting (Czech decimal comma vs APA English).

### F8: Pinned results and run history

The pin toggle is on the entry header. The outline has a "Připnuté" (pinned) group at the top. "Exportovat připnuté" (export pinned) → HTML/PDF report. Run history is the outline grouped by day, with multi-select delete and a search field in the outline ("Hledat ve výstupu", search the output) that matches titles and variable names. **Compare** (diff two runs) is deferred.

### F9: Split view (refined)

Data and Output side by side is less useful than it sounds, because both need width. The high-value pairs are **Syntax ∥ Output** (write, run, see) and **Output ∥ Data** (spot an outlier, jump to the case). Implement a generic two-pane `SplitView` in the shell (≥ 1280 px, drag divider, Ctrl+\\ toggles, each pane picks a view). Syntax runs in split mode do **not** switch the view; the output pane scrolls to the new entry.

### F10: Journal

SY-5. It records `{time, source: 'dialog'|'syntax'|'grid'|'transform', specId?, syntax}` in a new `store/journal.ts`, persisted with autosave. A "Deník" tab or panel offers Copy all / Download `.sps` / "Otevřít jako syntaxi" (open as syntax). It powers Recall (F11) and run history (F8).

### F11: Repeat / recall / re-run

- **Ctrl+Shift+R**: reopen the last dialog with its values (DLG-1d). The toolbar dropdown lists the last 10 dialogs.
- **Ctrl+R** (in Output, entry selected): "Spustit znovu" (run again) on current data.
- **Ctrl+E**: "Upravit…" (edit) on the selected entry (OUT-3).
- Palette entries: "Zopakovat: T-test gpa podle gender" (repeat: t-test gpa by gender) at the top when the query is empty.

### F12: Command palette extensions

1. **Empty query:** *Nedávné* (recent: last 5 actions or dialogs, with values) → *Navrhované* (suggested, context: e.g. in Data with a column selected: "Četnosti pro gender", "Popisky hodnot pro gender") → *Zobrazení* (views). Not the File menu in order (`25-palette-empty.png`).
2. **Entity search:** variables (name + label, measurement icon). Selecting one offers sub-actions with → / Tab: *Přejít na proměnnou* (go to variable), *Vlastnosti* (properties, the inspector), *Četnosti*, *Popisné statistiky*, *Popisky hodnot…*, *Překódovat…*, as Raycast does.
3. **Goal synonyms:** a keyword map in i18n (`palette.synonyms`): "porovnat skupiny, rozdíl, liší se" → t-test/ANOVA/assistant; "souvislost, vztah" → correlation; "spolehlivost, alfa" → reliability; "průměr" → descriptives.
4. **Fuzzy matching** (typo tolerance, diacritics already normalised): "frekvence" → Četnosti, "ttest" → T-test (works already), "korel" → Korelace.
5. **Prefixes:** `>` commands, `@` variables, `#` output entries, `?` help topics.
6. A live result count for screen readers (A-15).

### F13: Keyboard shortcuts (proposed map; add each to `Action.shortcut`, the cheat sheet and menus)

| Action | Shortcut | Exists? |
|---|---|---|
| Palette | Ctrl+K | ✔ |
| Views Data / Proměnné / Výstup / Syntaxe | Alt+1…4 | ✔ |
| Menus by mnemonic | Alt+S/R/Z/D/T/A/G/N/V | ✘ (SH-8) |
| Analysis assistant | Ctrl+Shift+A | ✘ |
| Recall last dialog | Ctrl+Shift+R | ✘ |
| Run from dialog / Paste from dialog | Ctrl+Enter / Ctrl+Shift+Enter | ✘ |
| Edit / re-run selected output entry | Ctrl+E / Ctrl+R | ✘ |
| Inspector toggle | Ctrl+I | ✘ |
| Toggle value labels | Ctrl+L | ✔ |
| Go to case / variable | Ctrl+G / Ctrl+Shift+G | partial |
| Header/cell context menu | Shift+F10 | ✘ |
| Split view toggle | Ctrl+\\ | ✘ |
| Insert case / variable | Ctrl+Shift+= / Ctrl+Alt+= (avoid conflicts with zoom) | ✘ |
| Next / previous output entry | J / K in Output (when not editing) | ✘ |
| Pin entry | P in Output | ✘ |
| Run current / all (syntax) | Ctrl+Enter / Ctrl+Shift+Enter, F5 | ✔ |
| Save (scoped) | Ctrl+S | ✔ (bug SH-1) |

Show shortcuts in menus (done), button tooltips (partial) and the palette (done). Add a "?" overlay listing shortcuts *for the current view* (Linear-style), in place of the long dialog.

### F14: Empty states

CP-5. Apply them to Output, Data, Variables, Syntax (a new tab: "Napište příkaz, nebo vložte syntaxi z dialogu tlačítkem Vložit do syntaxe.", write a command, or paste syntax from a dialog with the Paste button; plus 3 snippet chips), Recent files, Outline and Palette.

### F15: Undo for transformations

It exists (snapshots). Make it **visible and named** (DV-11). Extend undo to Output deletions (OUT-8) and to variable-property changes from the inspector, which already use `updateVariable`, so this is free. Add an "Historie změn" (change history) popover from a long-press or right-click on Undo, listing the last 20 named steps.

---

## 6. Proposed layout (desktop ≥ 1280 px)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [logo] Průzkum mezi studenty · Automaticky uloženo        [🔍 Hledat  Ctrl+K] [● Počítám…] [⚙] │
│ Soubor Úpravy Zobrazit Data Transformace Analýza Grafy Nástroje Nápověda                      │
├────────────────────────────────────────────────────────────────────────────┤
│ contextual command bar (per view)            [Filtr: vše] [Vážení: ne] [Rozdělení: ne]  [Analyzovat…] │
├──────────────────────────────────────────────────────────────┬─────────────┤
│ Data | Proměnné   (segmented, top of grid area)               │ INSPECTOR   │
│ ┌ grid (labels on, level icons in headers, flags) ─────────┐  │ ◆ gender    │
│ │                                                         │  │ Gender      │
│ │                                                         │  │ ○Nom ●Ord ○Sp│
│ │                                                         │  │ [1 Female][2 Male] │
│ └─────────────────────────────────────────────────────────┘  │ ▁▃▇ 67/48   │
│                                                              │ Rychlé akce │
├──────────────────────────────────────────────────────────────┴─────────────┤
│ Data  Proměnné  Výstup ③  │ Syntax 1 ✕  Deník  +        120 případů · 12 proměnných │
└────────────────────────────────────────────────────────────────────────────┘
```

- 3 chrome rows on top + 1 bottom row (tabs and status merged).
- The right panel slot hosts the **Inspector** (Data/Proměnné), the **Outline** option for Output (or keep it left, as the redesign team decides), and the Journal in Syntax.
- Split view (F9) replaces the main area with two panes.

---

## 7. Walkthrough results (task success, current build)

| Task | Beginner outcome | Expert outcome | Key blockers |
|---|---|---|---|
| Open a sample dataset | ✔ easy (`01-start.png`) | ✔ | — |
| Understand variables | ✖ codes 1/2 shown, English labels, levels invisible in grid | ◐ via Variable View | DV-1, DV-3, DV-14, VV-1 |
| Fix a mistyped value | ◐ must know the code, not the label | ✔ | DV-2, DV-4 |
| Define value labels | ✔ dialog is good; but no "fill from data" | ✔ | VV-5 |
| Recode a variable | ✖ requires `THRU`/`ELSE` grammar | ◐ | DLG-8 |
| Compute a new variable | ◐ caret race; failed run leaves phantom variable | ◐ | DLG-7 |
| Frequencies + descriptives | ◐ meaningless stats for nominal variables | ✔ | DLG-2 |
| Compare two groups (t-test) | ◐ must know "t-test" lives under "Porovnání průměrů"; group codes typed | ✔ | F5, DLG-2 |
| Find a correlation | ✔ dialog fine; output verbose, no interpretation | ✔ | OUT-4 |
| Read and export output | ✖ no explanation; ◐ HTML/print export OK; tables clipped | ◐ no APA copy | OUT-1, OUT-5 |
| Re-run with a change | ◐ menu reopen keeps values (in-session only) | ✖ no recall from result; lost on reload or scrim click | DLG-1, OUT-3 |
| Write syntax | — | ◐ completion shallow; **Ctrl+S bug** | SH-1, SY-3 |
| Non-dialog analyses (Mann-Whitney, Reliability, graphs) | ✖ dead end in template | ◐ rename placeholders | SH-2 |
| Mobile 390 px | ◐ usable but cramped; dialogs long | ◐ | MOB-1…3 |

---

## 8. Work packages for implementation

Three parallel areas with **exclusive file ownership**, so agents do not edit the same files. Shared files (stores, i18n, actions, menus) belong to the **coordinator**. Implementation agents request additions there through small, explicit interface changes listed under each package ("needs from coordinator"). Each list is in priority order.

### WP1: Shell & navigation

**Owns:** `src/App.tsx`, `src/features/shell/**`, `src/features/palette/**`, `src/features/start/**`, `src/features/settings/**`, `src/features/misc/**`, `src/components/{Menu,Dialog,Toasts,IconButton}.tsx`, shell/layout parts of `src/styles/app.css` (coordinate with the restyle agent on tokens).

- [ ] **P0 SH-1** Global key handler: return early on `e.defaultPrevented`; add view-scoped shortcut resolution (`Action.scope`) so Ctrl+S saves syntax in Syntax and the dataset elsewhere. *(S)*
- [ ] **P0 SH-2 stage 1** Menu rendering for `tpl:*`: "Syntaxe" badge or secondary text, no `…`, tooltip. Remove the "Klasické dialogy" header usage (`Menu.tsx`/`menuEntries.ts` rendering; the header key change goes to the coordinator). *(S)*
- [ ] **P0 DLG-1(a)** `Dialog` component: a `closeOnScrim?: boolean` prop already landed during the audit (the restyle work). Make sure every *editing* dialog (analysis, variable dialogs, settings) can opt out. WP3 passes `closeOnScrim={false}` from `DialogRenderer`. *(S)*
- [ ] **P1 SH-4/SH-5** Contextual command bar per view. Remove the duplicate Run button. Make room for per-view slots that WP2 (Data/Variables) and WP3 (Output/Syntax) fill through a `ViewToolbarSlot` API (`registerViewToolbar(view, ReactNode)`), so they do not edit `Toolbar.tsx`. *(M)*
- [ ] **P1 Right-panel slot + split view (F9)**: `PanelSlot` for the Inspector (WP2) and the Journal (WP3), plus `SplitView` (≥ 1280 px, Ctrl+\\). *(M)*
- [ ] **P1 SH-3** Keep the menu bar visible down to 600 px (horizontal scroll, title row condensing). *(S)*
- [ ] **P1 SH-8** Alt mnemonics (underline on Alt, Alt+letter opens the menu). *(S)*
- [ ] **P1 SH-9 / A-4** View tabs: correct tab semantics, roving tabindex, arrow keys, `tabpanel`. Add the Data ⇄ Proměnné segmented switch. Separate syntax-document tabs and the "Deník" tab. *(M)*
- [ ] **P1 F12** Palette: recent and suggested on empty query, variable entities with sub-actions, goal synonyms, fuzzy matching, prefixes, live count (A-15). *(M)*
- [ ] **P1 F13** Shortcut plumbing for the new actions; a "?" per-view shortcut overlay replacing the long dialog. *(M)*
- [ ] **P1 SET-1/SET-2** Settings open on Obecné/Vzhled. New "Analýza a výstup" section (leading zero, p format, CI default, explain results, APA locale, re-run replaces). Move Profile last. *(S)*
- [ ] **P1 ST-1/F16** Start screen: Open file first, guided sample tasks (open sample + prefilled dialog through the coordinator `openDialog(specId, preset)` API). *(M)*
- [ ] **P1 ST-3** CSV/ODS import preview dialog (delimiter, decimal, header, preview, type and level guess). The parsing helpers stay in `lib/csv.ts` (coordinator review). *(M)*
- [ ] **P1 A-7** Toasts: pause on hover or focus, action toasts persist, F6 to reach them. *(S)*
- [ ] **P1 MOB-1/MOB-4** Mobile shell: hide the toolbar and formula bar ≤ 600 px, bottom nav, drawer with search and frequent items. *(M)*
- [ ] **P2 SH-6** Remove the star button (or pinned files). **SH-7** Remove the theme toggle from the app bar and add a run indicator. **SH-10/11** Load progress, queue actions while the engine loads. *(S each)*
- [ ] **P2 ST-2, ST-4, SET-3, SET-4, A-5 (h1), A-17 (profile focus)**. *(S each)*

### WP2: Data & variables

**Owns:** `src/features/data/**`, `src/features/variables/**`, `src/features/grid/**`, `src/features/shell/FormulaBar.tsx` (moved to WP2 by agreement; WP1 does not touch it), new `src/features/inspector/**`, `src/app/varIcons.ts`, `src/lib/variables.ts`, `src/lib/format.ts` (format-related additions only).

- [ ] **P0 DV-5** Prefill dialogs from header menus and grid selection (call the coordinator's `openDialog(specId, { variables })`). *(S)*
- [ ] **P1 DV-1** Value labels on by default (coordinator: settings key `showValueLabels`). *(S)*
- [ ] **P1 DV-3 / F3** Grid headers draw `variableIcon()` measurement glyphs, an optional label second line, and a rich tooltip. *(M)*
- [ ] **P1 DV-4** User-missing styled as muted italic with ∅, not the error colour. *(S)*
- [ ] **P1 DV-2 / F2 / A-18** Label combo editor for labelled cells (type-ahead over labels and codes, accessible name). *(M)*
- [ ] **P1 F1** **Variable inspector** (`features/inspector/`): header, measurement segmented control, label chips, missing chips, mini distribution, data check, quick actions; Ctrl+I; mobile bottom sheet. Mounts in WP1's `PanelSlot`. *(L)*
- [ ] **P1 F4 / DV-6** Data-quality flags: out-of-label, out-of-range (`validRange` property, coordinator adds it to the `Variable` type), whitespace or typo; cell corner marks; "Zvýraznit podezřelé hodnoty" toggle. *(M)*
- [ ] **P1 VV-1** Variable View default 6 columns + "Všechny sloupce" toggle; reorder so Measure is next to Name. *(S)*
- [ ] **P1 VV-2** Measurement icon left of the name, checked state in the menu, keyboard cycling, auto-suggested level on import or new variable with a review banner. *(M)*
- [ ] **P1 VV-3** Bulk edit: set level, copy properties, apply labels or missing to the selection (one undo step each). *(M)*
- [ ] **P1 VV-4** Value-label chips in the Variable View "Hodnoty" column (shared `LabelChips` component, also used by the inspector). *(S)*
- [ ] **P1 VV-5** Value labels dialog: "Doplnit z dat" with counts, unused-label warning, paste from Excel. *(M)*
- [ ] **P1 DV-10 / DV-11 / F15** Named undo steps (coordinator: `past` entries carry a `label`); toasts with Zpět after sort, delete and transform. *(M)*
- [ ] **P1 DV-12** Go to variable (Case | Variable). *(S)*
- [ ] **P1 DV-14** Localized sample datasets (`scripts/make-samples.mjs`, `src/samples/*`; Czech and English labels). *(S)*
- [ ] **P1 A-1 / A-12** Grid `aria-label`, Shift+F10 context menus, keyboard activation for Type/Values/Missing/Measure cells, measurement level in accessible text. *(M)*
- [ ] **P1 MOB-1 (data part)** Tap-cell bottom sheet editor with label picker. *(M)*
- [ ] **P2 DV-7, DV-8, DV-9, DV-13, VV-6, VV-7, VV-8**. *(S–M each)*

### WP3: Analysis & output

**Owns:** `src/features/dialogs/**` (renderer and all specs), `src/features/output/**`, `src/features/syntax/**`, new `src/features/assistant/**`, `src/styles/output.css`, `src/charts/**` (actions and export only).

- [ ] **P0 DLG-7** Compute: fix the caret race (use a single-line CodeMirror or set the caret synchronously via `flushSync`). On engine error, auto-undo the dataset change so no phantom variable remains (needs the coordinator `runSyntax(..., { rollbackOnError: true })`). *(S–M)*
- [ ] **P0 DLG-1(a)** Pass `closeOnScrim={false}` to `Dialog` for analysis dialogs and their sub-dialogs. *(S)*
- [ ] **P0 DLG-1(b–d)** Save the draft on any close. Persist `lastValues` per dataset (coordinator: an autosave field `dialogState`). Recall last dialog (Ctrl+Shift+R, toolbar dropdown through WP1's slot). *(M)*
- [ ] **P0 OUT-3 / F11** Store `{specId, values}` on `OutputEntry` (coordinator: type change). Entry actions "Upravit…" (Ctrl+E) and "Spustit znovu" (Ctrl+R) with a "nahradit výsledek" (replace result) option. *(M)*
- [ ] **P0 DLG-2 / F19** Data-aware dialogs: `VarListField.prefer`, `DialogSpec.hints`, soft measurement warnings with fix actions, smart defaults (Frequencies stats by level, chart suggestion), t-test group pickers from value labels with the 2 most frequent values preselected. Extend `DialogContext` with labels and distinct counts. *(M)*
- [ ] **P1 DLG-5** Button verbs Spustit / Použít by `spec.kind`. *(S)*
- [ ] **P1 DLG-4 / A-2** Keyboard: Ctrl+Enter / Ctrl+Shift+Enter, target-list navigation, Ctrl+1/2/3 move-to-list, type-ahead, Ctrl+A. *(S–M)*
- [ ] **P1 DLG-6 / A-6** Field-level validation with `aria-invalid` and focus-first-invalid. *(S)*
- [ ] **P1 DLG-3** Sub-dialogs as in-dialog tabs or accordions with change summaries (no modal-on-modal). *(M)*
- [ ] **P1 OUT-1 / MOB-3 / A-8** Fluid paper width, visible horizontal scroll affordance, sticky row headers, actions in the title row (always visible on touch), full-screen table view. *(M)*
- [ ] **P1 OUT-2** Flatten the redundant outline level, dialog-based Czech entry titles, error status dots. *(S)*
- [ ] **P1 OUT-5 / F7** Copy ▾: table / APA / text / image; "Kopírovat výsledek větou". *(M)*
- [ ] **P1 OUT-7** Leading-zero and p-format post-processing driven by settings. *(S–M)*
- [ ] **P1 OUT-9 / F17** Effect sizes (Cohen's d with CI, η², Cramér's V) appended and marked as computed by PSPP Studio. *(M)*
- [ ] **P1 F6 / OUT-4** Interpretation cards for T-TEST, ONEWAY, CORRELATIONS, CROSSTABS, REGRESSION, FREQUENCIES (Czech and English templates, caveat line, copy sentence). *(L)*
- [ ] **P1 F5** **Analysis assistant** (`features/assistant/`): goal cards → slot pickers → recommendation with Run / Open dialog / Paste; `rules.ts` decision table; entry from the Analýza menu top item (coordinator adds the action), the toolbar (WP1 slot) and the empty Output. *(M–L)*
- [ ] **P1 OUT-6 / F8** Pin entries, "Připnuté" group, export pinned, outline grouping by day, outline search, multi-select delete. *(M)*
- [ ] **P1 OUT-8** Undo for output deletions (toast). *(S)*
- [ ] **P1 OUT-10** Chart actions: copy image, SVG/PNG download, light chart editor (titles and axes). *(S–M)*
- [ ] **P1 SY-2** Single Run split button + gutter ▶ per command (the toolbar part goes in WP1's slot). *(M)*
- [ ] **P1 SY-4** Output "řádek N" links to the syntax tab and line, or reopens the dialog. *(S)*
- [ ] **P1 SY-5 / F10** Journal UI (Deník tab or panel), copy or download, open as syntax. *(M)*
- [ ] **P1 SY-3** Subcommand and keyword completion, hover docs (Czech one-liners), snippets with tab stops, variable labels in completion. *(M)*
- [ ] **P1 SH-2 stages 2–3** Templates filled with real variables. Real dialogs for Chí-kvadrát, Mann-Whitney, Kruskal-Wallis, Wilcoxon, Reliability, Factor, Logistic, Histogram, Bar, Scatter, Define variable properties (each a spec plus a `specs.test.ts` case). *(M → L)*
- [ ] **P1 DLG-8** Recode rows with typed old-value kinds, prefill from labels and data, new-value labels column, live preview counts. *(L)*
- [ ] **P1 DLG-9** In-app Czech help popovers per dialog (`help.<specId>.*` keys; coordinator merges i18n). *(M)*
- [ ] **P1 MOB-2** Mobile slot-picker renderer for var-lists. *(M)*
- [ ] **P2 DLG-10, DLG-11, SY-6, SY-7, SY-8, OUT-11, A-3 (outline tree keyboard or downgrade), A-13**. *(S–M each)*

### Cross-cutting items for the coordinator (stores, i18n, actions, menus)

Do these first. They unblock the three packages.

1. **`ui.openModal({kind:'analysis', specId, preset?: Values})`** plus a helper `openDialog(specId, preset)` in `app/actions.ts`. WP2 uses it for prefill, WP1 for guided tasks, WP3 for assistant, recall and re-run.
2. **`OutputEntry`** gains `source?: {specId: string; values: Values}`, `pinned?: boolean`, `tabId?: string`, `status?: 'ok'|'error'` (`store/output.ts`), and an output **undo buffer** for deletions.
3. **`store/journal.ts`** (new): `{time, source, specId?, values?, syntax}[]`, persisted by `startAutosave`. `runSyntax` appends to it.
4. **`runSyntax` options:** `rollbackOnError`, `source`, `replaceEntryId`. Return the new entry id (`app/engine.ts`).
5. **Data history labels:** `past/future` hold `{ds, label}`; `apply(fn, label)`; `load(..., {keepHistory, label})` (`store/data.ts`).
6. **Settings keys** (`store/settings.ts`): `showValueLabels` (default true), `explainResults: 'always'|'onDemand'|'never'`, `leadingZero: 'always'|'apa'|'never'`, `pFormat`, `ciLevel`, `apaLocale: 'cs'|'en'`, `rerunReplaces`, `listShows: 'name'|'label'|'both'`, `showSyntaxPreview`, `variableViewAllColumns`, `inspectorOpen`, `splitView`.
7. **Variable type:** optional `validRange?: {min:number; max:number}` (in-app only; serialised into a DOCUMENT line on save) (`engine/types.ts`, coordinate with the engine owner).
8. **Action registry:** `scope?: View[]`; new actions `analysis.assistant` (Ctrl+Shift+A), `dialog.recall` (Ctrl+Shift+R), `output.edit` (Ctrl+E), `output.rerun` (Ctrl+R), `view.inspector` (Ctrl+I), `view.split` (Ctrl+\\), `edit.gotoVariable`, `output.pin`. A `spec.kind` field on `DialogSpec` (analysis/transform/data) for button verbs.
9. **Menus (`app/menus.ts`):** add "Průvodce výběrem analýzy…" as the first Analýza item; remove the `menu.legacyDialogs` header; add mnemonics to `TopMenu`; mark templates (`tpl:`) for rendering; move "Definovat vlastnosti proměnných" to a dialog once WP3 delivers it.
10. **i18n (`cs.json`, `en.json`):** apply the §3.10 copy changes; add `help.<specId>.{when,assumptions,output}`, `palette.synonyms`, `assistant.*`, `interpret.*`, `inspector.*`. Run `npm run i18n:check` after every merge. Agents add keys in a per-package JSON fragment that the coordinator merges, which avoids conflicts.
11. **Autosave payload:** add `dialogState` (per dataset `lastValues`), journal, pinned flags, and inspector open state.
12. **Test plan:** extend `specs.test.ts` for new specs. Add Playwright smoke tests for SH-1 (one download, no modal), DLG-1 (scrim does not discard), DV-5 (prefill) and OUT-3 (edit reopens with values). The walkthrough scripts used for this audit can serve as a base.

**Suggested order:** coordinator items 1–5 → WP1 P0 + WP2 DV-5 + WP3 P0 (parallel) → WP2 F1 + WP3 F5/F6 + WP1 palette/command bar → the rest.

---

## Appendix A: screenshot index (`docs/ux-audit/`)

| File | Shows |
|---|---|
| 01-start.png | Start screen (desktop) |
| 02-data-default.png | Data View default: codes, not labels; "prom" columns; red user-missing |
| 03-goto-dialog.png | Go to case dialog |
| 04-data-value-labels.png | Value labels on (English sample labels) |
| 05-cell-editor-labels-on.png | Editing a labelled cell shows a raw code |
| 06-header-menu.png | Column header context menu |
| 07-quick-freq-not-prefilled.png | "Četnosti…" from the header opens an empty dialog |
| 08-variable-view.png | 11-column Variable View |
| 09-value-labels-dialog.png | Value labels dialog |
| 10–13-menu-*.png | Transformace, Analýza, Grafy, Data menus |
| 14-menu-nonparametric.png | "Klasické dialogy" header over syntax templates |
| 15-template-mann-whitney.png | Template result with placeholder variables |
| 16-recode-different.png | Recode into different variables (grammar-based) |
| 17-compute.png | Compute dialog (duplicated token keyboard) |
| 18-compute-filled.png | Caret race: `sleep  6<` |
| 19-after-compute.png | Engine error output plus phantom variable (13 variables) |
| 20/21-descriptives-*.png | Descriptives dialog and Czech output |
| 22/23-ttest-*.png | Independent t-test dialog (codes 1/2 instead of labels) |
| 25-palette-empty.png | Palette on empty query = File menu in order |
| 26-palette-variable-query.png | Variable search returns nothing |
| 27-palette-goal-query.png | Goal search "porovnat skupiny" returns nothing |
| 28-syntax-autocomplete.png | Command-name completion only |
| 29-syntax-view.png | Ctrl+S opened "Uložit datovou sadu" (and downloaded .sps); duplicate Run buttons |
| 30-ttest-output.png, 31-ttest-table-hover.png | T-test output; wide table clipped; actions overlap |
| 33/34-correlations-*.png | Correlations dialog and verbose output |
| 35-frequencies-chart-output.png | Mean/SD/"Minimum = Science" for a nominal variable |
| 36-dialog-keyboard-focus.png | Keyboard focus in an analysis dialog |
| 37/38-*.png | F10 menu bar focus, keyboard-opened menu |
| 39-settings-default.png | Settings open on Profile |
| 40-width-720.png, 41-width-1024.png | Menu bar hidden at 720 px |
| 50–58-mobile-*.png | Mobile start, data, variables, drawer, t-test dialog, output, syntax |
