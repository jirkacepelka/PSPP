/*
 * Properties panel: Options (kind specific, from model.ts), Appearance (ChartStyle) and Elements
 * (reference lines, annotations).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../components/IconButton';
import { Button } from '../components/Button';
import { NumberField, Select, TextField } from '../components/Field';
import { Switch } from '../components/Choice';
import { Segmented } from '../components/Segmented';
import type { Annotation, ChartStyle, GraphDef, RefLine } from '../charts/studioTypes';
import { optionsOf, type OptionDef } from './model';
import type { QuickStats } from './compute';

const PALETTE_ROWS = 12;

/** Default colour of series I as the chart draws it (a hex string, as <input type=color> needs). */
function defaultColor(i: number): string {
  try {
    const v = getComputedStyle(document.body).getPropertyValue(`--chart-series-${(i % 8) + 1}`).trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  } catch {
    /* no DOM */
  }
  return '#2f6a9a';
}

interface OptionsProps {
  def: GraphDef;
  onChange: (def: GraphDef) => void;
  decimal: '.' | ',';
}

export function OptionsTab({ def, onChange, decimal }: OptionsProps) {
  const { t } = useTranslation();
  const set = (id: string, value: unknown) => onChange({ ...def, options: { ...def.options, [id]: value } });
  const shown = optionsOf(def).filter((o) => !o.when || o.when(def));
  if (!shown.length) return <p className="gs-muted">{t('graphstudio.noOptions')}</p>;
  return (
    <div className="gs-form">
      {shown.map((o) => (
        <OptionField key={o.id} o={o} def={def} set={set} decimal={decimal} />
      ))}
    </div>
  );
}

function OptionField({ o, def, set, decimal }: { o: OptionDef; def: GraphDef; set: (id: string, v: unknown) => void; decimal: '.' | ',' }) {
  const { t } = useTranslation();
  const value = def.options[o.id];
  if (o.type === 'bool') return <Switch label={t(o.label)} checked={value === true} onChange={(e) => set(o.id, e.target.checked)} />;
  if (o.type === 'select') {
    const choices = typeof o.choices === 'function' ? o.choices(def) : (o.choices ?? []);
    return <Select label={t(o.label)} value={String(value ?? choices[0]?.value ?? '')} options={choices.map((c) => ({ value: c.value, label: t(c.label) }))} onChange={(e) => set(o.id, e.target.value)} />;
  }
  return (
    <NumberField
      label={t(o.label)}
      value={typeof value === 'number' ? value : null}
      min={o.min}
      max={o.max}
      step={o.step}
      decimalSeparator={decimal}
      placeholder={o.auto ? t('graphstudio.auto') : undefined}
      onValueChange={(n) => set(o.id, n)}
      steppers={false}
    />
  );
}

interface AppearanceProps {
  style: ChartStyle;
  onChange: (style: ChartStyle) => void;
  /** automatic texts shown as placeholders */
  auto: { title: string; xlabel: string; ylabel: string; zlabel?: string };
  /** 3D chart: x and y are the first and second data axis, z is the vertical one */
  three?: boolean;
  series: string[];
  decimal: '.' | ',';
}

