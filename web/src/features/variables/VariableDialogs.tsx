/*
 * Variable property dialogs: type & format, value labels, missing values.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import type { Variable } from '../../engine/types';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { DATE_FORMATS, DATE_FORMAT_EXAMPLE, DATE_FORMAT_WIDTH, formatNumber, isDateFormat, parseDate, PSPP_EPOCH_MS } from '../../lib/format';
import { fmtVal } from './describe';

type Kind = 'numeric' | 'comma' | 'dot' | 'scientific' | 'date' | 'dollar' | 'custom' | 'string';

function kindOf(v: Variable): Kind {
  if (v.type === 'string') return 'string';
  const f = v.print.type.toUpperCase();
  if (isDateFormat(f)) return 'date';
  if (f === 'COMMA') return 'comma';
  if (f === 'DOT') return 'dot';
  if (f === 'E') return 'scientific';
  if (f === 'DOLLAR') return 'dollar';
  if (/^CC[A-E]$/.test(f)) return 'custom';
  return 'numeric';
}

const SAMPLE_DATE = (Date.UTC(2024, 6, 15, 15, 30, 15) - PSPP_EPOCH_MS) / 1000;

export function TypeDialog({ index }: { index: number }) {
  const { t } = useTranslation();
  const v = useData((s) => s.dataset?.variables[index]);
  const close = useUi((s) => s.closeModal);
  const [kind, setKind] = useState<Kind>(v ? kindOf(v) : 'numeric');
  const [w, setW] = useState(v ? (v.type === 'string' ? v.width : v.print.w) : 8);
  const [d, setD] = useState(v?.print.d ?? 2);
  const [dateFmt, setDateFmt] = useState(v && isDateFormat(v.print.type) ? v.print.type : 'DATE');
  const [cc, setCc] = useState(v && /^CC[A-E]$/.test(v.print.type) ? v.print.type : 'CCA');
  if (!v) return null;
  const kinds: Kind[] = ['numeric', 'comma', 'dot', 'scientific', 'date', 'dollar', 'custom', 'string'];
  const hasDecimals = kind !== 'string' && kind !== 'date';
  const ok = () => {
    let type: 'numeric' | 'string' = 'numeric';
    let fmt = { type: 'F', w, d };
    switch (kind) {
      case 'comma': fmt = { type: 'COMMA', w, d }; break;
      case 'dot': fmt = { type: 'DOT', w, d }; break;
      case 'scientific': fmt = { type: 'E', w: Math.max(w, 6 + d), d }; break;
      case 'dollar': fmt = { type: 'DOLLAR', w: Math.max(w, 2 + d), d }; break;
      case 'custom': fmt = { type: cc, w, d }; break;
      case 'date': fmt = { type: dateFmt, w: DATE_FORMAT_WIDTH[dateFmt] ?? 11, d: 0 }; break;
      case 'string': type = 'string'; fmt = { type: 'A', w: Math.max(1, w), d: 0 }; break;
    }
    if (fmt.type !== 'A') fmt.d = Math.min(fmt.d, Math.max(0, fmt.w - 1));
    useData.getState().setVariableType(index, type, fmt);
    close();
  };
  return (
    <Dialog
      title={t('typeDialog.title', { name: v.name })}
      icon="data_object"
      onClose={close}
      size="normal"
      footer={
        <>
          <button type="button" className="btn btn-text" onClick={close}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-filled" onClick={ok}>{t('common.ok')}</button>
        </>
      }
    >
      <div className="type-dialog">
        <fieldset className="dlg-fieldset">
          <legend className="field-label">{t('typeDialog.type')}</legend>
          <div className="dlg-radios">
            {kinds.map((k) => (
              <label key={k} className="radio">
                <input
                  type="radio"
                  name="vartype"
                  checked={kind === k}
                  onChange={() => {
                    setKind(k);
                    if (k === 'string' && v.type !== 'string') setW(Math.max(8, w));
                  }}
                />
                {t(`varType.${k}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="type-options">
          {kind === 'date' ? (
            <div className="field">
              <label htmlFor="datefmt">{t('typeDialog.dateFormat')}</label>
              <select id="datefmt" className="select date-list" size={8} value={dateFmt} onChange={(e) => setDateFmt(e.target.value)}>
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {DATE_FORMAT_EXAMPLE[f]} ({f})
                  </option>
                ))}
              </select>
              <span className="field-hint">
                {t('typeDialog.example')}: {formatNumber(SAMPLE_DATE, { type: dateFmt, w: 20, d: 0 })}
              </span>
            </div>
          ) : (
            <>
              {kind === 'custom' && (
                <div className="field">
                  <label htmlFor="ccsel">{t('typeDialog.currency')}</label>
                  <select id="ccsel" className="select" value={cc} onChange={(e) => setCc(e.target.value)}>
                    {['CCA', 'CCB', 'CCC', 'CCD', 'CCE'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label htmlFor="fw">{kind === 'string' ? t('typeDialog.characters') : t('typeDialog.width')}</label>
                <input id="fw" className="input" type="number" min={1} max={kind === 'string' ? 32767 : 40} value={w} onChange={(e) => setW(Math.max(1, Number(e.target.value) || 1))} />
              </div>
              {hasDecimals && (
                <div className="field">
                  <label htmlFor="fd">{t('typeDialog.decimals')}</label>
                  <input id="fd" className="input" type="number" min={0} max={16} value={d} onChange={(e) => setD(Math.max(0, Math.min(16, Number(e.target.value) || 0)))} />
                </div>
              )}
              {kind !== 'string' && (
                <span className="field-hint">
                  {t('typeDialog.example')}: {formatNumber(-1234567.891, { type: kind === 'comma' ? 'COMMA' : kind === 'dot' ? 'DOT' : kind === 'scientific' ? 'E' : kind === 'dollar' ? 'DOLLAR' : 'F', w, d })}
                </span>
              )}
            </>
          )}
          {v.type !== (kind === 'string' ? 'string' : 'numeric') && (
            <p className="dlg-info warn">
              <Icon name="warning" />
              {t('typeDialog.convertWarning')}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export function ValueLabelsDialog({ index }: { index: number }) {
  const { t } = useTranslation();
  const v = useData((s) => s.dataset?.variables[index]);
  const close = useUi((s) => s.closeModal);
  const [rows, setRows] = useState<{ value: string; label: string }[]>(() =>
    v?.valueLabels.length ? v.valueLabels.map((l) => ({ value: typeof l.value === 'number' && v && isDateFormat(v.print.type) ? formatNumber(l.value, v.print) : String(l.value), label: l.label })) : [{ value: '', label: '' }],
  );
  const [error, setError] = useState<string | null>(null);
  if (!v) return null;
  const ok = () => {
    const out: { value: number | string; label: string }[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.value.trim() === '' && r.label.trim() === '') continue;
      let value: number | string = r.value;
      if (v.type === 'numeric') {
        const n = isDateFormat(v.print.type) ? parseDate(r.value, v.print.type) ?? Number(r.value) : Number(r.value.replace(',', '.'));
        if (r.value.trim() === '' || !Number.isFinite(n)) {
          setError(t('valueLabels.invalidValue', { value: r.value }));
          return;
        }
        value = n;
      }
      const key = String(value);
      if (seen.has(key)) {
        setError(t('valueLabels.duplicate', { value: r.value }));
        return;
      }
      seen.add(key);
      out.push({ value, label: r.label });
    }
    out.sort((a, b) => (typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : String(a.value).localeCompare(String(b.value))));
    useData.getState().updateVariable(index, { valueLabels: out });
    close();
  };
  return (
    <Dialog
      title={t('valueLabels.title', { name: v.name })}
      icon="label"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn btn-text" onClick={() => setRows([{ value: '', label: '' }])}>{t('valueLabels.clearAll')}</button>
          <span className="spacer" />
          <button type="button" className="btn btn-text" onClick={close}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-filled" onClick={ok}>{t('common.ok')}</button>
        </>
      }
    >
      <div className="rows-table">
        <div className="rows-head" style={{ gridTemplateColumns: '120px minmax(0,1fr) 40px' }}>
          <span>{t('valueLabels.value')}</span>
          <span>{t('valueLabels.label')}</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div className="rows-row" key={i} style={{ gridTemplateColumns: '120px minmax(0,1fr) 40px' }}>
            <input
              className="input"
              aria-label={`${t('valueLabels.value')} ${i + 1}`}
              value={r.value}
              inputMode={v.type === 'numeric' ? 'decimal' : 'text'}
              onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))}
            />
            <input
              className="input"
              aria-label={`${t('valueLabels.label')} ${i + 1}`}
              value={r.label}
              onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && i === rows.length - 1) {
                  e.preventDefault();
                  setRows([...rows, { value: '', label: '' }]);
                  setTimeout(() => (document.querySelector<HTMLInputElement>('.rows-row:last-child input'))?.focus(), 0);
                }
              }}
            />
            <IconButton icon="delete" small label={t('dialogs.removeRow')} onClick={() => setRows(rows.length > 1 ? rows.filter((_, k) => k !== i) : [{ value: '', label: '' }])} />
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-text btn-sm" onClick={() => setRows([...rows, { value: '', label: '' }])}>
        <Icon name="add" />
        {t('valueLabels.add')}
      </button>
      {error && (
        <div className="dlg-error" role="alert">
          <Icon name="error" />
          {error}
        </div>
      )}
    </Dialog>
  );
}

export function MissingDialog({ index }: { index: number }) {
  const { t } = useTranslation();
  const v = useData((s) => s.dataset?.variables[index]);
  const close = useUi((s) => s.closeModal);
  const initMode = v?.missing.range ? 'range' : v?.missing.values.length ? 'discrete' : 'none';
  const [mode, setMode] = useState<'none' | 'discrete' | 'range'>(initMode);
  const [vals, setVals] = useState<string[]>(() => [0, 1, 2].map((i) => (v?.missing.values[i] !== undefined ? String(v.missing.values[i]) : '')));
  const [low, setLow] = useState(v?.missing.range ? String(v.missing.range.low) : '');
  const [high, setHigh] = useState(v?.missing.range ? String(v.missing.range.high) : '');
  const [extra, setExtra] = useState(v?.missing.range && v.missing.values[0] !== undefined ? String(v.missing.values[0]) : '');
  const [error, setError] = useState<string | null>(null);
  if (!v) return null;
  const isStr = v.type === 'string';
  const num = (s: string) => {
    const n = Number(s.trim().replace(',', '.'));
    return s.trim() !== '' && Number.isFinite(n) ? n : null;
  };
  const ok = () => {
    let missing: Variable['missing'] = { values: [] };
    if (mode === 'discrete') {
      const list = vals.filter((x) => x.trim() !== '');
      if (isStr) missing = { values: list.map((x) => x.slice(0, 8)) };
      else {
        const nums = list.map(num);
        if (nums.some((n) => n === null)) return setError(t('missing.invalid'));
        missing = { values: nums as number[] };
      }
    } else if (mode === 'range') {
      const lo = low.trim().toUpperCase().startsWith('LO') ? -Infinity : num(low);
      const hi = high.trim().toUpperCase().startsWith('HI') ? Infinity : num(high);
      if (lo === null || hi === null || lo > hi) return setError(t('missing.invalidRange'));
      const ex = extra.trim() ? num(extra) : undefined;
      if (ex === null) return setError(t('missing.invalid'));
      missing = { values: ex !== undefined ? [ex] : [], range: { low: lo, high: hi } };
    }
    useData.getState().updateVariable(index, { missing });
    close();
  };
  return (
    <Dialog
      title={t('missing.title', { name: v.name })}
      icon="block"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn btn-text" onClick={close}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-filled" onClick={ok}>{t('common.ok')}</button>
        </>
      }
    >
      <div className="dlg-fields">
        <label className="radio">
          <input type="radio" name="mm" checked={mode === 'none'} onChange={() => setMode('none')} />
          {t('missing.none')}
        </label>
        <label className="radio">
          <input type="radio" name="mm" checked={mode === 'discrete'} onChange={() => setMode('discrete')} />
          {t('missing.discrete')}
        </label>
        <div className="missing-row" aria-disabled={mode !== 'discrete'}>
          {vals.map((x, i) => (
            <input key={i} className="input" aria-label={`${t('missing.value')} ${i + 1}`} disabled={mode !== 'discrete'} value={x} onChange={(e) => setVals(vals.map((y, k) => (k === i ? e.target.value : y)))} />
          ))}
        </div>
        {!isStr && (
          <>
            <label className="radio">
              <input type="radio" name="mm" checked={mode === 'range'} onChange={() => setMode('range')} />
              {t('missing.range')}
            </label>
            <div className="missing-row">
              <input className="input" aria-label={t('missing.low')} placeholder={t('missing.low')} disabled={mode !== 'range'} value={low} onChange={(e) => setLow(e.target.value)} />
              <span aria-hidden="true">–</span>
              <input className="input" aria-label={t('missing.high')} placeholder={t('missing.high')} disabled={mode !== 'range'} value={high} onChange={(e) => setHigh(e.target.value)} />
              <input className="input" aria-label={t('missing.extra')} placeholder={t('missing.extra')} disabled={mode !== 'range'} value={extra} onChange={(e) => setExtra(e.target.value)} />
            </div>
            <span className="field-hint">{t('missing.hint')}</span>
          </>
        )}
      </div>
      {error && (
        <div className="dlg-error" role="alert">
          <Icon name="error" />
          {error}
        </div>
      )}
    </Dialog>
  );
}

void fmtVal;
