# Calm Workspace design system

The PSPP Studio design system. It keeps the clarity of the old Sheets/Docs-like UI and drops the Google look: warm neutral surfaces, hairlines instead of elevation, sharp 4/6/8 px geometry, and one user-configurable accent that appears only where a decision happens.

- Tokens: `src/styles/tokens.css`
- Base layer (reset, type, focus, utilities): `src/styles/base.css`
- Components: `src/components/` (exported from `src/components/index.ts`, styles in `components.css`)
- Accent generation: `src/lib/color.ts`
- Living style guide: open the app with `?styleguide` (add `&theme=dark`, `&accent=teal`, `&density=compact`).

## 1. Principles

1. **Hairlines, not elevation.** Regions are separated by 1px warm lines (`--line`). Shadows belong only to floating layers: menus, popovers, dialogs, toasts and tooltips.
2. **The accent marks decisions.** Use it for the primary button, the focus ring, selection, the active tab indicator and links. Nothing else is accent-filled.
3. **Neutral states.** Hover is a soft neutral tint (`--surface-hover` / `--state-hover`). Selected is a faint wash plus a thin accent indicator (2px inset bar, underline or border). Never use a big tonal fill.
4. **Numbers line up.** Use `font-variant-numeric: tabular-nums` (`.t-num`, `.u-num`) wherever digits stack.
5. **Sentence case, no all-caps.** This applies to headers, menu group labels, buttons and tabs.

## 2. Tokens

Use only the semantic names below in new CSS. The Material-era names (`--on-surface`, `--surface-container-*`, `--primary-container`, `--r-xl`, `--elev-*` …) are **legacy aliases**. They keep `app.css` working and will be removed after migration.

### Color (paper / graphite)

| Token | Paper (light) | Graphite (dark) | Use |
|---|---|---|---|
| `--canvas` | `#f9f8f5` | `#191816` | app background behind panels |
| `--surface` | `#ffffff` | `#201f1c` | work surfaces: grid, editor, output paper, cards |
| `--surface-sunken` | `#f4f3ef` | `#1c1b19` | wells, table headers, dialog footer, inactive areas |
| `--surface-raised` | `#ffffff` | `#282724` | menus, popovers, dialogs |
| `--surface-hover` | `#f1f0ec` | `#2a2926` | neutral hover |
| `--surface-active` | `#e9e7e2` | `#33312d` | pressed |
| `--surface-selected` | `#edece7` | `#2e2c29` | neutral selected (pair with an accent indicator) |
| `--surface-inverse` / `--ink-inverse` | `#2a2825` / `#f3f1ec` | `#ece9e3` / `#1f1e1b` | tooltips, toasts |
| `--ink` | `#1f1e1b` (15.7:1) | `#eceae4` (13.7:1) | primary text |
| `--ink-2` | `#4a4843` (8.6:1) | `#c2beb5` (8.9:1) | secondary text, labels |
| `--ink-3` | `#6b6862` (5.2:1) | `#9c978e` (5.7:1) | muted text, placeholders, captions |
| `--ink-disabled` | `#a8a49b` | `#66625b` | disabled glyphs only (not for text you need to read) |
| `--line` | `#e7e5df` | `#302e2b` | hairlines, dividers, grid lines |
| `--line-strong` | `#d9d6ce` | `#3d3b37` | card edges on canvas, button borders, table rules |
| `--line-control` | `#8f8b83` (3.4:1) | `#7a766e` (3.5:1) | input, checkbox and radio borders (WCAG 1.4.11) |

**Accent** (runtime, from `lib/color.ts`; default emerald):

| Token | Paper | Graphite | Use |
|---|---|---|---|
| `--accent` (= `--primary`) | `#0f7b5f` (4.9:1 on canvas) | `#34c79a` (8.3:1) | primary button, focus, indicators |
| `--accent-ink` | `#ffffff` (5.2:1) | `#09241c` | text on `--accent` |
| `--accent-text` | `#0c604a` | `#a4e6d2` | accent-coloured text/icons (links, active tab icon) |
| `--accent-tint-strong` | `#e7f2ef` | `#23382f` | selected wash |
| `--accent-tint` | `#f2f8f6` | `#222e27` | faint wash: drop targets, current line |
| `--accent-hover`, `--accent-pressed` | derived with `color-mix` | | button states |
| `--focus-ring` | accent at 70% | | `:focus-visible` outline |
| `--accent-line` | = accent | | 2px indicator bars |

