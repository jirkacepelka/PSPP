/*
 * Variable inspector (audit F1): the variable selected in the Data View (column) or the Variable
 * View (row) — name and label, measurement level, value labels as editable chips, missing
 * values, a quick distribution computed in the browser, data-quality flags, quick analyses and
 * the rarely needed format properties. Toggle with Ctrl+I (action view.inspector).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import './inspector.css';
import type { Measure, Role, Variable } from '../../engine/types';
import { useData } from '../../store/data';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { gridCommands, useActiveVariable } from '../../app/gridBus';
import { formatShortcut } from '../../app/actions';
import { formatSpec, formatStat, isMissingValue, labelValueText, parseDate, parseNumber, isDateFormat, valueLabelFor } from '../../lib/format';
import { isValidVarName, measureKey } from '../../lib/variables';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { Button } from '../../components/Button';
import { MeasureIcon, ValueLabelChip } from '../../components/Chip';
import { Segmented } from '../../components/Segmented';
import { Panel } from '../../components/Panel';
import { EmptyState } from '../../components/EmptyState';
import { NumberField, Select } from '../../components/Field';
import { typeLabel } from '../variables/describe';
import { parseLabelPaste } from '../variables/labelTools';
import { quickAnalysis, type QuickAnalysis } from '../data/quickActions';
import { columnQuality } from '../grid/quality';
import { computeStats, isCategorical, suggestMeasure, type VarStats } from './stats';

const ROLES: Role[] = ['input', 'target', 'both', 'none', 'partition', 'split'];

export function InspectorPanel() {
  const { t } = useTranslation();
  const ds = useData((s) => s.dataset);
  const active = useActiveVariable((s) => s.index);
  const selection = useActiveVariable((s) => s.selection);
  const close = () => useSettings.getState().set({ inspectorOpen: false });
  const index = active !== null && ds && active < ds.variables.length ? active : ds?.variables.length ? 0 : null;
  const v = index !== null ? ds?.variables[index] : undefined;

  return (
    <aside className="insp" aria-label={t('inspector.title')}>
      <div className="insp-top">
        <span className="insp-top-title">{t('inspector.title')}</span>
        <span className="insp-top-kbd">{formatShortcut('Mod+I')}</span>
        <IconButton icon="close" small label={t('inspector.close')} onClick={close} />
      </div>
      {!ds || !v || index === null ? (
        <div className="insp-empty">
          <EmptyState compact icon="right_panel_open" title={t('inspector.emptyTitle')} description={t('inspector.emptyText')} />
        </div>
      ) : (
        <div className="insp-scroll">
          {selection.length > 1 && <BulkSection indices={selection.filter((i) => i < ds.variables.length)} />}
          <VariableDetails key={`${index}`} index={index} v={v} others={selection.filter((i) => i !== index && i < ds.variables.length)} />
        </div>
      )}
    </aside>
  );
}

function BulkSection({ indices }: { indices: number[] }) {
  const { t } = useTranslation();
  const vars = useData((s) => s.dataset?.variables ?? []);
  const sel = indices.map((i) => vars[i]).filter(Boolean);
  const names = sel.map((v) => v.name);
  const common = sel.every((v) => v.measure === sel[0]?.measure) ? sel[0]?.measure : undefined;
  const allString = sel.every((v) => v.type === 'string');
  const setMeasure = (m: Measure) =>
    useData.getState().apply(
      (d) => ({ ...d, variables: d.variables.map((v, i) => (indices.includes(i) && !(m === 'scale' && v.type === 'string') ? { ...v, measure: m } : v)) }),
      t('undo.setMeasure', { names: names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', '), measure: t(`measure.${m}`) }),
    );
  return (
    <section className="insp-section insp-bulk" aria-label={t('inspector.bulk', { count: sel.length })}>
      <h3 className="insp-h">{t('inspector.bulk', { count: sel.length })}</h3>
      <p className="insp-names">{names.join(', ')}</p>
      <Segmented
        block
        size="sm"
        aria-label={t('dataView.measure')}
        value={(common ?? '') as Measure}
        onChange={setMeasure}
        options={[
          { value: 'nominal', label: t('measure.nominal'), icon: 'category' },
          { value: 'ordinal', label: t('measure.ordinal'), icon: 'signal_cellular_alt' },
          { value: 'scale', label: t('measure.scale'), icon: 'straighten', disabled: allString },
        ]}
      />
      <div className="insp-actions">
        <Button size="sm" iconStart="bar_chart" onClick={() => quickAnalysis('frequencies', names)}>
          {t('inspector.qa.frequencies')}
        </Button>
        <Button size="sm" iconStart="functions" disabled={allString} onClick={() => quickAnalysis('descriptives', sel.filter((v) => v.type !== 'string').map((v) => v.name))}>
          {t('inspector.qa.descriptives')}
        </Button>
      </div>
    </section>
  );
}

function VariableDetails({ index, v, others }: { index: number; v: Variable; others: number[] }) {
  const { t } = useTranslation();
  const col = useData((s) => s.dataset?.columns[index]);
  const vars = useData((s) => s.dataset?.variables ?? []);
  const openModal = useUi((s) => s.openModal);
  const dec = useSettings((s) => s.decimalSeparator);
  const update = (patch: Partial<Variable>, prop: string) => useData.getState().updateVariable(index, patch, t('undo.varProp', { name: v.name, prop }));
  const deferredCol = useDeferredValue(col);
  const stats = useMemo(() => (deferredCol ? computeStats(v, deferredCol) : null), [v, deferredCol]);
  const quality = useMemo(() => (deferredCol ? columnQuality(v, deferredCol) : null), [v, deferredCol]);
  const mk = measureKey(v);
  const text = (x: number | string) => labelValueText(x, v, { decimalSeparator: dec });
  const hint = stats ? suggestMeasure(v, stats) : null;
  const labelsLate = v.type === 'numeric' && v.measure === 'scale' && !v.valueLabels.length;
  const labelsSection = <ValueLabelsSection index={index} v={v} stats={stats} others={others} />;

  return (
    <>
      {/* 1. header: name, label, type */}
      <section className="insp-section insp-head" data-measure={mk}>
        <div className="insp-name-row">
          <MeasureIcon measure={mk} size={20} />
          <NameInput index={index} v={v} vars={vars} />
        </div>
        <LabelInput value={v.label} onCommit={(label) => label !== v.label && update({ label }, t('variables.col.label'))} />
        <button type="button" className="insp-type" onClick={() => openModal({ kind: 'varType', index })} title={t('variables.editType')}>
          {typeLabel(v, t)}
          <span className="insp-type-fmt">{formatSpec(v.print)}</span>
          <Icon name="edit" size={14} />
        </button>
      </section>

      {/* 2. measurement level */}
      <section className="insp-section">
        <h3 className="insp-h">{t('dataView.measure')}</h3>
        <Segmented
          block
          size="sm"
          aria-label={t('dataView.measure')}
          value={(v.type === 'string' && v.measure === 'scale' ? 'nominal' : v.measure) as Measure}
          onChange={(m) => update({ measure: m }, t('variables.col.measure'))}
          options={[
            { value: 'nominal', label: t('measure.nominal'), icon: 'category' },
            { value: 'ordinal', label: t('measure.ordinal'), icon: 'signal_cellular_alt' },
            { value: 'scale', label: t('measure.scale'), icon: 'straighten', disabled: v.type === 'string' },
          ]}
        />
        <p className="insp-help">{t(`inspector.measureHelp.${v.type === 'string' ? 'string' : v.measure === 'unknown' ? 'scale' : v.measure}`)}</p>
        {hint && (
          <div className="insp-hint" role="note">
            <Icon name="lightbulb" size={16} />
            <span>{t(`inspector.hint.${hint.reason}`, { measure: t(`measure.${hint.measure}`).toLocaleLowerCase(), count: stats?.distinct })}</span>
            <Button size="sm" variant="ghost" onClick={() => update({ measure: hint.measure }, t('variables.col.measure'))}>
              {t('inspector.applyHint', { measure: t(`measure.${hint.measure}`).toLocaleLowerCase() })}
            </Button>
          </div>
        )}
      </section>

      {/* 3. value labels (after the distribution for measured variables without labels) */}
      {!labelsLate && labelsSection}

      {/* 4. missing values */}
      <section className="insp-section">
        <div className="insp-h-row">
          <h3 className="insp-h">{t('inspector.missing')}</h3>
          <IconButton icon="edit" small label={t('variables.editMissing')} onClick={() => openModal({ kind: 'missing', index })} />
        </div>
        <div className="insp-chips">
          {!v.missing.values.length && !v.missing.range && <span className="insp-muted">{t('inspector.noMissing')}</span>}
          {v.missing.range && (
            <ValueLabelChip
              missing
              value={`${v.missing.range.low === -Infinity ? t('varView.lowest') : text(v.missing.range.low)}–${v.missing.range.high === Infinity ? t('varView.highest') : text(v.missing.range.high)}`}
            />
          )}
          {v.missing.values.map((x) => (
            <span key={String(x)} className="insp-chip-wrap">
              <ValueLabelChip missing value={text(x)} label={valueLabelFor(x, v)} />
              <button type="button" className="insp-chip-x" aria-label={t('varDialogs.removeCode', { code: text(x) })} onClick={() => update({ missing: { ...v.missing, values: v.missing.values.filter((y) => y !== x) } }, t('variables.col.missing'))}>
                <Icon name="close" size={14} />
              </button>
            </span>
          ))}
        </div>
        {stats && stats.sysmis + stats.userMissing > 0 && (
          <p className="insp-muted insp-small">
            {t('inspector.missingCounts', { sys: stats.sysmis, user: stats.userMissing })}
          </p>
        )}
      </section>

      {/* 5. distribution */}
      {stats && <DistributionSection v={v} stats={stats} />}
      {labelsLate && labelsSection}

      {/* 6. data check */}
      <section className="insp-section">
        <h3 className="insp-h">{t('inspector.check')}</h3>
        {quality && quality.total > 0 ? (
          <div className="insp-flag" role="status">
            <span className="insp-flag-mark" aria-hidden="true" />
            <div>
              <p className="insp-flag-text">
                {Object.entries(quality.byKind)
                  .map(([k, n]) => t(`inspector.flags.${k}`, { count: n }))
                  .join(' · ')}
              </p>
              <p className="insp-muted insp-small">
                {t('inspector.examples')}: {quality.examples.map((x) => (x === null ? '' : typeof x === 'number' ? text(x) : `„${x}“`)).join(', ')}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { useUi.getState().setView('data'); setTimeout(() => gridCommands.gotoCase(quality.rows[0], index), 0); }}>
              {t('inspector.show')}
            </Button>
          </div>
        ) : (
          <p className="insp-muted insp-ok">
            <Icon name="check_circle" size={16} />
            {t('inspector.noFlags')}
          </p>
        )}
        {v.type === 'numeric' && <ValidRange v={v} onChange={(validRange) => update({ validRange }, t('inspector.validRange'))} />}
      </section>

      {/* 7. quick actions */}
      <section className="insp-section">
        <h3 className="insp-h">{t('inspector.quick')}</h3>
        <div className="insp-actions">
          {(
            [
              ['frequencies', 'bar_chart', false],
              ['descriptives', 'functions', v.type === 'string'],
              ['explore', 'query_stats', v.type === 'string'],
              ['recode', 'swap_horiz', false],
              ['compute', 'calculate', v.type === 'string'],
            ] as [QuickAnalysis, string, boolean][]
          ).map(([k, icon, disabled]) => (
            <Button key={k} size="sm" iconStart={icon} disabled={disabled} onClick={() => quickAnalysis(k, [v.name])}>
              {t(`inspector.qa.${k}`)}
            </Button>
          ))}
          <Button size="sm" iconStart="sort" onClick={() => useData.getState().sortBy(index, 1, t('undo.sort', { name: v.name, dir: t('dataView.ascending') }))}>
            {t('inspector.qa.sort')}
          </Button>
        </div>
      </section>

      {/* 8. format & display */}
      <Panel variant="flush" collapsible defaultOpen={false} title={t('inspector.format')} className="insp-section insp-format">
        <div className="insp-grid">
          <NumberField size="sm" label={v.type === 'string' ? t('typeDialog.characters') : t('variables.col.width')} value={v.type === 'string' ? v.width : v.print.w} min={1} max={v.type === 'string' ? 32767 : 40} onValueChange={(n) => {
            if (!n) return;
            if (v.type === 'string') useData.getState().setVariableType(index, 'string', { type: 'A', w: n, d: 0 }, t('undo.varProp', { name: v.name, prop: t('variables.col.width') }));
            else update({ print: { ...v.print, w: n, d: Math.min(v.print.d, n - 1) }, write: { ...v.write, w: n, d: Math.min(v.write.d, n - 1) } }, t('variables.col.width'));
          }} />
          <NumberField size="sm" label={t('variables.col.decimals')} value={v.print.d} min={0} max={16} disabled={v.type === 'string' || isDateFormat(v.print.type)} onValueChange={(n) => n !== null && update({ print: { ...v.print, d: n, w: Math.max(v.print.w, n + 2) }, write: { ...v.write, d: n, w: Math.max(v.write.w, n + 2) } }, t('variables.col.decimals'))} />
          <NumberField size="sm" label={t('variables.col.columns')} value={v.columns} min={1} max={255} onValueChange={(n) => n && update({ columns: n }, t('variables.col.columns'))} />
          <Select size="sm" label={t('variables.col.role')} value={v.role} onChange={(e) => update({ role: e.target.value as Role }, t('variables.col.role'))} options={ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))} />
        </div>
        <Segmented
          size="sm"
          aria-label={t('variables.col.align')}
          value={v.align}
          onChange={(a) => update({ align: a }, t('variables.col.align'))}
          options={[
            { value: 'left', label: t('align.left'), icon: 'format_align_left', iconOnly: true },
            { value: 'center', label: t('align.center'), icon: 'format_align_center', iconOnly: true },
            { value: 'right', label: t('align.right'), icon: 'format_align_right', iconOnly: true },
          ]}
        />
      </Panel>
    </>
  );
}