export function AppearanceTab({ style, onChange, auto, series, decimal, three }: AppearanceProps) {
  const { t } = useTranslation();
  const set = (patch: Partial<ChartStyle>) => onChange({ ...style, ...patch });
  const rows = series.slice(0, PALETTE_ROWS);
  const setColor = (i: number, color: string | null) => {
    const palette = [...(style.palette ?? [])];
    while (palette.length < series.length) palette.push(null);
    palette[i] = color;
    set({ palette });
  };
  const axisName = (key: 'x' | 'y' | 'z') => (key === 'x' ? auto.xlabel : key === 'y' ? auto.ylabel : (auto.zlabel ?? '')) || t(`graphstudio.app.axis3d.${key}`);
  const range = (key: 'xMin' | 'xMax' | 'yMin' | 'yMax' | 'zMin' | 'zMax', label: string) => (
    <NumberField label={three ? t(key.endsWith('Min') ? 'graphstudio.app.axisMin' : 'graphstudio.app.axisMax', { name: axisName(key[0] as 'x' | 'y' | 'z') }) : t(label)} value={style[key] ?? null} decimalSeparator={decimal} steppers={false} step={1} size="sm" placeholder={t('graphstudio.auto')} onValueChange={(n) => set({ [key]: n } as Partial<ChartStyle>)} />
  );
  return (
    <div className="gs-form">
      <fieldset className="gs-fieldset">
        <legend>{t('graphstudio.app.texts')}</legend>
        <Switch label={t('graphstudio.app.showTitle')} checked={style.showTitle !== false} onChange={(e) => set({ showTitle: e.target.checked ? undefined : false })} />
        <TextField label={t('graphstudio.app.title')} value={style.title ?? ''} placeholder={auto.title} size="sm" onChange={(e) => set({ title: e.target.value })} />
        <TextField label={t('graphstudio.app.subtitle')} value={style.subtitle ?? ''} size="sm" onChange={(e) => set({ subtitle: e.target.value })} />
        <div className="gs-pair">
          <TextField label={t('graphstudio.app.xTitle')} value={style.xTitle ?? ''} placeholder={auto.xlabel} size="sm" onChange={(e) => set({ xTitle: e.target.value })} />
          <TextField label={t('graphstudio.app.yTitle')} value={style.yTitle ?? ''} placeholder={auto.ylabel} size="sm" onChange={(e) => set({ yTitle: e.target.value })} />
        </div>
        {three && <TextField label={t('graphstudio.app.zTitle')} value={style.zTitle ?? ''} placeholder={auto.zlabel} size="sm" onChange={(e) => set({ zTitle: e.target.value })} />}
      </fieldset>

      <fieldset className="gs-fieldset">
        <legend>{t('graphstudio.app.axes')}</legend>
        <div className="gs-pair">
          {range('xMin', 'graphstudio.app.xMin')}
          {range('xMax', 'graphstudio.app.xMax')}
          {range('yMin', 'graphstudio.app.yMin')}
          {range('yMax', 'graphstudio.app.yMax')}
          {three && range('zMin', 'graphstudio.app.zMin')}
          {three && range('zMax', 'graphstudio.app.zMax')}
        </div>
        <Switch label={t('graphstudio.app.grid')} checked={style.grid !== false} onChange={(e) => set({ grid: e.target.checked ? undefined : false })} />
      </fieldset>

      <fieldset className="gs-fieldset">
        <legend>{t('graphstudio.app.legend')}</legend>
        <Segmented
          aria-label={t('graphstudio.app.legend')}
          size="sm"
          options={[
            { value: 'auto', label: t('graphstudio.app.legendAuto') },
            { value: 'none', label: t('graphstudio.app.legendNone') },
          ]}
          value={style.legend ?? 'auto'}
          onChange={(v) => set({ legend: v === 'auto' ? undefined : v })}
        />
        {style.legend !== 'none' && <TextField label={t('graphstudio.app.legendTitle')} value={style.legendTitle ?? ''} size="sm" onChange={(e) => set({ legendTitle: e.target.value })} />}
      </fieldset>

      <fieldset className="gs-fieldset">
        <legend>{t('graphstudio.app.colors')}</legend>
        {rows.length === 0 && <p className="gs-muted">{t('graphstudio.app.noSeries')}</p>}
        <ul className="gs-palette">
          {rows.map((name, i) => {
            const custom = style.palette?.[i] ?? null;
            return (
              <li key={`${i}-${name}`}>
                <input type="color" className="gs-color" aria-label={t('graphstudio.app.colorOf', { name })} value={custom ?? defaultColor(i)} onChange={(e) => setColor(i, e.target.value)} />
                <span className="gs-palette-name" title={name}>
                  {name}
                </span>
                {custom && <IconButton icon="restart_alt" small label={t('graphstudio.app.resetColor')} onClick={() => setColor(i, null)} />}
              </li>
            );
          })}
        </ul>
        {series.length > PALETTE_ROWS && <p className="gs-muted">{t('graphstudio.app.moreSeries', { count: series.length - PALETTE_ROWS })}</p>}
      </fieldset>

      <fieldset className="gs-fieldset">
        <legend>{t('graphstudio.app.text')}</legend>
        <Switch label={t('graphstudio.app.valueLabels')} checked={style.valueLabels === true} onChange={(e) => set({ valueLabels: e.target.checked ? true : undefined })} />
        <Segmented
          aria-label={t('graphstudio.app.fontSize')}
          size="sm"
          options={[
            { value: '0.85', label: t('graphstudio.app.fontSmall') },
            { value: '1', label: t('graphstudio.app.fontNormal') },
            { value: '1.2', label: t('graphstudio.app.fontLarge') },
            { value: '1.4', label: t('graphstudio.app.fontLarger') },
          ]}
          value={String(style.fontScale ?? 1)}
          onChange={(v) => set({ fontScale: Number(v) === 1 ? undefined : Number(v) })}
        />
      </fieldset>
    </div>
  );
}

interface ElementsProps {
  style: ChartStyle;
  onChange: (style: ChartStyle) => void;
  decimal: '.' | ',';
  /** statistics of the value axis for the quick reference lines; null when the chart has none */
  quick: QuickStats | null;
}

/** A number for a line label: a few decimals, no grouping, the decimal separator of the settings. */
export function labelNumber(x: number, decimal: '.' | ','): string {
  const digits = Math.abs(x) >= 1000 ? 0 : Math.abs(x) >= 100 ? 1 : 2;
  return new Intl.NumberFormat(decimal === ',' ? 'cs-CZ' : 'en-US', { maximumFractionDigits: digits, useGrouping: false }).format(x);
}

type Quick = 'mean' | 'median' | 'sd1' | 'sd2';

/** The reference lines of a quick choice: plain RefLines, editable like any other. */
export function quickLines(q: QuickStats, which: Quick, label: (key: string, v: string) => string, decimal: '.' | ','): RefLine[] {
  const line = (key: string, value: number, dash: boolean): RefLine => ({ axis: q.axis, value, label: label(key, labelNumber(value, decimal)), dash });
  if (which === 'mean') return [line('mean', q.mean, false)];
  if (which === 'median') return [line('median', q.median, true)];
  if (q.sd === null) return [];
  const k = which === 'sd1' ? 1 : 2;
  return [line(`plus${k}`, q.mean + k * q.sd, true), line(`minus${k}`, q.mean - k * q.sd, true)];
}