**Semantic** (muted and warm; `-tint` is the background, `-ink` the text on the tint):

| | Paper base / tint / ink | Graphite base / tint / ink |
|---|---|---|
| success | `#2f7a3f` / `#eaf4ec` / `#24603a` | `#8cc98a` / `#1f2a20` / `#a9dba6` |
| warning | `#8a5a00` / `#fbf3e2` / `#6e4700` | `#e0b25c` / `#2e2618` / `#edc983` |
| danger | `#b3412e` / `#fbeae6` / `#8f3222` | `#f0927f` / `#33211d` / `#f6b1a3` |
| info | `#3a6390` / `#e9eff6` / `#2c4e73` | `#93b4da` / `#1d2530` / `#b4cbe6` |

**Measurement levels** (small icons and chips only): nominal `#8a4f87` / `#d49acf` (plum), ordinal `#8c6510` / `#ddb656` (ochre), scale `#2f6a9a` / `#8db7e0` (steel blue), string `#6b6862` / `#a8a39a` (warm gray). Each has a `-tint`. Set `data-measure="nominal|ordinal|scale|string"` on any element to get `--m` and `--m-bg`.

**Charts:** `--chart-surface`, `--chart-ink`, `--chart-ink-2`, `--chart-muted`, `--chart-grid`, `--chart-axis`, `--chart-border`, `--chart-reference`, `--chart-other`, `--chart-tooltip-bg`, `--chart-font`, and `--chart-series-1…8`. Paper series: steel `#2f6a9a`, ochre `#c8702a`, emerald `#1f8a6a`, plum `#9c4f8a`, mustard `#b8941c`, indigo `#5b5fa8`, brick `#b3463a`, olive `#6e8b3d`. Graphite series: `#6fa3d6 #e5995a #3fbf95 #cf86bd #dcbc4c #9195dd #e57a68 #a2bd68`. `src/charts/charts.css` picks them up automatically.

### Type

Inter with `cv05` (a tailed `l`, so `l`, `I` and `1` stay distinct in variable names). Mono is Roboto Mono. Sizes scale with the user's font-size setting (`--fs-base`).

| Class | Size / weight | Use |
|---|---|---|
| `.t-display` | 28 / 600, −0.019em | start screen only |
| `.t-title` | 22 / 600 | page or view title |
| `.t-heading` | 18 / 600 | dialog title, output item title |
| `.t-subheading` | 16 / 600 | section titles |
| `.t-body` | 14 / 400, lh 1.5 | default |
| `.t-label` | 12 / 500, ink-2 | field labels, group labels |
| `.t-caption` | 11 / 400, ink-3 | metadata, status bar |
| `.t-mono` | 12 mono | syntax snippets, formats (`F8.2`) |

### Space, shape, elevation, motion

