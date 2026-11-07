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
import { parseChart, type ChartSpec } from './types';
import { NpChart, RocChart, ScatterChart, ScreeChart, SpreadLevelChart } from './xy';
import { SurvivalChart } from './survival';
import { DendrogramChart } from './dendrogram';
import { LineChart } from './line';

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
}

export function PsppChart({ chart, width, height, t = defaultT, locale }: PsppChartProps) {
  const spec = useMemo<ChartSpec>(() => parseChart(chart), [chart]);
  const common = { t, locale, width, height };
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
export { parseChart, type ChartSpec } from './types';
export { niceTicks, ticksWithin, linearScale, tickFormatter, formatValue } from './scale';