export function ElementsTab({ style, onChange, decimal, quick }: ElementsProps) {
  const { t } = useTranslation();
  const id = useId();
  const refs = style.refLines ?? [];
  const notes = style.annotations ?? [];
  const setRefs = (refLines: RefLine[]) => onChange({ ...style, refLines });
  const setNotes = (annotations: Annotation[]) => onChange({ ...style, annotations });
  const patchRef = (i: number, p: Partial<RefLine>) => setRefs(refs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const patchNote = (i: number, p: Partial<Annotation>) => setNotes(notes.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <div className="gs-form">
      <fieldset className="gs-fieldset">
        <legend>{t('graphstudio.el.refLines')}</legend>
        <p className="gs-muted">{t('graphstudio.el.refHint')}</p>
        <div className="gs-quick" role="group" aria-label={t('graphstudio.el.quick')}>
          {(['mean', 'median', 'sd1', 'sd2'] as Quick[]).map((w) => (
            <Button
              key={w}
              size="sm"
              variant="secondary"
              disabled={!quick || (quick.sd === null && (w === 'sd1' || w === 'sd2'))}
              onClick={() => {
                if (!quick) return;
                const fresh = quickLines(quick, w, (k, v) => t(`graphstudio.el.q.${k}`, { v }), decimal).filter((l) => !refs.some((r) => r.axis === l.axis && Math.abs(r.value - l.value) < 1e-9));
                if (fresh.length) setRefs([...refs, ...fresh]);
              }}
            >
              {t(`graphstudio.el.quick_${w}`)}
            </Button>
          ))}
        </div>
        {!quick && <p className="gs-muted">{t('graphstudio.el.quickNone')}</p>}
        {refs.map((r, i) => (
          <div key={i} className="gs-row" role="group" aria-label={t('graphstudio.el.refLine', { n: i + 1 })}>
            <Select
              size="sm"
              aria-label={t('graphstudio.el.axis')}
              value={r.axis}
              options={[
                { value: 'y', label: t('graphstudio.el.axisY') },
                { value: 'x', label: t('graphstudio.el.axisX') },
              ]}
              onChange={(e) => patchRef(i, { axis: e.target.value as 'x' | 'y' })}
            />
            <NumberField size="sm" aria-label={t('graphstudio.el.value')} value={r.value} decimalSeparator={decimal} steppers={false} step={1} onValueChange={(n) => patchRef(i, { value: n ?? 0 })} />
            <TextField size="sm" aria-label={t('graphstudio.el.label')} placeholder={t('graphstudio.el.label')} value={r.label ?? ''} onChange={(e) => patchRef(i, { label: e.target.value })} />
            <input type="color" className="gs-color" aria-label={t('graphstudio.el.color')} value={r.color ?? defaultColor(1)} onChange={(e) => patchRef(i, { color: e.target.value })} />
            <Switch inline label={t('graphstudio.el.dashed')} checked={r.dash === true} onChange={(e) => patchRef(i, { dash: e.target.checked })} />
            <IconButton icon="delete" small label={t('graphstudio.el.remove')} onClick={() => setRefs(refs.filter((_, k) => k !== i))} />
          </div>
        ))}
        <Button size="sm" variant="secondary" iconStart="add" onClick={() => setRefs([...refs, { axis: 'y', value: 0, dash: true }])}>
          {t('graphstudio.el.addRef')}
        </Button>
      </fieldset>

      <fieldset className="gs-fieldset">
        <legend id={`${id}-notes`}>{t('graphstudio.el.annotations')}</legend>
        <p className="gs-muted">{t('graphstudio.el.noteHint')}</p>
        {notes.map((a, i) => (
          <div key={i} className="gs-row" role="group" aria-label={t('graphstudio.el.annotation', { n: i + 1 })}>
            <NumberField size="sm" aria-label="x" placeholder="x" value={a.x} decimalSeparator={decimal} steppers={false} step={1} onValueChange={(n) => patchNote(i, { x: n ?? 0 })} />
            <NumberField size="sm" aria-label="y" placeholder="y" value={a.y} decimalSeparator={decimal} steppers={false} step={1} onValueChange={(n) => patchNote(i, { y: n ?? 0 })} />
            <TextField size="sm" aria-label={t('graphstudio.el.text')} placeholder={t('graphstudio.el.text')} value={a.text} onChange={(e) => patchNote(i, { text: e.target.value })} />
            <IconButton icon="delete" small label={t('graphstudio.el.remove')} onClick={() => setNotes(notes.filter((_, k) => k !== i))} />
          </div>
        ))}
        <Button size="sm" variant="secondary" iconStart="add" onClick={() => setNotes([...notes, { x: 0, y: 0, text: '' }])}>
          {t('graphstudio.el.addNote')}
        </Button>
      </fieldset>
    </div>
  );
}