- Spacing uses a 4px rhythm: `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 24 · `--s-6` 32 · `--s-7` 40 · `--s-8` 48. Inside components use 4–12. Between groups use 16–24. Between page sections use 32–48.
- Radius: `--radius-chip` 4 (chips, badges, kbd, tooltips) · `--radius-control` 6 (buttons, inputs, menu items, avatars) · `--radius-panel` 8 (panels, cards, menus, dialogs) · `--radius-round` only for true circles (switch track, status dots).
- Elevation: none for anything in the layout. Use `--shadow-float` for menus, popovers and toasts, and `--shadow-dialog` for dialogs. Floating layers always also get a `--line-strong` hairline.
- Motion: `--dur-fast` 90ms, `--dur-short` 120, `--dur-medium` 180, `--dur-long` 260; `--ease-out` for entering, `--ease-standard` for state changes. Reduced motion is honoured globally.
- Density: `[data-density=compact]` changes `--control-h` (34→30), `--icon-btn`, `--menu-item-h`, `--grid-row-h`, `--panel-pad` and `--dialog-pad`. Size controls only with these tokens.

### Layout grid

- App shell: app bar (`--appbar-h`) → toolbar (`--toolbar-h`) → workspace → view tabs → status bar. Each band is separated by `--line`, with no gaps or floating pills. The workspace sits on `--canvas`; work surfaces are `--surface` with a hairline.
- Side panels (outline, settings nav) are 240–280px. Dialog bodies use a 2-column 1fr/1fr grid with a `--s-5` gap. Variable pickers use `1fr auto 1fr`.
- Breakpoints: ≤600px makes dialogs full-screen and stacks forms to one column; ≤860px collapses side navigation. Keep a 16px minimum side gutter.

## 3. Components

Import from `src/components` (for example `import { Button, Dialog, Chip } from '../../components'`).

| Component | API (main props) | Use when |
|---|---|---|
| `Button` | `variant: primary\|secondary\|ghost\|danger` (default secondary), `size: sm\|md\|lg`, `iconStart`, `iconEnd`, `loading`, `block` | Any text action. **One primary per view/dialog**, placed last on the right. Ghost goes in toolbars and on the footer's left side (Help, Reset). Danger is only for confirming destruction. |
| `IconButton` | `icon`, **`label` (required)**, `pressed`, `small`, `variant: ghost\|secondary\|primary`, `shortcut`, `tipPlacement`, `tip` | Icon-only actions. The label becomes `aria-label` and a CSS tooltip. Use `pressed` for toggles. |
| `Tooltip` | `content`, `shortcut`, `placement`, `delay`; wraps one child | Rich or longer hints, and hints with a `Kbd`. For icon buttons the built-in tip is enough. |
| `Kbd` | `keys: "Ctrl+K" \| string[]` | Shortcut hints in menus, tooltips, help. |
| `Chip` | `icon`, `onClick`, `onRemove` + `removeLabel` | Generic tag. Removable filter tokens. |
| `ValueLabelChip` | `value`, `label`, `missing` | Value labels (`1 │ Male`) in variable view, value-label dialog and output. |
| `StatusChip` | `tone: neutral\|success\|warning\|danger\|info\|accent`, `icon`, `dot` | Engine state, save state, error counts. |
| `FilterChip` | `selected`, `onToggle`, `onRemove`, `icon` | Toolbar toggles such as split, weight and filter (`aria-pressed`). |
| `MeasureChip` / `MeasureIcon` | `measure: nominal\|ordinal\|scale\|string`, `label`, `iconOnly` / `size` | Measurement level markers. `MEASURE_ICONS` matches `app/varIcons.ts`. |
| `Badge` / `Counter` | `tone`, `icon` / `count`, `max`, `tone: neutral\|accent\|danger`, `label` | Small labels and counts (tab badges, list counts). |
| `Segmented` | `options [{value,label,icon,iconOnly,disabled}]`, `value`, `onChange`, `aria-label`, `size`, `block` | 2–5 mutually exclusive short options (theme, alignment, chart type). Radiogroup with arrow keys. |
| `TextField` | `label`, `help`, `error`, `iconStart`, `suffix`, `size`, `mono` + input props | Text input. An error replaces the help text and sets `aria-invalid`. |
| `NumberField` | `value: number\|null`, `onValueChange`, `min`, `max`, `step`, `decimalSeparator`, `steppers` | Numeric input. Accepts `,` or `.`, ↑/↓ step, clamps on commit. |
| `Select` | `label`, `help`, `error`, `options` or children | Native select, for long option lists. |
| `TextArea` | `label`, `help`, `error`, `mono` | Notes, labels, multi-line values. |
| `Checkbox` | `label`, `description`, `indeterminate` | Independent options. |
| `Switch` | `label`, `description`, `inline` | Settings that apply immediately. |
| `RadioGroup` | `legend`, `options`, `value`, `onChange`, `orientation`, `hideLegend` | Exclusive options with longer labels or descriptions. |
| `Dialog` | `title`, `description`, `icon`, `onClose`, `footer`, `size: small\|normal\|wide\|xwide`, `initialFocus`, `closeOnScrim`, `hideClose`, `headerExtra`, `bodyClassName` | Modal tasks. Focus trap, Escape, focus restore, and full-screen on phones. Put `<span className="spacer" />` in the footer to split left/right groups. |
| `Menu` | `items: MenuEntry[]` (`item` with `shortcut`, `checked`, `danger`; `submenu`; `sep`; `header`), `anchor`, `onClose(reason)` | Command lists. Keys: ↑ ↓ Home End, type-ahead, → ← for submenus. |
| `MenuButton` | `items`, `label`, `icon`, `iconOnly`, `variant`, `size` | A button that opens a `Menu` and returns focus to itself. |
| `Popover` | `open`, `onClose`, `anchorRef`, `label`, `placement`, `autoFocus`, `flush` | Small non-modal panels (display options, pickers). |
| `Tabs` / `TabPanel` | `items [{id,label,icon,count,disabled}]`, `value`, `onChange`, `aria-label`, `id`, `size` / `tabsId`, `value`, `active` | Switching views inside a region. Underline indicator, arrow keys. |
| `Panel` | `title`, `subtitle`, `actions`, `collapsible`, `defaultOpen`/`open`/`onOpenChange`, `variant: default\|flush\|sunken`, `divided`, `headingLevel` | Titled regions, settings cards, dialog groups (`flush`), outlines (`sunken`). |
| `EmptyState` | `icon`, `title`, `description`, `actions`, `compact` | Empty views. Name what's missing and give one way forward. |
| `Divider` | `orientation`, `label` | Hairline separators. |
| `Toolbar` / `ToolbarGroup` / `ToolbarSeparator` / `ToolbarSpacer` | `aria-label`, `bordered` / `attached`, `label` | Action bars with one tab stop and arrow-key navigation. |
| `Toast` / `Toasts` | `kind: info\|success\|warning\|error`, `message`, `action`, `onClose`, `closeLabel` | Transient feedback. Trigger with `useUi().toast(...)`. |
| `Spinner` | `size`, `label` | Inline progress. Buttons use `loading`. |
| helpers | `getFocusable`, `trapTab`, `placeFloating` | Building custom overlays. |

The CSS classes are public too (for markup that cannot use React components yet): `.btn .btn-primary|secondary|ghost|danger .btn-sm|lg`, `.icon-btn`, `.field .field-label .field-hint .field-error`, `.input .select .textarea .input-wrap`, `.check .radio .switch`, `.segmented`, `.chip .chip-value .chip-status .tone-* .chip-measure[data-measure]`, `.badge .counter`, `.kbd`, `.menu .menu-item`, `.popover`, `.dialog`, `.toast`, `.tabs .tab`, `.panel`, `.empty-state`, `.divider`, `.ds-toolbar .toolbar-group .toolbar-sep`, `.avatar`. The legacy classes `.btn-filled`, `.btn-tonal`, `.btn-outlined`, `.btn-text`, `.chip.on` and `.empty-hint` are mapped onto the new styles.

## 4. Do / don't

| Do | Don't |
|---|---|
| One `primary` button per dialog, last in the footer | Two filled buttons side by side, or a filled button in a toolbar |
| Selected row: `--accent-tint-strong` + `box-shadow: inset 2px 0 0 var(--accent-line)` | `background: var(--primary-container)` blocks with accent text |
| Separate regions with `border: 1px solid var(--line)` | `box-shadow` on panels, cards, toolbars, the app bar |
| Radius 6 on controls, 8 on panels, 4 on chips | `border-radius: 999px` pills or 16–28px rounded cards |
| Sentence-case group labels (`Recent`) | `text-transform: uppercase` + letter-spacing |
| Muted text in `--ink-3` | Opacity on text, or `--ink-disabled` for readable text |
| `var(--danger)` with an icon and words for errors | Red alone as the only signal |
| Hex/rgba only inside `tokens.css` | Literal colours in feature CSS (`#1a73e8`, `#fff`) |
| Measure colours only on measure icons/chips | Measure colours as decoration elsewhere |

