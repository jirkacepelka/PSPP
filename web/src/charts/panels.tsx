/* Panels (small multiples): the same chart once per level of a panel variable, laid out as a
   responsive grid.  Every cell is a PsppChart without its own title or toolbar; the grid has one toolbar,
   one data table switch and exports as a single SVG / PNG.  Shared axes are handled by the studio
   (it writes the common ranges into each panel's style).  Studio only (PanelsSpec in studioTypes.ts).
   SPDX-License-Identifier: GPL-3.0-or-later */

import { useLayoutEffect, useRef, useState } from 'react';
import { ChartToolbar, type ChartCommonProps } from './shell';
import { downloadPng, downloadSvg } from './export';
import { clamp } from './scale';
import { tr } from './strings';
import type { PanelsSpec } from './studioTypes';
import { useStyle } from './styleLayer';
import { PsppChart } from './index';

const GAP = 12;
const PAD = 12;
const MIN_CELL = 230;

export function PanelsChart({ spec, t, locale, width: fixedWidth, height }: { spec: PanelsSpec } & ChartCommonProps) {
  const style = useStyle();
  const root = useRef<HTMLElement | null>(null);
  const [measured, setMeasured] = useState(0);
  const [showTable, setShowTable] = useState(false);
  const title = style?.showTitle === false ? '' : style?.title || spec.title || tr(t, 'panelChart');
  const fileTitle = spec.title || tr(t, 'panelChart');

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || fixedWidth) return;
    setMeasured(Math.floor(el.clientWidth));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      setMeasured((old) => (Math.abs(old - w) >= 1 ? w : old));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixedWidth]);

  const width = fixedWidth ?? measured;
  const n = spec.panels.length;
  // as many columns as the spec asks for while every cell keeps a usable width
  const cols = clamp(Math.min(spec.columns, Math.floor((width - 2 * PAD + GAP) / (MIN_CELL + GAP))), 1, Math.max(1, n));
  const cellW = (width - 2 * PAD - GAP * (cols - 1)) / cols;
  const panelH = height ? Math.max(160, Math.round((height - 56) / Math.ceil(n / cols))) : clamp(Math.round(cellW * 0.74), 200, 340);
  const doSvg = () => root.current && downloadSvg(root.current, fileTitle);
  const doPng = () => {
    if (root.current) void downloadPng(root.current, fileTitle).catch(() => undefined);
  };

  return (
    <figure ref={root} className="pspp-chart pspp-chart--panels" data-pspp-panels="" style={fixedWidth ? { width: fixedWidth } : undefined} role="group" aria-label={`${title || fileTitle}. ${tr(t, 'ariaPanels', { count: n })}.`}>
      {title && (
        <div className="pspp-panels__title" data-panels-title="">
          {title}
        </div>
      )}
      {width > 0 && n > 0 && (
        <div className="pspp-panels__grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {spec.panels.map((p, i) => (
            <div key={i} className="pspp-panels__cell" data-panel="" role="group" aria-label={p.title || `${tr(t, 'panelChart')} ${i + 1}`}>
              {p.title && (
                <div className="pspp-panels__ptitle" data-panel-title="">
                  {p.title}
                </div>
              )}
              <PsppChart chart={p.chart} t={t} locale={locale} height={panelH} embedded={{ legend: true, table: showTable }} />
            </div>
          ))}
        </div>
      )}
      {width > 0 && !n && <p className="pspp-chart__empty-note">{tr(t, 'noData')}</p>}
      <ChartToolbar t={t} showTable={showTable} onTable={() => setShowTable((v) => !v)} onSvg={doSvg} onPng={doPng} />
    </figure>
  );
}