function NameInput({ index, v, vars }: { index: number; v: Variable; vars: Variable[] }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(v.name);
  useEffect(() => setDraft(v.name), [v.name]);
  const error = draft === v.name ? null : !isValidVarName(draft) ? t('varView.nameRule') : vars.some((x, i) => i !== index && x.name.toUpperCase() === draft.toUpperCase()) ? t('varView.nameTaken', { name: draft }) : null;
  const commit = () => {
    if (draft === v.name) return;
    if (error) return;
    useData.getState().updateVariable(index, { name: draft }, t('undo.rename', { from: v.name, to: draft }));
  };
  return (
    <div className="insp-name-wrap">
      <input
        className={`insp-name ${error ? 'invalid' : ''}`}
        aria-label={t('variables.col.name')}
        aria-invalid={!!error}
        aria-describedby={error ? 'insp-name-err' : undefined}
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value.trim())}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(v.name);
        }}
      />
      {error && (
        <p id="insp-name-err" className="insp-error">
          {error}
        </p>
      )}
    </div>
  );
}

function LabelInput({ value, onCommit }: { value: string; onCommit: (s: string) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="insp-label"
      aria-label={t('variables.col.label')}
      placeholder={t('inspector.addLabel')}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(draft);
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

function ValueLabelsSection({ index, v, stats, others }: { index: number; v: Variable; stats: VarStats | null; others: number[] }) {
  const { t } = useTranslation();
  const dec = useSettings((s) => s.decimalSeparator);
  const toast = useUi((s) => s.toast);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const codeRef = useRef<HTMLInputElement>(null);
  const text = (x: number | string) => labelValueText(x, v, { decimalSeparator: dec });
  const parse = (s: string): number | string | null => {
    if (v.type === 'string') return s.trim() === '' ? null : s;
    const n = isDateFormat(v.print.type) ? parseDate(s, v.print.type) ?? parseNumber(s, { decimalSeparator: dec }) : parseNumber(s, { decimalSeparator: dec });
    return n;
  };
  const save = (labels: Variable['valueLabels']) => {
    const sorted = [...labels].sort((a, b) => (typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : String(a.value).localeCompare(String(b.value))));
    useData.getState().updateVariable(index, { valueLabels: sorted }, t('undo.valueLabels', { name: v.name }));
  };
  const start = (i: number | 'new') => {
    setEditing(i);
    if (i === 'new') {
      setCode('');
      setLabel('');
    } else {
      setCode(text(v.valueLabels[i].value));
      setLabel(v.valueLabels[i].label);
    }
    setTimeout(() => codeRef.current?.focus(), 0);
  };
  const commit = (again = false) => {
    const val = parse(code);
    if (val === null) {
      if (code.trim() === '' && label.trim() === '') setEditing(null);
      else toast(t('valueLabels.invalidValue', { value: code }), { kind: 'error' });
      return;
    }
    const rest = v.valueLabels.filter((l, i) => i !== editing && String(l.value) !== String(val));
    save(label.trim() ? [...rest, { value: val, label: label.trim() }] : rest);
    if (again) start('new');
    else setEditing(null);
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const parsed = parseLabelPaste(e.clipboardData.getData('text/plain'));
    if (!parsed) return;
    e.preventDefault();
    const map = new Map(v.valueLabels.map((l) => [String(l.value), l]));
    let bad = 0;
    for (const p of parsed) {
      const val = parse(p.value);
      if (val === null) bad++;
      else map.set(String(val), { value: val, label: p.label });
    }
    save([...map.values()]);
    setEditing(null);
    toast(t('inspector.pasted', { count: parsed.length - bad }));
  };
  const counts = useMemo(() => new Map((stats?.freqs ?? []).map((f) => [String(f.value), f.count])), [stats]);
  const unlabelled = stats && (v.valueLabels.length > 0 || stats.distinct <= 20) ? stats.freqs.filter((f) => f.label === undefined && !f.missing).length + stats.otherDistinct : 0;
  const applyToOthers = () => {
    const targets = others.filter((i) => useData.getState().dataset?.variables[i]?.type === v.type);
    if (!targets.length) return;
    useData.getState().apply((d) => ({ ...d, variables: d.variables.map((x, i) => (targets.includes(i) ? { ...x, valueLabels: v.valueLabels.map((l) => ({ ...l })) } : x)) }), t('undo.copyProps', { from: v.name, names: targets.map((i) => useData.getState().dataset?.variables[i]?.name).join(', ') }));
    toast(t('varView.copied', { from: v.name, count: targets.length }), { action: { label: t('actions.undo'), run: () => useData.getState().undo() } });
  };

  return (
    <section className="insp-section">
      <div className="insp-h-row">
        <h3 className="insp-h">{t('inspector.valueLabels')}</h3>
        <IconButton icon="table_edit" small label={t('inspector.editTable')} onClick={() => useUi.getState().openModal({ kind: 'valueLabels', index })} />
      </div>
      <div className="insp-chips">
        {v.valueLabels.map((l, i) =>
          editing === i ? null : (
            <span key={String(l.value)} className="insp-chip-wrap">
              <button type="button" className="insp-chip-btn" onClick={() => start(i)} title={t('inspector.editLabelTip', { count: counts.get(String(l.value)) ?? 0 })}>
                <ValueLabelChip value={text(l.value)} label={l.label} missing={isMissingValue(l.value, v)} />
              </button>
              <button type="button" className="insp-chip-x" aria-label={t('inspector.removeLabel', { label: l.label })} onClick={() => save(v.valueLabels.filter((_, k) => k !== i))}>
                <Icon name="close" size={14} />
              </button>
            </span>
          ),
        )}
        {editing === null && (
          <button type="button" className="insp-add" onClick={() => start('new')}>
            <Icon name="add" size={16} />
            {t('inspector.addValueLabel')}
          </button>
        )}
      </div>
      {editing !== null && (
        <div className="insp-label-edit" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEditing(null))}>
          <input ref={codeRef} className="input" aria-label={t('valueLabels.value')} placeholder={t('valueLabels.value')} value={code} onChange={(e) => setCode(e.target.value)} onPaste={onPaste} onKeyDown={(e) => e.key === 'Enter' && commit(editing === 'new')} />
          <input className="input" aria-label={t('valueLabels.label')} placeholder={t('valueLabels.label')} value={label} onChange={(e) => setLabel(e.target.value)} onPaste={onPaste} onKeyDown={(e) => e.key === 'Enter' && commit(editing === 'new')} />
          <IconButton icon="check" small variant="primary" label={t('varDialogs.apply')} onClick={() => commit(false)} />
        </div>
      )}
      {editing !== null && <p className="insp-muted insp-small">{t('inspector.labelEditHint')}</p>}
      <div className="insp-links">
        {unlabelled > 0 && (
          <button type="button" className="insp-link" onClick={() => useUi.getState().openModal({ kind: 'valueLabels', index })}>
            {t('inspector.unlabelled', { count: unlabelled })}
          </button>
        )}
        {others.length > 0 && v.valueLabels.length > 0 && (
          <button type="button" className="insp-link" onClick={applyToOthers}>
            {t('inspector.applyLabels', { count: others.length })}
          </button>
        )}
      </div>
    </section>
  );
}