## 5. Iconography

- Material Symbols **Rounded**, rendered at weight 300 (`--icon-weight`) and optical size 20, so they read finer and calmer than the Google default. Use 20px in controls (`--icon-size`) and 18px in buttons, menus and dense lists (`--icon-size-sm`).
- Icons are ink-2 by default, ink-3 in menus, and accent only when the element is selected or active.
- The font is a subset. After using a new icon name in a quoted string anywhere under `src/`, run `npm run icons` (needs `pip install fonttools brotli`). The subset was regenerated with the new names: `balance`, `check_circle`, `filter_list`, `keyboard_arrow_up`, `keyboard_arrow_down`, `more_horiz`, `more_vert`, `open_in_new`, `science`, `sell`, `table_rows`, `view_column`.
- Prefer existing icons. Measure icons are `category` (nominal), `signal_cellular_alt` (ordinal), `straighten` (scale) and `text_fields` (string).

## 6. Feature CSS organisation

- Each area owns `src/features/<area>/<area>.css`, imported once from that area's main component (for example `import './data.css'` in `DataView.tsx`).
- Feature CSS **imports nothing** and **uses tokens only**: no hex, no rgba, no px font sizes (use `--fs-*`), no ad-hoc radii or shadows. Allowed literals: layout sizes (`240px` sidebars), `0`, `1px` hairlines through `--hairline`, and percentages.
- Prefix selectors with the area (`.data-…`, `.out-…`, `.syn-…`) so nothing collides. Don't restyle component classes from feature CSS. If a component lacks a variant, add it to `src/components/` (ask the design-system owner).
- Use components first. A feature stylesheet should mostly contain layout (grid/flex, gaps, sizes).

