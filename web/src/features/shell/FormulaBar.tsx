/*
 * Value bar (like a spreadsheet's fx bar): shows the active cell reference and its editable value.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { useData } from '../../store/data';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { editText, formatCell, parseCell } from '../../lib/format';
import { gridCommands } from '../../app/gridBus';

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
  const ref = sel ? `${sel.row + 1} : ${v?.name ?? t('formula.newVariable')}` : '';
  const label = v && cell !== null ? formatCell(cell, v, { valueLabels: true }) : '';
  const showLabel = v && label && label !== formatCell(cell, v);

  const commit = () => {
    if (!sel || draft === raw) return;
    if (!v) {
      setCells([{ row: sel.row, col: sel.col, value: draft.trim() === '' ? null : isNaN(Number(draft.replace(',', '.'))) ? draft : Number(draft.replace(',', '.')) }]);
      return;
    }
    const r = parseCell(draft, v, { decimalSeparator: dec });
    if (!r.ok) {
      toast(t('data.invalidValue', { value: draft, name: v.name }), { kind: 'error' });
      setDraft(raw);
      return;
    }
    setCells([{ row: sel.row, col: sel.col, value: r.value }]);
  };

  return (
    <div className="formula-bar">
      <button type="button" className="cell-ref" onClick={() => openModal({ kind: 'goto' })} aria-label={t('formula.goto')} data-tip={t('formula.goto')}>
        {ref || '–'}
      </button>
      <span className="fx" aria-hidden="true">
        <Icon name="function" />
      </span>
      <input
        className="formula-input"
        aria-label={t('formula.value')}
        value={draft}
        disabled={!sel || !ds}
        placeholder={sel ? '' : t('formula.selectCell')}
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
      {showLabel && (
        <span className="formula-label" title={t('formula.valueLabel')}>
          <Icon name="label" size={16} />
          {label}
        </span>
      )}
    </div>
  );
}
