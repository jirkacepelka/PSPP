/*
 * Data View: spreadsheet-like grid of cases × variables.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CompactSelection,
  DataEditor,
  GridCellKind,
  GridColumnIcon,
  type DataEditorRef,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Rectangle,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import type { Cell } from '../../engine/types';
import { useData, type CellEdit } from '../../store/data';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { editText, formatCell, isDateFormat, isMissingValue, parseCell, parseNumber } from '../../lib/format';
import { caseCount } from '../../lib/variables';
import { registerGrid } from '../../app/gridBus';
import { useGridTheme } from '../grid/gridTheme';
import { Menu, type MenuEntry } from '../../components/Menu';
import { Icon } from '../../components/Icon';
import { formatShortcut } from '../../app/actions';
import { newDataset, openFileDialog, openSample } from '../../app/files';

const EMPTY_SEL: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty() };

export function DataView() {
  const { t } = useTranslation();
  const ds = useData((s) => s.dataset);
  const setCells = useData((s) => s.setCells);
  const valueLabels = useUi((s) => s.valueLabels);
  const select = useUi((s) => s.select);
  const toast = useUi((s) => s.toast);
  const setView = useUi((s) => s.setView);
  const openModal = useUi((s) => s.openModal);
  const dec = useSettings((s) => s.decimalSeparator);
  const m = useGridTheme();
  const ref = useRef<DataEditorRef>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<GridSelection>(EMPTY_SEL);
  const [menu, setMenu] = useState<{ items: MenuEntry[]; x: number; y: number } | null>(null);
  const [widths, setWidths] = useState<Record<number, number>>({});

  const nVars = ds?.variables.length ?? 0;
  const nCases = caseCount(ds);
  const extraCols = Math.max(4, 20 - nVars);
  const totalCols = nVars + extraCols;
  const totalRows = Math.max(nCases + 100, 200);

  const columns = useMemo<GridColumn[]>(() => {
    const cols: GridColumn[] = [];
    if (!ds) return cols;
    ds.variables.forEach((v, i) => {
      const w = widths[i] ?? Math.round(Math.min(360, Math.max(72, v.columns * m.charWidth + 34)));
      cols.push({
        id: `v${i}-${v.name}`,
        title: v.name,
        width: w,
        icon: v.type === 'string' ? GridColumnIcon.HeaderString : isDateFormat(v.print.type) ? GridColumnIcon.HeaderDate : GridColumnIcon.HeaderNumber,
        hasMenu: false,
      });
    });
    for (let i = 0; i < extraCols; i++) {
      cols.push({ id: `empty${i}`, title: t('data.newVarHeader'), width: Math.round(84 * m.zoom), themeOverride: { textHeader: m.muted } });
    }
    return cols;
  }, [ds, extraCols, widths, m, t]);

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const v = ds?.variables[col];
      if (!ds || !v || row >= nCases) {
        return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: true, readonly: false };
      }
      const c = ds.columns[col][row] ?? null;
      const display = formatCell(c, v, { valueLabels, decimalSeparator: dec });
      const raw = editText(c, v, { decimalSeparator: dec });
      const userMissing = c !== null && c !== '' && isMissingValue(c, v);
      return {
        kind: GridCellKind.Text,
        data: raw,
        displayData: display,
        allowOverlay: true,
        readonly: false,
        contentAlign: v.align,
        copyData: valueLabels ? display : raw,
        themeOverride: userMissing ? { textDark: m.error } : undefined,
      };
    },
    [ds, nCases, valueLabels, dec, m.error],
  );

  const toValue = useCallback(
    (col: number, text: string): { ok: boolean; value: Cell } => {
      const v = ds?.variables[col];
      if (!v) {
        if (text.trim() === '') return { ok: true, value: null };
        const n = parseNumber(text, { decimalSeparator: dec });
        return { ok: true, value: n ?? text };
      }
      const r = parseCell(text, v, { decimalSeparator: dec });
      return r.ok ? { ok: true, value: r.value } : { ok: false, value: null };
    },
    [ds, dec],
  );

  const applyEdits = useCallback(
    (raw: { col: number; row: number; text: string }[]) => {
      const edits: CellEdit[] = [];
      const bad: string[] = [];
      // guess type for new columns: numeric unless any value is non-numeric
      const newColString = new Map<number, boolean>();
      for (const e of raw) {
        if (ds && e.col >= ds.variables.length && e.text.trim() !== '') {
          const isNum = parseNumber(e.text, { decimalSeparator: dec }) !== null;
          newColString.set(e.col, (newColString.get(e.col) ?? false) || !isNum);
        }
      }
      for (const e of raw) {
        if (ds && e.col >= ds.variables.length) {
          if (newColString.get(e.col)) edits.push({ ...e, value: e.text });
          else edits.push({ ...e, value: e.text.trim() === '' ? null : parseNumber(e.text, { decimalSeparator: dec }) });
          continue;
        }
        const r = toValue(e.col, e.text);
        if (r.ok) edits.push({ row: e.row, col: e.col, value: r.value });
        else bad.push(e.text);
      }
      // ensure string values for new string columns
      for (const e of edits) if (ds && e.col >= ds.variables.length && newColString.get(e.col) && e.value === null) e.value = '';
      if (edits.length) setCells(edits);
      if (bad.length) toast(t('data.invalidValues', { count: bad.length, example: bad[0] }), { kind: 'error' });
    },
    [ds, dec, setCells, toast, t, toValue],
  );

  const onCellEdited = useCallback(
    ([col, row]: Item, val: EditableGridCell) => {
      if (val.kind !== GridCellKind.Text) return;
      applyEdits([{ col, row, text: val.data }]);
    },
    [applyEdits],
  );

  const onPaste = useCallback(
    ([col, row]: Item, values: readonly (readonly string[])[]) => {
      const raw: { col: number; row: number; text: string }[] = [];
      values.forEach((line, r) => line.forEach((text, c) => raw.push({ col: col + c, row: row + r, text })));
      applyEdits(raw);
      return false;
    },
    [applyEdits],
  );

  const selectedRects = (sel: GridSelection): Rectangle[] => {
    const out: Rectangle[] = [];
    if (sel.current) out.push(sel.current.range, ...sel.current.rangeStack);
    for (const c of sel.columns) out.push({ x: c, y: 0, width: 1, height: nCases });
    for (const r of sel.rows) out.push({ x: 0, y: r, width: nVars, height: 1 });
    return out;
  };

  const clearSelection = useCallback(
    (sel: GridSelection) => {
      if (!ds) return;
      const edits: CellEdit[] = [];
      for (const rect of selectedRects(sel)) {
        for (let c = rect.x; c < Math.min(rect.x + rect.width, nVars); c++)
          for (let r = rect.y; r < Math.min(rect.y + rect.height, nCases); r++) edits.push({ col: c, row: r, value: ds.variables[c].type === 'string' ? '' : null });
      }
      if (edits.length) setCells(edits);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ds, nVars, nCases, setCells],
  );

  const selectedRows = (sel: GridSelection): number[] => {
    const rows = new Set<number>(sel.rows.toArray());
    if (!rows.size && sel.current) for (let r = sel.current.range.y; r < sel.current.range.y + sel.current.range.height; r++) rows.add(r);
    return [...rows].filter((r) => r < nCases).sort((a, b) => a - b);
  };
  const selectedCols = (sel: GridSelection): number[] => {
    const cols = new Set<number>(sel.columns.toArray());
    if (!cols.size && sel.current) for (let c = sel.current.range.x; c < sel.current.range.x + sel.current.range.width; c++) cols.add(c);
    return [...cols].filter((c) => c < nVars).sort((a, b) => a - b);
  };

  const gotoCell = useCallback(
    (row: number, col = selection.current?.cell[0] ?? 0) => {
      const c = Math.max(0, Math.min(totalCols - 1, col));
      const r = Math.max(0, Math.min(totalRows - 1, row));
      const sel: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: { cell: [c, r], range: { x: c, y: r, width: 1, height: 1 }, rangeStack: [] } };
      setSelection(sel);
      select({ row: r, col: c });
      ref.current?.scrollTo(c, r, 'both', 0, 0, { vAlign: 'center' });
      ref.current?.focus();
    },
    [selection, totalCols, totalRows, select],
  );

  // register commands for menus/toolbar
  const selRef = useRef(selection);
  selRef.current = selection;
  useEffect(
    () =>
      registerGrid({
        copy: () => void ref.current?.emit('copy'),
        cut: () => void ref.current?.emit('cut'),
        paste: () => void ref.current?.emit('paste'),
        clear: () => clearSelection(selRef.current),
        insertCase: () => {
          const r = selRef.current.current?.cell[1] ?? nCases;
          useData.getState().insertCases(Math.min(r, nCases));
        },
        insertVariable: () => {
          const c = selRef.current.current?.cell[0] ?? nVars;
          useData.getState().insertVariable(Math.min(c, nVars));
        },
        deleteCases: () => {
          const rows = selectedRows(selRef.current);
          if (rows.length) useData.getState().deleteCases(rows);
          setSelection(EMPTY_SEL);
        },
        deleteVariables: () => {
          const cols = selectedCols(selRef.current);
          if (cols.length) useData.getState().deleteVariables(cols);
          setSelection(EMPTY_SEL);
        },
        gotoCase: (row, col) => gotoCell(row, col),
        focus: () => ref.current?.focus(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearSelection, gotoCell, nCases, nVars],
  );

  const sortItems = (col: number): MenuEntry[] => [
    { type: 'item', id: 'sa', label: t('data.sortAsc'), icon: 'arrow_upward', onSelect: () => useData.getState().sortBy(col, 1) },
    { type: 'item', id: 'sd', label: t('data.sortDesc'), icon: 'arrow_downward', onSelect: () => useData.getState().sortBy(col, -1) },
  ];

  const headerMenu = (col: number, x: number, y: number) => {
    if (!ds) return;
    if (col >= nVars) {
      setMenu({
        x,
        y,
        items: [{ type: 'item', id: 'nv', label: t('actions.insertVariable'), icon: 'add_column_right', onSelect: () => useData.getState().insertVariable(nVars) }],
      });
      return;
    }
    const v = ds.variables[col];
    setMenu({
      x,
      y,
      items: [
        { type: 'header', label: v.name },
        ...sortItems(col),
        { type: 'sep' },
        { type: 'item', id: 'ib', label: t('data.insertVarBefore'), icon: 'add_column_left', onSelect: () => useData.getState().insertVariable(col) },
        { type: 'item', id: 'ia', label: t('data.insertVarAfter'), icon: 'add_column_right', onSelect: () => useData.getState().insertVariable(col + 1) },
        { type: 'item', id: 'del', label: t('data.deleteVariable'), icon: 'delete', onSelect: () => useData.getState().deleteVariables(selectedCols(selection).includes(col) ? selectedCols(selection) : [col]) },
        { type: 'sep' },
        { type: 'item', id: 'props', label: t('data.variableProperties'), icon: 'tune', onSelect: () => { select({ row: col, col: 0 }); setView('variables'); } },
        { type: 'item', id: 'vl', label: t('data.valueLabelsEdit'), icon: 'label', onSelect: () => openModal({ kind: 'valueLabels', index: col }) },
        { type: 'item', id: 'freq', label: t('data.quickFrequencies'), icon: 'bar_chart', onSelect: () => openModal({ kind: 'analysis', specId: 'frequencies' }) },
      ],
    });
  };

  const cellMenu = (col: number, row: number, x: number, y: number) => {
    const inSel = selection.current && selectedRects(selection).some((r) => col >= r.x && col < r.x + r.width && row >= r.y && row < r.y + r.height);
    if (!inSel) gotoCell(row, col);
    const sel = inSel ? selection : { ...EMPTY_SEL, current: { cell: [col, row] as Item, range: { x: col, y: row, width: 1, height: 1 }, rangeStack: [] } };
    setMenu({
      x,
      y,
      items: [
        { type: 'item', id: 'cut', label: t('actions.cut'), icon: 'content_cut', shortcut: formatShortcut('Mod+X'), onSelect: () => void ref.current?.emit('cut') },
        { type: 'item', id: 'copy', label: t('actions.copy'), icon: 'content_copy', shortcut: formatShortcut('Mod+C'), onSelect: () => void ref.current?.emit('copy') },
        { type: 'item', id: 'paste', label: t('actions.paste'), icon: 'content_paste', shortcut: formatShortcut('Mod+V'), onSelect: () => void ref.current?.emit('paste') },
        { type: 'item', id: 'clear', label: t('actions.clearCells'), icon: 'backspace', shortcut: 'Del', onSelect: () => clearSelection(sel) },
        { type: 'sep' },
        { type: 'item', id: 'ica', label: t('data.insertCaseAbove'), icon: 'add_row_above', onSelect: () => useData.getState().insertCases(Math.min(row, nCases)) },
        { type: 'item', id: 'icb', label: t('data.insertCaseBelow'), icon: 'add_row_below', onSelect: () => useData.getState().insertCases(Math.min(row + 1, nCases)) },
        { type: 'item', id: 'dc', label: t('actions.deleteCases'), icon: 'delete_sweep', disabled: row >= nCases, onSelect: () => useData.getState().deleteCases(selectedRows(sel).length ? selectedRows(sel) : [row]) },
        ...(col < nVars ? [{ type: 'sep' } as MenuEntry, ...sortItems(col)] : []),
      ],
    });
  };

  if (!ds) {
    return (
      <div className="view-empty">
        <div className="empty-hint">
          <Icon name="table" />
          <h2>{t('data.noDataTitle')}</h2>
          <p>{t('data.noDataText')}</p>
          <div className="empty-actions">
            <button type="button" className="btn btn-filled" onClick={newDataset}>
              <Icon name="add" />
              {t('actions.newData')}
            </button>
            <button type="button" className="btn btn-outlined" onClick={() => void openFileDialog()}>
              <Icon name="folder_open" />
              {t('actions.open')}
            </button>
            <button type="button" className="btn btn-text" onClick={() => void openSample('students')}>
              <Icon name="school" />
              {t('samples.students.title')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid-wrap" ref={wrapRef} onContextMenu={(e) => e.preventDefault()}>
      <DataEditor
        ref={ref}
        width="100%"
        height="100%"
        columns={columns}
        rows={totalRows}
        getCellContent={getCellContent}
        onCellEdited={onCellEdited}
        onPaste={onPaste}
        getCellsForSelection
        rowMarkers={{ kind: 'clickable-number', width: Math.round(Math.max(44, String(totalRows).length * 9 + 18) * m.zoom) }}
        smoothScrollX
        smoothScrollY
        theme={m.theme}
        rowHeight={m.rowHeight}
        headerHeight={m.headerHeight}
        gridSelection={selection}
        onGridSelectionChange={(sel) => {
          setSelection(sel);
          if (sel.current) select({ row: sel.current.cell[1], col: sel.current.cell[0] });
          else if (sel.columns.length) select({ row: 0, col: sel.columns.first() ?? 0 });
        }}
        onDelete={(sel) => {
          clearSelection(sel);
          return false;
        }}
        rangeSelect="multi-rect"
        columnSelect="multi"
        rowSelect="multi"
        onColumnResize={(_c, w, idx) => setWidths((x) => ({ ...x, [idx]: w }))}
        onColumnResizeEnd={(_c, w, idx) => {
          if (idx < nVars) useData.getState().updateVariable(idx, { columns: Math.max(1, Math.round((w - 34) / m.charWidth)) });
          setWidths((x) => {
            const n = { ...x };
            delete n[idx];
            return n;
          });
        }}
        onColumnMoved={(from, to) => {
          if (from < nVars && to < nVars) useData.getState().moveVariable(from, to);
        }}
        onHeaderContextMenu={(col, e) => {
          e.preventDefault();
          headerMenu(col, e.bounds.x, e.bounds.y + e.bounds.height);
        }}
        onHeaderMenuClick={(col, b) => headerMenu(col, b.x, b.y + b.height)}
        onCellContextMenu={([col, row], e) => {
          e.preventDefault();
          if (col < 0) return;
          cellMenu(col, row, e.bounds.x + e.localEventX, e.bounds.y + e.localEventY);
        }}
        keybindings={{ search: false, selectAll: true, copy: true, paste: true, cut: true, delete: true }}
        fillHandle
        scaleToRem={false}
      />
      {menu && <Menu items={menu.items} anchor={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />}
    </div>
  );
}