## 7. Migrating from `app.css`

`app.css` (2,267 lines) still holds every area's styles. While areas migrate, the legacy aliases in `tokens.css` keep it rendering in the new style. Move each block into `src/features/<area>/<area>.css`, switch it to semantic tokens, then delete it from `app.css`.

| Old token | New token |
|---|---|
| `--bg` | `--canvas` |
| `--on-surface` / `--on-surface-variant` / `--on-surface-muted` | `--ink` / `--ink-2` / `--ink-3` |
| `--outline` / `--outline-variant` / `--divider` | `--line-control` / `--line-strong` / `--line` |
| `--surface-container-low` | `--surface-sunken` |
| `--surface-container` | `--surface-hover` |
| `--surface-container-high` | `--surface-raised` (floating) or `--surface-sunken` (in-layout) |
| `--surface-container-highest` | `--surface-active` |
| `--primary` / `--on-primary` | `--accent` / `--accent-ink` |
| `--primary-container` + `--on-primary-container` | `--accent-tint-strong` + `--ink` and an accent indicator (`--accent-text` for icons only) |
| `--primary-soft` | `--accent-tint` |
| `--error*`, `--warning-container`, `--success-container`, `--info-container` | `--danger`, `--*-tint`, `--*-ink` |
| `--r-xs/sm/md/lg/xl/full` | `--radius-chip/control/panel/panel/panel/control` |
| `--elev-1/2/3` | none / `--shadow-float` / `--shadow-dialog` |
| `--chart-1…6` | `--chart-series-1…6` |

**Hard-coded values to remove from `app.css`:** `.star-btn` `#e3a008` (use `--warning`); `.profile-pop` light `#e9eef6`; `.tone-blue/green/purple` template colours (use `--measure-*` or `--chart-series-*`); `.swatch.custom` Google-colour conic gradient; `.tpl-badge` `#fff`; the `--syn-*` syntax palette (move to `tokens.css` as `--syn-*` tuned to the warm palette: keyword steel, string emerald, number ochre, comment `--ink-3`). Also remove the `.menu-header` uppercase (now overridden) and the pill shapes on `.search-pill`, `.toolbar`, `.drawer-item`, `.settings-nav-item`, `.outline-row` and `.item-actions` (already 6px through `--r-full`, but restyle them as flat bands or rows with an indicator).

