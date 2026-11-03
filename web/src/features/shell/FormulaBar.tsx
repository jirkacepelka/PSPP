/*
 * Value bar: the active cell ("Případ 12 · gender" with the variable's measurement icon and label)
 * and its editable value; a labelled value shows as a value-label chip (DV-7, DV-1).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../data/data.css';
import { Icon } from '../../components/Icon';
import { MeasureIcon, ValueLabelChip } from '../../components/Chip';
import { useData } from '../../store/data';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { editText, isMissingValue, labelValueText, parseCell, valueLabelFor } from '../../lib/format';
import { measureKey } from '../../lib/variables';
import { gridCommands } from '../../app/gridBus';
import { cellChecker } from '../grid/quality';

export function FormulaBar() {
  const { t } = useTranslation();
  const sel = useUi((s) => s.selected);
  const view = useUi((s) => s.view);
  const ds = useData((s) => s.dataset);
  const setCells = useData((s) => s.setCells);
  const dec = useSettings((s) => s.decimalSeparator);
  const openModal = useUi((s) => s.openModal);
  const toast = useUi((s) => s.toast);
  const v = sel && ds ? ds.variables[sel.col] : undefined;
  const cell = sel && ds && v ? ds.columns[sel.col]?.[sel.row] ?? null : null;
  const raw = v ? editText(cell, v, { decimalSeparator: dec }) : '';
  const [draft, setDraft] = useState(raw);
  useEffect(() => setDraft(raw), [raw, sel?.row, sel?.col]);

  if (view !== 'data') return null;
  const label = v && cell !== null && cell !== '' ? valueLabelFor(cell, v) : undefined;
  const missing = !!v && cell !== null && cell !== '' && isMissingValue(cell, v);
  const flag = v && cell !== null ? cellChecker(v)(cell) : null;
  const cellLabel = sel ? `${t('dataView.caseN', { n: sel.row + 1 })} · ${v?.name ?? t('formula.newVariable')}` : t('formula.selectCell');

  const commit = () => {
    if (!sel || draft === raw) return;
    const name = `${v?.name ?? t('dataView.newVariable')}[${sel.row + 1}]`;
    const label = t('undo.editCell', { cell: name });
    if (!v) {
      setCells([{ row: sel.row, col: sel.col, value: draft.trim() === '' ? null : isNaN(Number(draft.replace(',', '.'))) ? draft : Number(draft.replace(',', '.')) }], label);
      return;
    }
    const r = parseCell(draft, v, { decimalSeparator: dec });
    if (!r.ok) {
      toast(t('data.invalidValue', { value: draft, name: v.name }), { kind: 'error' });
      setDraft(raw);
      return;
    }
    setCells([{ row: sel.row, col: sel.col, value: r.value }], label);
  };

  return (
    <div className="formula-bar" role="group" aria-label={t('dataView.valueBar')}>
      <button type="button" className="formula-ref" onClick={() => openModal({ kind: 'goto' })} title={t('formula.goto')}>
        {v ? <MeasureIcon measure={measureKey(v)} size={16} /> : sel ? <Icon name="add" size={16} /> : null}
        <span className="formula-case">{sel ? t('dataView.caseN', { n: sel.row + 1 }) : t('formula.selectCell')}</span>
        {sel && <span className="formula-var">· {v?.name ?? t('formula.newVariable')}</span>}
        <span className="sr-only">{cellLabel}</span>
      </button>
      {v?.label && <span className="formula-varlabel" title={v.label}>{v.label}</span>}
      <input
        className="formula-input"
        aria-label={t('formula.value')}
        value={draft}
        disabled={!sel || !ds}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            gridCommands.focus();
          } else if (e.key === 'Escape') {
            setDraft(raw);
            gridCommands.focus();
          }
        }}
      />
      <div className="formula-chips">
        {flag && (
          <span className="formula-flag">
            <Icon name="warning" size={14} />
            {t(`dataView.flagTitle.${flag}`)}
          </span>
        )}
        {v && cell !== null && cell !== '' && (label !== undefined || missing) && (
          <ValueLabelChip value={labelValueText(cell as number | string, v, { decimalSeparator: dec })} label={label ?? t('dataView.missingTag')} missing={missing} title={missing ? t('dataView.userMissingTip') : t('formula.valueLabel')} />
        )}
      </div>
    </div>
  );
}