function DistributionSection({ v, stats }: { v: Variable; stats: VarStats }) {
  const { t } = useTranslation();
  const dec = useSettings((s) => s.decimalSeparator);
  const f = (x: number | null, d = 2) => formatStat(x, d, { decimalSeparator: dec });
  const cat = isCategorical(v, stats);
  const text = (x: number | string) => labelValueText(x, v, { decimalSeparator: dec });
  const mk = measureKey(v);
  const pct = (n: number) => (stats.n ? `${formatStat((100 * n) / stats.n, 1, { decimalSeparator: dec })} %` : '');
  return (
    <section className="insp-section" data-measure={mk}>
      <h3 className="insp-h">{t('inspector.distribution')}</h3>
      <div className="insp-kpis">
        <div>
          <span className="insp-kpi">{stats.valid}</span>
          <span className="insp-kpi-label">{t('inspector.valid')}</span>
        </div>
        <div>
          <span className={`insp-kpi ${stats.sysmis + stats.userMissing ? 'warn' : ''}`}>{stats.sysmis + stats.userMissing}</span>
          <span className="insp-kpi-label">{t('inspector.missingN')}</span>
        </div>
        <div>
          <span className="insp-kpi">{stats.distinct}</span>
          <span className="insp-kpi-label">{t('inspector.distinct')}</span>
        </div>
      </div>
      {cat && stats.distinct > 20 && stats.distinct === stats.valid && !v.valueLabels.length ? (
        <p className="insp-muted">{t('inspector.allUnique', { count: stats.distinct })}</p>
      ) : cat ? (
        <ul className="insp-bars" aria-label={t('inspector.distribution')}>
          {stats.freqs.map((r) => {
            const max = stats.freqs[0]?.count || 1;
            return (
              <li key={String(r.value)} className={r.missing ? 'missing' : ''}>
                <span className="insp-bar-label" title={r.label ? `${text(r.value)} · ${r.label}` : text(r.value)}>
                  {r.label ?? text(r.value)}
                  {r.label && <span className="insp-bar-code">{text(r.value)}</span>}
                </span>
                <span className="insp-bar-track" aria-hidden="true">
                  <span className="insp-bar-fill" style={{ width: `${(100 * r.count) / max}%` }} />
                </span>
                <span className="insp-bar-n">{r.count}</span>
                <span className="insp-bar-pct">{pct(r.count)}</span>
              </li>
            );
          })}
          {stats.otherDistinct > 0 && (
            <li className="other">
              <span className="insp-bar-label">{t('inspector.otherValues', { count: stats.otherDistinct })}</span>
              <span className="insp-bar-track" />
              <span className="insp-bar-n">{stats.otherCount}</span>
              <span className="insp-bar-pct">{pct(stats.otherCount)}</span>
            </li>
          )}
        </ul>
      ) : (
        <>
          <Histogram stats={stats} label={t('inspector.histogram', { name: v.name })} fmt={(x) => f(x, Math.min(2, v.print.d))} />
          <dl className="insp-stats">
            <div><dt>{t('inspector.mean')}</dt><dd>{f(stats.mean)}</dd></div>
            <div><dt>{t('inspector.sd')}</dt><dd>{f(stats.sd)}</dd></div>
            <div><dt>{t('inspector.median')}</dt><dd>{f(stats.median)}</dd></div>
            <div><dt>{t('inspector.iqr')}</dt><dd>{f(stats.q1)} – {f(stats.q3)}</dd></div>
            <div><dt>{t('inspector.min')}</dt><dd>{f(stats.min, v.print.d)}</dd></div>
            <div><dt>{t('inspector.max')}</dt><dd>{f(stats.max, v.print.d)}</dd></div>
          </dl>
        </>
      )}
    </section>
  );
}