**Outside my files (coordinator/feature owners):**
- `src/store/settings.ts`: replace `ACCENT_PRESETS` with `ACCENT_PRESETS` from `lib/color.ts` (objects with `id`, `name`, `light`, `dark`) and set the default to `DEFAULT_ACCENT`. Until then `normalizeAccent()` maps the old default `#1a73e8` to emerald. `AVATAR_COLORS` should move to the muted chart series.
- `src/app/theme.ts`: may switch to `applyAccent(s.accent, dark)`. Change the `meta[name=theme-color]` values to `#191816` / `#f9f8f5`.
- `SettingsDialog`: render accent swatches from the new presets (`name.cs`/`name.en`) and show `checkAccent()` for custom colours.
- App logo (`.app-logo`) and the default avatar still use Google blue from feature code.

### Which existing pieces migrate to which component

| Existing (file) | Migrate to |
|---|---|
| `components/Dialog`, `IconButton`, `Menu`, `Toasts` | Same files, now restyled and extended. The API is backward compatible (Dialog gained `description`, `closeOnScrim`, `hideClose`; Menu items gained `danger`; IconButton gained `variant`, `shortcut`, `tipPlacement`). |
| `.btn btn-filled/tonal/outlined/text` everywhere | `<Button variant="primary/secondary/secondary/ghost">` |
| `misc/SmallDialogs` confirm dialog | `Dialog size="small"` + `description` + `Button variant="danger"` |
| `shell/ViewTabs` (`.view-tab`, `.badge`) | Bottom tabs keep their own layout but use the `Tabs` indicator style and `Counter` |
| `shell/Toolbar` (`.toolbar`, `.tb-sep`, `.tb-chips .chip`) | `Toolbar` + `ToolbarGroup` + `ToolbarSeparator` + `FilterChip` (split/weight/filter) |
| `shell/MenuBar` + `MobileMenu` (`.drawer`) | `Menu`. The drawer keeps its layout with `.menu-item` rows. |
| `shell/ProfileMenu` (`.profile-pop`, `.segmented`) | `Popover` + `Segmented` + `Button` |
| `shell/AppBar` search pill + `.kbd` | `TextField iconStart="search"`-style trigger + `Kbd` |
| `shell/StatusBar` `.badge` | `StatusChip` (engine state) + `Badge` |
| `shell/FormulaBar` `.formula-label` | `ValueLabelChip` |
| `settings/SettingsDialog` (`.settings-card`, `.switch`, `.segmented`, nav) | `Panel`, `Switch`, `Segmented`, `Tabs` or a nav list with an indicator |
| `dialogs/DialogRenderer` (`.dlg-group`, `.var-list`, `.check`, `.radio`, `.chip`, sub-buttons) | `Panel variant="flush"`, `Checkbox`, `RadioGroup`, `NumberField`, `TextField`, `MeasureIcon` in variable lists, `Button size="sm"` for sub-dialogs |
| `variables/VariableDialogs` (value labels, missing, type) | `ValueLabelChip`, `RadioGroup`, `NumberField`, `Dialog` |
| `variables/VariableView`, `data/DataView` context menus, `.empty-hint` | `Menu`, `EmptyState` |
| `output/OutputView` (`.outline-row`, `.item-actions`, `.empty-hint`) | Outline rows with the selected-indicator pattern; item actions as `ToolbarGroup attached` of `IconButton`s; `EmptyState` |
| `palette/CommandPalette` (`.palette`, `.kbd`) | `Dialog`-like overlay using `--surface-raised`, `--shadow-dialog`, and `.menu-item` rows + `Kbd` |
| `start/StartScreen` (`.resume-card`, `.tpl-badge`, `.recent-item`) | `Panel`, `Button`, `Badge`, `EmptyState` |
| `misc/ShortcutsDialog` `.kbd` | `Kbd` |
| CSS `[data-tip]` attributes | Keep for icon buttons. Use `Tooltip` for anything with a shortcut or multiple lines. |
