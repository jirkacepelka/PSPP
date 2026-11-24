# Graph Studio: design

## Why
A teacher asked for two things the app lacks: a Chart Builder like SPSS (pick a chart from a gallery,
drop variables in, see the result live) and the ability to edit a chart afterwards. SPSS has far more
chart types than PSPP, so the gallery has to go beyond what the engine can draw.

## Goals
- One place (Graphs, Graph Studio) to build a chart: gallery, variable slots, options, live preview.
- Edit afterwards: double-click a chart in the output (or the Edit chart button) reopens the studio with
  the same definition. Appearance of engine charts (titles, axes, colours, reference lines) is editable too.
- More chart types than SPSS Chart Builder in the end, including 3D.
- Works offline, no engine round trip per change.

## Non-goals
- Changing the variables of an engine chart (EXAMINE, ROC, survival...). Those only get appearance edits.
- Exact SPSS Chart Editor parity (every property dialog).
- A new charting library. The SVG renderer in `src/charts/` stays the single renderer.

## Approach (decided with the user: option C, hybrid)
- A chart made in the studio is a definition (`GraphDef`) plus a resolved spec. The resolved spec is plain
  chart JSON that `PsppChart` already knows how to draw. Values (means, CIs, counts, bins) are computed in the
  browser from the dataset at build time and stored in the output item, so the output does not change when
  data changes later. The definition is stored next to it (`chart.studio`) so the chart can be reopened.
- Appearance lives in `chart.style` (`ChartStyle`) and applies to any chart, engine charts included.
- Rejected: only generating GRAPH syntax (slow live preview, PSPP cannot draw most SPSS charts, no 3D).

## Contract
`web/src/charts/studioTypes.ts` holds `GraphDef`, `ChartStyle` and the new spec interfaces. Renderers consume
specs, the studio produces them.

## Phases
1. Studio with gallery and live preview, appearance panel, edit via double-click. Types: bar (simple, clustered,
   stacked, 100% stacked, horizontal), line, area, pie, histogram (simple, stacked, polygon), population pyramid,
   boxplot, error bar, scatter (simple, grouped, fit lines), dot plot, Pareto, scatterplot matrix, binned scatter.
2. Elements and more types: reference lines, fit lines with CI, annotations, panels, high-low, dual axis,
   Q-Q, P-P, sequence, control charts, violin, density.
3. 3D: 3D scatter and 3D bars, rotated with the mouse; 3D surface.

## Left to the builder
Variable-slot UX, gallery icons, i18n wording, test fixtures.

## Phase 2 notes
- Every kind but the scatterplot matrix has an optional "panel by" slot (at most 12 levels). The studio builds a
  `PanelsSpec` with one chart per level; with "same axes" it writes common `xMin/xMax/yMin/yMax` into each panel's
  style, and merges the user's style (palette, grid, reference lines...) into every panel. Histogram bins and
  category sets come from all the data so the panels line up.
- Categories are never dropped. Any variable may be a category; above 50 categories a note says the chart may be
  crowded, above 500 a warning (also on the slot) suggests merging values into intervals (width or count, aligned to
  nice starts, summaries over all cases of the interval). A numeric category variable can be spaced proportionally
  ("numeric axis"): a line becomes a `SequenceSpec`, other category specs get an extra `xValues` array.
- Control chart formulas are documented next to `individualsParts` and `xbarParts` in `compute.ts` (d2, d3, c4).
- Q-Q and P-P use Blom positions; Q-Q draws the line through the quartiles. Violin and density use a Gaussian kernel with
  Silverman's bandwidth (violin: 64 points clipped to the data range). These kinds count every case once (weights are
  not used, and a note says so).
- Quick reference lines (mean, median, mean +- 1 or 2 SD) are computed from the data of the value axis and added as
  ordinary editable `RefLine`s.

## Phase 3 notes
- Gallery group "3D": scatter (x, y, z, optional group, optional least squares plane), bars (two categorical axes, the
  2D bar summaries without SD, weight/filter honoured, numeric category merging applies to both axes, no category
  dropped) and surface. All cases up to 20000 go to a 3D scatter; beyond that every n-th case is kept (deterministic) and
  a note says so.
- Surface: a regular grid of N x N cells (N 10..60, default 25) over the data range. With z the height is the weighted
  mean of z per cell and empty cells are filled by inverse distance weighting (1 / d squared) from cells with data within
  2 cells in each direction; cells with no such neighbour stay holes. Without z the height is the weighted case count
  per cell (empty cells are 0, not holes).
- The rotated view is stored as `chart.view3d` ({azimuth, elevation, perspective, zoom}) at Insert/Update, restored on
  edit, and read by the renderer in the output, so the saved view is what users see (and what the HTML/DOCX exports
  draw). The preview reports the view through `onView3dChange`.
- 3D charts have no reference lines, annotations, quick lines or panels (the Elements tab is hidden, a hint says so);
  the Appearance tab is the same. A short hint under the preview explains rotating and that 3D can hide data.