function Histogram({ stats, label, fmt }: { stats: VarStats; label: string; fmt: (x: number) => string }) {
  const bins = stats.hist;
  if (!bins.length) return null;
  const max = Math.max(...bins.map((b) => b.count)) || 1;
  const W = 280;
  const H = 72;
  const bw = W / bins.length;
  return (
    <figure className="insp-hist">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        {bins.map((b, i) => {
          const h = Math.max(b.count ? 2 : 0, (b.count / max) * (H - 4));
          return (
            <rect key={i} x={i * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} rx={1.5}>
              <title>{`${fmt(b.x0)} – ${fmt(b.x1)}: ${b.count}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption>
        <span>{fmt(bins[0].x0)}</span>
        <span>{fmt(bins[bins.length - 1].x1)}</span>
      </figcaption>
    </figure>
  );
}

function ValidRange({ v, onChange }: { v: Variable; onChange: (r: Variable['validRange']) => void }) {
  const { t } = useTranslation();
  const dec = useSettings((s) => s.decimalSeparator);
  const [open, setOpen] = useState(!!v.validRange);
  const [min, setMin] = useState<number | null>(v.validRange?.min ?? null);
  const [max, setMax] = useState<number | null>(v.validRange?.max ?? null);
  useEffect(() => {
    setMin(v.validRange?.min ?? null);
    setMax(v.validRange?.max ?? null);
  }, [v.validRange]);
  const commit = (a: number | null, b: number | null) => {
    if (a === null && b === null) return v.validRange && onChange(undefined);
    const r = { min: a ?? -Infinity, max: b ?? Infinity };
    if (r.min > r.max) return;
    if (v.validRange?.min !== r.min || v.validRange?.max !== r.max) onChange(r);
  };
  if (!open)
    return (
      <button type="button" className="insp-link" onClick={() => setOpen(true)}>
        {t('inspector.setRange')}
      </button>
    );
  return (
    <div className="insp-range">
      <NumberField size="sm" label={t('inspector.rangeMin')} value={min !== null && Number.isFinite(min) ? min : null} decimalSeparator={dec} onValueChange={(n) => { setMin(n); commit(n, max); }} />
      <NumberField size="sm" label={t('inspector.rangeMax')} value={max !== null && Number.isFinite(max) ? max : null} decimalSeparator={dec} onValueChange={(n) => { setMax(n); commit(min, n); }} />
    </div>
  );
}
