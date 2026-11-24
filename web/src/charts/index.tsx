/* PSPP Studio chart renderer.

   The WebAssembly engine has no Cairo, so charts arrive as JSON (see
   engine/bridge/chart-json.c) and are drawn here as pure SVG.

     <PsppChart chart={item.chart} t={(k, f) => i18n.t('charts.' + k, { defaultValue: f })} locale="cs" />
*/

import { useMemo } from 'react';
import './charts.css';
import { BarChart } from './bar';
import { BoxplotChart } from './boxplot';
import { HistogramChart } from './histogram';
import { PieChart } from './pie';
import { defaultT, tr, type ChartT } from './strings';
import type { ChartCommonProps } from './shell';
import { parseChart, type StyledSpec } from './types';
import { StyleCtx } from './styleLayer';
import { AreaChart } from './area';
import { DotChart } from './dot';
import { ParetoChart } from './pareto';
import { MatrixChart } from './matrix';
import { HeatmapChart } from './heatmap';
import { PyramidChart } from './pyramid';
import { NpChart, RocChart, ScatterChart, ScreeChart, SpreadLevelChart } from './xy';
import { SurvivalChart } from './survival';
import { DendrogramChart } from './dendrogram';
import { LineChart } from './line';
import { HighLowChart } from './highlow';
import { DualAxisChart } from './dualaxis';
import { ProbPlotChart } from './probplot';
import { ControlChart, SequenceChart } from './sequence';
import { DensityChart } from './density';
import { ViolinChart } from './violin';
import { PanelsChart } from './panels';
import { Scatter3dChart } from './scatter3d';
import { Bar3dChart } from './bar3d';
import { Surface3dChart } from './surface3d';
import type { View3d } from './studioTypes';

export interface PsppChartProps {
  /** The `chart` member of an output item (or the whole item). */
  chart: unknown;
  /** Fixed width in px. Default: fill the container (tracked with ResizeObserver). */
  width?: number;
  /** Fixed total height in px. Default: derived from the width. */
  height?: number;
  /** Translator for generic labels; receives a key and its English fallback. */
  t?: ChartT;
  /** BCP 47 locale for number formatting (e.g. "cs"). Default: the browser's. */
  locale?: string;
  /** Used by the panels chart for its cells: no title and no toolbar, legend and data table on request. */
  embedded?: { legend: boolean; table: boolean };
  /** 3D charts: called, debounced, with the view after the user rotated or zoomed it (so the studio can save it in chart.view3d). */
  onView3dChange?: (v: View3d) => void;
}

export function PsppChart({ chart, width, height, t = defaultT, locale, embedded, onView3dChange }: PsppChartProps) {
  const spec = useMemo<StyledSpec>(() => parseChart(chart), [chart]);
  return (
    <StyleCtx.Provider value={spec.style}>
      <ChartBody spec={spec} common={{ t, locale, width, height, embedded, onView3dChange }} />
    </StyleCtx.Provider>
  );
}

function ChartBody({ spec, common }: { spec: StyledSpec; common: ChartCommonProps }) {
  const t = common.t;
  const width = common.width;
  switch (spec.type) {
    case 'histogram':
      return <HistogramChart spec={spec} {...common} />;
    case 'bar':
      return <BarChart spec={spec} {...common} />;
    case 'pie':
      return <PieChart spec={spec} {...common} />;
    case 'boxplot':
      return <BoxplotChart spec={spec} {...common} />;
    case 'np':
      return <NpChart spec={spec} {...common} />;
    case 'roc':
      return <RocChart spec={spec} {...common} />;
    case 'scatter':
      return <ScatterChart spec={spec} {...common} />;
    case 'scree':
      return <ScreeChart spec={spec} {...common} />;
    case 'spreadlevel':
      return <SpreadLevelChart spec={spec} {...common} />;
    case 'survival':
      return <SurvivalChart spec={spec} {...common} />;
    case 'dendrogram':
      return <DendrogramChart spec={spec} {...common} />;
    case 'line':
      return <LineChart spec={spec} {...common} />;
    case 'area':
      return <AreaChart spec={spec} {...common} />;
    case 'dot':
      return <DotChart spec={spec} {...common} />;
    case 'pareto':
      return <ParetoChart spec={spec} {...common} />;
    case 'matrix':
      return <MatrixChart spec={spec} {...common} />;
    case 'heatmap':
      return <HeatmapChart spec={spec} {...common} />;
    case 'pyramid':
      return <PyramidChart spec={spec} {...common} />;
    case 'highlow':
      return <HighLowChart spec={spec} {...common} />;
    case 'dualaxis':
      return <DualAxisChart spec={spec} {...common} />;
    case 'probplot':
      return <ProbPlotChart spec={spec} {...common} />;
    case 'sequence':
      return <SequenceChart spec={spec} {...common} />;
    case 'control':
      return <ControlChart spec={spec} {...common} />;
    case 'density':
      return <DensityChart spec={spec} {...common} />;
    case 'violin':
      return <ViolinChart spec={spec} {...common} />;
    case 'panels':
      return <PanelsChart spec={spec} {...common} />;
    case 'scatter3d':
      return <Scatter3dChart spec={spec} {...common} />;
    case 'bar3d':
      return <Bar3dChart spec={spec} {...common} />;
    case 'surface3d':
      return <Surface3dChart spec={spec} {...common} />;
    default:
      return (
        <figure className="pspp-chart pspp-chart--fallback" style={width ? { width } : undefined} role="img" aria-label={spec.title || tr(t, 'untitled')}>
          <div className="pspp-chart__fallback-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 28 28">
              <rect x="3" y="15" width="5" height="9" rx="1.5" />
              <rect x="11.5" y="9" width="5" height="15" rx="1.5" />
              <rect x="20" y="4" width="5" height="20" rx="1.5" />
            </svg>
          </div>
          <div>
            <div className="pspp-chart__fallback-title">{spec.title || tr(t, 'untitled')}</div>
            <div className="pspp-chart__fallback-text">{tr(t, 'unsupported', { type: spec.rawType })}</div>
          </div>
        </figure>
      );
  }
}

export default PsppChart;

export { chartStrings, tr, type ChartT, type ChartStringKey } from './strings';
export { chartToSvgString, chartToPngBlob, downloadSvg, downloadPng } from './export';
export { parseChart, type ChartSpec, type StyledSpec } from './types';
export type { ChartStyle, GraphDef, GraphKind, RefLine, Annotation, View3d } from './studioTypes';
export { niceTicks, ticksWithin, linearScale, tickFormatter, formatValue } from './scale';
