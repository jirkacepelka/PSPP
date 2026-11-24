/*
 * Graph Studio: build a chart from a gallery, variable slots and options with a live preview, and
 * edit it afterwards. Charts of the engine (no definition) only get the appearance editor.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Tabs, TabPanel } from '../components/Tabs';
import type { ChartStyle, GraphDef } from '../charts/studioTypes';
import { useData } from '../store/data';
import { useOutput } from '../store/output';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { ChartView } from '../features/output/ChartView';
import { computeChart, type ComputeResult } from './compute';
import { Gallery } from './Gallery';
import { AppearanceTab, ElementsTab, OptionsTab } from './Properties';
import type { Dataset } from '../engine/types';
import { SlotsPanel, VariableList, usePicking } from './Slots';
import { boundNames, defaultDef, KINDS, modelOf, normalizeOptions, rejection, slotsOf, withVariant } from './model';
import { findChartItem, insertStudioChart, restyleChart, studioChart, updateStudioChart } from './outputBridge';
import { innerChart, seriesNames } from './series';
import './graphstudio.css';

const NO_DATA: Dataset = { name: '', variables: [], columns: [] };

type PropTab = 'options' | 'appearance' | 'elements';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function asDef(x: unknown): GraphDef | null {
  if (!isObj(x) || typeof x.kind !== 'string' || !KINDS[x.kind as GraphDef['kind']] || !isObj(x.bind) || !isObj(x.options)) return null;
  return x as unknown as GraphDef;
}

export function GraphStudio({ edit }: { edit?: { entryId: string; itemId: string } }) {
  const { t } = useTranslation();
  const dataset = useData((s) => s.dataset);
  const closeModal = useUi((s) => s.closeModal);
  const toast = useUi((s) => s.toast);
  const setView = useUi((s) => s.setView);
  const decimal = useSettings((s) => s.decimalSeparator);

  // what is being edited (read once; the dialog is modal)
  const target = useMemo(() => (edit ? findChartItem(useOutput.getState().entries, edit.entryId, edit.itemId) : null), [edit]);
  const stored = target ? innerChart(target.item.chart) : null;
  const storedDef = asDef(stored?.studio);
  const storedStyle = (isObj(stored?.style) ? stored!.style : {}) as ChartStyle;
  const varsFound = !!storedDef && !!dataset && boundNames(storedDef).every((n) => dataset.variables.some((v) => v.name === n));
  const appearanceOnly = !!target && !(storedDef && varsFound);

  const [def, setDef] = useState<GraphDef>(() => storedDef ?? defaultDef('bar'));
  const picking = usePicking(dataset ?? NO_DATA, def, (d) => setDef(normalizeOptions(d)));
  const distinct = picking.distinct;
  const [style, setStyle] = useState<ChartStyle>(storedStyle);
  const [tab, setTab] = useState<PropTab>(appearanceOnly ? 'appearance' : 'options');
  const [live, setLive] = useState(def);
  useEffect(() => {
    const id = setTimeout(() => setLive(def), 160);
    return () => clearTimeout(id);
  }, [def]);

  const tf = useMemo(() => (key: string, args?: Record<string, unknown>) => t(key, args), [t]);
  const result: ComputeResult | null = useMemo(() => {
    if (appearanceOnly || !dataset) return null;
    try {
      return computeChart(live, dataset, tf);
    } catch (e) {
      console.error(e);
      return { ok: false, reason: 'nodata' };
    }
  }, [appearanceOnly, dataset, live, tf]);

  const spec = result?.ok ? result.chart : appearanceOnly && stored ? stored : null;
  const preview = useMemo(() => {
    if (appearanceOnly) return target ? restyleChart(target.item.chart, style) : null;
    return result?.ok ? studioChart(result.chart, live, style) : null;
  }, [appearanceOnly, target, result, live, style]);
  const series = useMemo(() => (spec ? seriesNames(spec) : []), [spec]);
  const model = modelOf(def.kind)!;

  const pick = (kind: string, variant: string) => {
    if (kind === def.kind) {
      setDef((d) => withVariant(d, variant));
      return;
    }
    // keep the variables the new chart can take
    const next = defaultDef(kind as GraphDef['kind'], variant);
    for (const s of slotsOf(next)) {
      const keep = (def.bind[s.id] ?? []).filter((n) => {
        const i = dataset?.variables.findIndex((v) => v.name === n) ?? -1;
        return i >= 0 && !rejection(s, dataset!.variables[i], distinct[i]);
      });
      if (keep.length) next.bind[s.id] = keep.slice(0, s.max);
    }
    setDef(normalizeOptions(next));
    setStyle((s) => ({ ...s, palette: undefined, xMin: undefined, xMax: undefined, yMin: undefined, yMax: undefined, xTitle: undefined, yTitle: undefined }));
  };

  const submit = () => {
    if (appearanceOnly) {
      if (!target || !preview) return;
      useOutput.getState().replaceItem(target.item.id, { ...target.item, chart: preview });
      closeModal();
      toast(t('graphstudio.updated'));
      return;
    }
    if (!dataset) return;
    const fresh = computeChart(def, dataset, tf);
    if (!fresh.ok) return;
    const chart = studioChart(fresh.chart, def, style);
    const title = t(model.label);
    const itemTitle = style.title || String(fresh.chart.title ?? title);
    if (target) {
      updateStudioChart(target.entry, target.item, chart, itemTitle);
      toast(t('graphstudio.updated'));
    } else {
      insertStudioChart(chart, title);
      setView('output');
      toast(t('graphstudio.inserted'));
    }
    closeModal();
  };

  const canSubmit = appearanceOnly ? !!preview : !!result?.ok;
  const noteLines: string[] = [];
  if (result?.ok) {
    const i = result.info;
    noteLines.push(t('graphstudio.info.cases', { used: i.used, total: i.total }));
    if (i.excluded) noteLines.push(t('graphstudio.info.excluded', { count: i.excluded }));
    if (i.filter) noteLines.push(t('graphstudio.info.filter', { name: i.filter }));
    if (i.weight) noteLines.push(t('graphstudio.info.weight', { name: i.weight }));
    noteLines.push(...result.notes);
  }

  const title = target ? (appearanceOnly ? t('graphstudio.editAppearance') : t('graphstudio.editTitle')) : t('graphstudio.title');
  const missingNames = result && !result.ok && result.reason === 'missing' ? result.slots.map((id) => slotsOf(def).find((s) => s.id === id)).filter(Boolean).map((s) => t(s!.label)) : [];

  return (
    <Dialog
      title={title}
      description={appearanceOnly ? (storedDef ? t('graphstudio.noVarsDesc') : t('graphstudio.engineDesc')) : t('graphstudio.desc')}
      icon="add_chart"
      size="xwide"
      className="gs-dialog"
      bodyClassName="gs-body"
      onClose={closeModal}
      closeOnScrim={false}
      footer={
        <>
          {!appearanceOnly && target && <span className="gs-footnote">{t('graphstudio.recomputeNote')}</span>}
          <span className="spacer" />
          <Button variant="secondary" onClick={closeModal}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {target ? t('graphstudio.update') : t('graphstudio.insert')}
          </Button>
        </>
      }
    >
      <div className={`gs-layout ${appearanceOnly ? 'appearance-only' : ''}`}>
        {!appearanceOnly && (
          <div className="gs-left">
            <Gallery kind={def.kind} variant={def.variant ?? 'simple'} onPick={pick} />
          </div>
        )}
        {!appearanceOnly && dataset && (
          <div className="gs-mid">
            <VariableList p={picking} />
          </div>
        )}
        <div className="gs-preview-col">
          {!appearanceOnly && dataset && <SlotsPanel p={picking} />}
          <section className="gs-preview" aria-label={t('graphstudio.preview')} aria-live="polite">
            {preview ? (
              <div className="gs-chart">
                <ChartView chart={preview} title={String((innerChart(preview)?.title as string) ?? '')} />
              </div>
            ) : !dataset ? (
              <EmptyState icon="dataset" title={t('graphstudio.noData')} description={t('graphstudio.noDataHint')} />
            ) : result && !result.ok && result.reason === 'novar' ? (
              <EmptyState icon="error" title={t('graphstudio.noVars', { names: result.names.join(', ') })} />
            ) : result && !result.ok && result.reason === 'nodata' ? (
              <EmptyState icon="filter_alt_off" title={t('graphstudio.noCases')} description={t('graphstudio.noCasesHint')} />
            ) : (
              <EmptyState icon={model.icon} title={t('graphstudio.missing', { slots: missingNames.join(', ') })} description={t('graphstudio.missingHint')} />
            )}
          </section>
          {noteLines.length > 0 && (
            <p className="gs-notes" role="status">
              {noteLines.join(' · ')}
            </p>
          )}
        </div>
        <div className="gs-props">
          <Tabs
            aria-label={t('graphstudio.properties')}
            size="sm"
            id="gs-props"
            value={tab}
            onChange={setTab}
            items={[
              ...(appearanceOnly ? [] : [{ id: 'options' as const, label: t('graphstudio.tab.options') }]),
              { id: 'appearance' as const, label: t('graphstudio.tab.appearance') },
              { id: 'elements' as const, label: t('graphstudio.tab.elements') },
            ]}
          />
          <div className="gs-props-body">
            {!appearanceOnly && (
              <TabPanel tabsId="gs-props" value="options" active={tab === 'options'}>
                <OptionsTab def={def} onChange={(d) => setDef(normalizeOptions(d))} decimal={decimal} />
              </TabPanel>
            )}
            <TabPanel tabsId="gs-props" value="appearance" active={tab === 'appearance'}>
              <AppearanceTab
                style={style}
                onChange={setStyle}
                series={series}
                decimal={decimal}
                auto={{ title: String(spec?.title ?? ''), xlabel: String(spec?.xlabel ?? ''), ylabel: String(spec?.ylabel ?? '') }}
              />
            </TabPanel>
            <TabPanel tabsId="gs-props" value="elements" active={tab === 'elements'}>
              <ElementsTab style={style} onChange={setStyle} decimal={decimal} />
            </TabPanel>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
