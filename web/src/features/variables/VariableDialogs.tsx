/*
 * Variable property dialogs: type & format (with a conversion preview, VV-7), value labels
 * (fill from data with counts, unused-label warning, paste from a spreadsheet, VV-5) and
 * missing values (code chips with label hints, optional open range, VV-6).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useMemo, useState, type ClipboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import './variables.css';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { Button } from '../../components/Button';
import { Chip, ValueLabelChip } from '../../components/Chip';
import { NumberField, Select } from '../../components/Field';
import { Checkbox } from '../../components/Choice';
import type { Variable } from '../../engine/types';
import { useData } from '../../store/data';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { DATE_FORMATS, DATE_FORMAT_EXAMPLE, DATE_FORMAT_WIDTH, formatNumber, isDateFormat, labelValueText, parseDate, parseNumber, PSPP_EPOCH_MS, valueLabelFor } from '../../lib/format';
import { conversionPreview, parseLabelPaste } from './labelTools';

type Kind = 'numeric' | 'comma' | 'dot' | 'scientific' | 'date' | 'dollar' | 'custom' | 'string';
const KIND_ICON: Record<Kind, string> = { numeric: 'pin', comma: 'pin', dot: 'pin', scientific: 'functions', date: 'event', dollar: 'payments', custom: 'payments', string: 'text_fields' };

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
  const col = useData((s) => s.dataset?.columns[index]);
  const close = useUi((s) => s.closeModal);
  const [kind, setKind] = useState<Kind>(v ? kindOf(v) : 'numeric');
  const [w, setW] = useState(v ? (v.type === 'string' ? v.width : v.print.w) : 8);
  const [d, setD] = useState(v?.print.d ?? 2);
  const [dateFmt, setDateFmt] = useState(v && isDateFormat(v.print.type) ? v.print.type : 'DATE');
  const [cc, setCc] = useState(v && /^CC[A-E]$/.test(v.print.type) ? v.print.type : 'CCA');

  const target = useMemo(() => {
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
    return { type, fmt };
  }, [kind, w, d, dateFmt, cc]);

  const preview = useMemo(() => {
    if (!v || !col) return null;
    const changesStorage = v.type !== target.type || (target.type === 'string' && target.fmt.w < v.width);
    return changesStorage ? conversionPreview(v, col, target.type, target.fmt) : null;
  }, [v, col, target]);

  if (!v) return null;
  const kinds: Kind[] = ['numeric', 'comma', 'dot', 'scientific', 'date', 'dollar', 'custom', 'string'];
  const hasDecimals = kind !== 'string' && kind !== 'date';
  const ok = () => {
    useData.getState().setVariableType(index, target.type, target.fmt, t('undo.varType', { name: v.name }));
    close();
  };
  const example = kind === 'date' ? formatNumber(SAMPLE_DATE, { type: dateFmt, w: 20, d: 0 }) : kind === 'string' ? t('varDialogs.stringExample', { count: w }) : formatNumber(-1234567.891, target.fmt);
  return (
    <Dialog
      title={t('typeDialog.title', { name: v.name })}
      icon="data_object"
      onClose={close}
      size="wide"
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={ok}>{t('varDialogs.apply')}</Button>
        </>
      }
    >
      <div className="vd-type">
        <div className="vd-type-kinds" role="radiogroup" aria-label={t('typeDialog.type')}>
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className="vd-kind"
              onClick={() => {
                setKind(k);
                if (k === 'string' && v.type !== 'string') setW(Math.max(8, w));
              }}
            >
              <Icon name={KIND_ICON[k]} />
              {t(`varType.${k}`)}
            </button>
          ))}
        </div>
        <div className="vd-type-options">
          {kind === 'date' ? (
            <div>
              <p className="vd-section-title">{t('typeDialog.dateFormat')}</p>
              <div className="vd-date-list" role="radiogroup" aria-label={t('typeDialog.dateFormat')}>
                {DATE_FORMATS.map((f) => (
                  <button key={f} type="button" role="radio" aria-checked={dateFmt === f} className="vd-date" onClick={() => setDateFmt(f)}>
                    {formatNumber(SAMPLE_DATE, { type: f, w: 20, d: 0 })}
                    <span>
                      {f} · {DATE_FORMAT_EXAMPLE[f]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="vd-row">
              {kind === 'custom' && (
                <Select label={t('typeDialog.currency')} value={cc} onChange={(e) => setCc(e.target.value)} options={['CCA', 'CCB', 'CCC', 'CCD', 'CCE'].map((c) => ({ value: c, label: c }))} />
              )}
              <NumberField label={kind === 'string' ? t('typeDialog.characters') : t('typeDialog.width')} value={w} min={1} max={kind === 'string' ? 32767 : 40} steppers onValueChange={(n) => setW(Math.max(1, n ?? 1))} />
              {hasDecimals && <NumberField label={t('typeDialog.decimals')} value={d} min={0} max={16} steppers onValueChange={(n) => setD(Math.max(0, Math.min(16, n ?? 0)))} />}
            </div>
          )}
          <div className="vd-example">
            {t('typeDialog.example')}: <strong>{example}</strong>
          </div>
          {preview && (
            <p className={`vd-note ${preview.lost || preview.truncated ? 'warn' : ''}`} role="status">
              <Icon name={preview.lost || preview.truncated ? 'warning' : 'info'} />
              <span>
                {t('varDialogs.convert', { kept: preview.kept, lost: preview.lost })}
                {preview.example ? ` ${t('varDialogs.convertExample', { example: preview.example })}` : ''}
                {preview.truncated ? ` ${t('varDialogs.truncated', { count: preview.truncated })}` : ''}
              </span>
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

interface LabelRow {
  value: string;
  label: string;
  suggested?: boolean;
}

export function ValueLabelsDialog({ index }: { index: number }) {
  const { t } = useTranslation();
  const v = useData((s) => s.dataset?.variables[index]);
  const col = useData((s) => s.dataset?.columns[index]);
  const close = useUi((s) => s.closeModal);
  const dec = useSettings((s) => s.decimalSeparator);
  const toText = (x: number | string) => (v ? labelValueText(x, v, { decimalSeparator: dec }) : String(x));
  const [rows, setRows] = useState<LabelRow[]>(() => (v?.valueLabels.length ? v.valueLabels.map((l) => ({ value: toText(l.value), label: l.label })) : [{ value: '', label: '' }]));
  const [error, setError] = useState<string | null>(null);

  // observed values with counts (one pass over the column)
  const counts = useMemo(() => {
    const m = new Map<string, { value: number | string; count: number }>();
    if (!v || !col) return m;
    for (const c of col) {
      if (c === null || c === '') continue;
      const k = typeof c === 'string' ? c.trimEnd() : toText(c);
      const e = m.get(k);
      if (e) e.count++;
      else m.set(k, { value: typeof c === 'string' ? c.trimEnd() : c, count: 1 });
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, col, dec]);

  if (!v) return null;
  const isNum = v.type === 'numeric';
  const parseValue = (s: string): number | string | null => {
    if (!isNum) return s;
    if (s.trim() === '') return null;
    const n = isDateFormat(v.print.type) ? parseDate(s, v.print.type) ?? parseNumber(s, { decimalSeparator: dec }) : parseNumber(s, { decimalSeparator: dec });
    return n;
  };
  const countFor = (s: string) => {
    const pv = parseValue(s);
    if (pv === null) return undefined;
    return counts.get(typeof pv === 'number' ? toText(pv) : pv.trimEnd())?.count ?? 0;
  };
  const labelled = new Set(rows.map((r) => r.value.trim()).filter(Boolean).map((s) => {
    const pv = parseValue(s);
    return pv === null ? s : typeof pv === 'number' ? toText(pv) : pv.trimEnd();
  }));
  const unlabelled = [...counts.entries()].filter(([k]) => !labelled.has(k));
  const unused = rows.filter((r) => r.value.trim() !== '' && countFor(r.value) === 0).length;

  const fillFromData = () => {
    const add = unlabelled
      .sort((a, b) => (typeof a[1].value === 'number' && typeof b[1].value === 'number' ? a[1].value - b[1].value : String(a[0]).localeCompare(String(b[0]))))
      .slice(0, 200)
      .map(([k]) => ({ value: k, label: '', suggested: true }));
    setRows([...rows.filter((r) => r.value.trim() !== '' || r.label.trim() !== ''), ...add]);
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>, i: number) => {
    const parsed = parseLabelPaste(e.clipboardData.getData('text/plain'));
    if (!parsed) return;
    e.preventDefault();
    const before = rows.slice(0, i).filter((r) => r.value.trim() !== '' || r.label.trim() !== '');
    const after = rows.slice(i + 1).filter((r) => r.value.trim() !== '' || r.label.trim() !== '');
    setRows([...before, ...parsed, ...after]);
  };

  const ok = () => {
    const out: { value: number | string; label: string }[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.value.trim() === '' && r.label.trim() === '') continue;
      if (r.label.trim() === '' && r.suggested) continue;
      const value = parseValue(r.value);
      if (value === null || (isNum && !Number.isFinite(value as number))) return setError(t('valueLabels.invalidValue', { value: r.value }));
      const key = String(value);
      if (seen.has(key)) return setError(t('valueLabels.duplicate', { value: r.value }));
      seen.add(key);
      out.push({ value, label: r.label });
    }
    out.sort((a, b) => (typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : String(a.value).localeCompare(String(b.value))));
    useData.getState().updateVariable(index, { valueLabels: out }, t('undo.valueLabels', { name: v.name }));
    close();
  };

  const setRow = (i: number, patch: Partial<LabelRow>) => setRows(rows.map((x, k) => (k === i ? { ...x, ...patch, suggested: patch.label ? false : x.suggested } : x)));
  return (
    <Dialog
      title={t('valueLabels.title', { name: v.name })}
      description={v.label || undefined}
      icon="sell"
      onClose={close}
      size="normal"
      footer={
        <>
          <Button variant="ghost" onClick={() => setRows([{ value: '', label: '' }])}>{t('valueLabels.clearAll')}</Button>
          <span className="spacer" />
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={ok}>{t('varDialogs.apply')}</Button>
        </>
      }
    >
      <div className="vd-labels-tools">
        {unlabelled.length > 0 && (
          <Button size="sm" iconStart="playlist_add" onClick={fillFromData}>
            {t('varDialogs.fillFromData', { count: unlabelled.length })}
          </Button>
        )}
        <span className="vd-footer-note">{t('varDialogs.pasteHint')}</span>
      </div>
      <div className="vd-labels" role="table" aria-label={t('valueLabels.title', { name: v.name })}>
        <div className="vd-labels-head" role="row">
          <span role="columnheader">{t('valueLabels.value')}</span>
          <span role="columnheader">{t('valueLabels.label')}</span>
          <span role="columnheader" className="vd-count">{t('varDialogs.inData')}</span>
          <span />
        </div>
        <div className="vd-labels-body">
          {rows.map((r, i) => {
            const n = r.value.trim() ? countFor(r.value) : undefined;
            return (
              <div className={`vd-labels-row ${n === 0 ? 'unused' : ''} ${r.suggested ? 'suggested' : ''}`} role="row" key={i}>
                <input
                  className="input"
                  aria-label={`${t('valueLabels.value')} ${i + 1}`}
                  value={r.value}
                  inputMode={isNum && !isDateFormat(v.print.type) ? 'decimal' : 'text'}
                  onChange={(e) => setRow(i, { value: e.target.value })}
                  onPaste={(e) => onPaste(e, i)}
                />
                <input
                  className="input"
                  aria-label={`${t('valueLabels.label')} ${i + 1}`}
                  value={r.label}
                  placeholder={r.suggested ? t('varDialogs.labelPlaceholder') : undefined}
                  onChange={(e) => setRow(i, { label: e.target.value })}
                  onPaste={(e) => onPaste(e, i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && i === rows.length - 1) {
                      e.preventDefault();
                      setRows([...rows, { value: '', label: '' }]);
                      setTimeout(() => document.querySelector<HTMLInputElement>('.vd-labels-row:last-child input')?.focus(), 0);
                    }
                  }}
                />
                <span className="vd-count" title={n === 0 ? t('varDialogs.unusedTip') : undefined}>
                  {n === undefined ? '' : n === 0 ? t('varDialogs.unused') : `${n}×`}
                </span>
                <IconButton icon="close" small label={t('dialogs.removeRow')} onClick={() => setRows(rows.length > 1 ? rows.filter((_, k) => k !== i) : [{ value: '', label: '' }])} />
              </div>
            );
          })}
        </div>
      </div>
      <Button size="sm" variant="ghost" iconStart="add" className="vd-add" onClick={() => setRows([...rows, { value: '', label: '' }])}>
        {t('valueLabels.add')}
      </Button>
      {unused > 0 && (
        <p className="vd-note warn">
          <Icon name="info" />
          {t('varDialogs.unusedNote', { count: unused })}
        </p>
      )}
      {error && (
        <p className="vd-note error" role="alert">
          <Icon name="error" />
          {error}
        </p>
      )}
    </Dialog>
  );
}

const MISSING_HINT = /no answer|don.?t know|refus|missing|(^|\s)n\/a($|\s)|not applicable|nev[ií]m|bez odpov|odm[ií]t|chyb[ěe]j|neuveden|nehod[ií]/i;

export function MissingDialog({ index }: { index: number }) {
  const { t } = useTranslation();
  const v = useData((s) => s.dataset?.variables[index]);
  const close = useUi((s) => s.closeModal);
  const dec = useSettings((s) => s.decimalSeparator);
  const [codes, setCodes] = useState<(number | string)[]>(() => [...(v?.missing.values ?? [])]);
  const [draft, setDraft] = useState('');
  const [useRange, setUseRange] = useState(!!v?.missing.range);
  const [low, setLow] = useState<number | null>(v?.missing.range && Number.isFinite(v.missing.range.low) ? v.missing.range.low : null);
  const [high, setHigh] = useState<number | null>(v?.missing.range && Number.isFinite(v.missing.range.high) ? v.missing.range.high : null);
  const [fromLowest, setFromLowest] = useState(v?.missing.range?.low === -Infinity);
  const [toHighest, setToHighest] = useState(v?.missing.range?.high === Infinity);
  const [error, setError] = useState<string | null>(null);
  if (!v) return null;
  const isStr = v.type === 'string';
  const maxCodes = useRange ? 1 : 3;
  const text = (x: number | string) => labelValueText(x, v, { decimalSeparator: dec });
  const suggestions = v.valueLabels.filter((l) => MISSING_HINT.test(l.label) && !codes.some((c) => String(c) === String(l.value)));

  const addCode = (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    let val: number | string = s;
    if (!isStr) {
      const n = parseNumber(s, { decimalSeparator: dec });
      if (n === null) return setError(t('missing.invalid'));
      val = n;
    } else val = s.slice(0, 8);
    if (codes.some((c) => String(c) === String(val))) return setDraft('');
    if (codes.length >= maxCodes) return setError(t('varDialogs.tooManyCodes', { count: maxCodes }));
    setError(null);
    setCodes([...codes, val]);
    setDraft('');
  };

  const ok = () => {
    let missing: Variable['missing'] = { values: codes };
    if (useRange && !isStr) {
      const lo = fromLowest ? -Infinity : low;
      const hi = toHighest ? Infinity : high;
      if (lo === null || hi === null || lo > hi) return setError(t('missing.invalidRange'));
      if (codes.length > 1) return setError(t('varDialogs.tooManyCodes', { count: 1 }));
      missing = { values: codes, range: { low: lo, high: hi } };
    }
    useData.getState().updateVariable(index, { missing }, t('undo.missing', { name: v.name }));
    close();
  };

  return (
    <Dialog
      title={t('missing.title', { name: v.name })}
      description={t('varDialogs.missingIntro')}
      icon="block"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={() => { setCodes([]); setUseRange(false); }}>{t('varDialogs.noMissing')}</Button>
          <span className="spacer" />
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={ok}>{t('varDialogs.apply')}</Button>
        </>
      }
    >
      <div className="vd-missing">
        <div>
          <p className="vd-section-title" id="vd-codes-label">{t('varDialogs.codes', { count: maxCodes })}</p>
          <div className="vd-codes" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
            {codes.map((c) => {
              const l = valueLabelFor(c, v);
              return (
                <Chip key={String(c)} onRemove={() => setCodes(codes.filter((x) => x !== c))} removeLabel={t('varDialogs.removeCode', { code: text(c) })}>
                  {l ? `${text(c)} · ${l}` : text(c)}
                </Chip>
              );
            })}
            {codes.length < maxCodes && (
              <input
                aria-labelledby="vd-codes-label"
                value={draft}
                placeholder={codes.length ? t('varDialogs.addCode') : t('varDialogs.codePlaceholder')}
                inputMode={isStr ? 'text' : 'decimal'}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => addCode(draft)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                    if (draft.trim()) {
                      e.preventDefault();
                      addCode(draft);
                    }
                  } else if (e.key === 'Backspace' && !draft && codes.length) setCodes(codes.slice(0, -1));
                }}
              />
            )}
          </div>
          {suggestions.length > 0 && codes.length < maxCodes && (
            <div className="vd-suggest">
              {t('varDialogs.suggested')}
              {suggestions.slice(0, 4).map((l) => (
                <button key={String(l.value)} type="button" className="chip chip-value" onClick={() => codes.length < maxCodes && setCodes([...codes, l.value])} title={t('varDialogs.useAsMissing')}>
                  <span className="chip-code">{text(l.value)}</span>
                  <span className="chip-text">{l.label}</span>
                </button>
              ))}
            </div>
          )}
          {draft.trim() && valueLabelFor(isStr ? draft.trim() : parseNumber(draft, { decimalSeparator: dec }), v) && (
            <p className="vd-footer-note">{t('varDialogs.codeHasLabel', { label: valueLabelFor(isStr ? draft.trim() : parseNumber(draft, { decimalSeparator: dec }), v) })}</p>
          )}
        </div>
        {!isStr && (
          <div>
            <Checkbox label={t('varDialogs.rangeToggle')} description={t('varDialogs.rangeHelp')} checked={useRange} onChange={(e) => setUseRange(e.target.checked)} />
            {useRange && (
              <div className="vd-range" style={{ marginTop: 12 }}>
                <div>
                  <NumberField label={t('missing.low')} value={fromLowest ? null : low} disabled={fromLowest} decimalSeparator={dec} onValueChange={setLow} />
                  <Checkbox label={t('varDialogs.fromLowest')} checked={fromLowest} onChange={(e) => setFromLowest(e.target.checked)} />
                </div>
                <span className="vd-range-dash" aria-hidden="true">–</span>
                <div>
                  <NumberField label={t('missing.high')} value={toHighest ? null : high} disabled={toHighest} decimalSeparator={dec} onValueChange={setHigh} />
                  <Checkbox label={t('varDialogs.toHighest')} checked={toHighest} onChange={(e) => setToHighest(e.target.checked)} />
                </div>
              </div>
            )}
          </div>
        )}
        {codes.length > 0 && (
          <div className="vd-suggest">
            {t('varDialogs.preview')}
            {codes.map((c) => (
              <ValueLabelChip key={String(c)} value={text(c)} label={valueLabelFor(c, v)} missing />
            ))}
          </div>
        )}
        {error && (
          <p className="vd-note error" role="alert">
            <Icon name="error" />
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
