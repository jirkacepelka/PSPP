/*
 * Data View: spreadsheet-like grid of cases × variables.
 * Value labels as tags, measurement-level headers, a label picker editor, data-quality flags,
 * quick analyses from the header menu, named undo steps.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CompactSelection,
  DataEditor,
  GridCellKind,
  type DataEditorRef,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridMouseEventArgs,
  type GridSelection,
  type Item,
  type ProvideEditorCallback,
  type Rectangle,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import './data.css';
import type { Cell, Measure, Variable } from '../../engine/types';
import { useData, type CellEdit } from '../../store/data';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { editText, formatCell, formatSpec, isMissingValue, labelValueText, parseCell, parseNumber, valueLabelFor } from '../../lib/format';
import { caseCount, hasUserMissing, isCategoricalVar, measureKey } from '../../lib/variables';
import { registerGrid, useActiveVariable } from '../../app/gridBus';
import { variableIcon } from '../../app/varIcons';
import { formatShortcut, runAction } from '../../app/actions';
import { newDataset, openFileDialog, openSample } from '../../app/files';
import { useGridTheme } from '../grid/gridTheme';
import { makeDataCellRenderer, isDataCell, type DataCell, type DataCellData, type PickOption } from '../grid/dataCell';
import { makeDrawHeader, type HeaderInfo } from '../grid/header';
import { LabelPickerEditor, TextEditor } from '../grid/editors';
import { cellChecker, labelsDefineDomain, type CellChecker, type FlagKind } from '../grid/quality';
import { Menu, type MenuEntry } from '../../components/Menu';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { typeLabel } from '../variables/describe';
import { useDataPrefs } from './prefs';
import { inspectVariable, quickAnalysis } from './quickActions';
import { FilterChip } from '../../components/Chip';
import { useCommandBarSlot } from '../shell/layout';

const EMPTY_SEL: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty() };

interface VarInfo {
  v: Variable;
  options: PickOption[] | undefined;
  check: CellChecker;
  userMissing: boolean;
  tag: DataCellData['tag'];
}

interface Tip {
  x: number;
  y: number;
  /** bottom of the anchor; the tip goes below it */
  below: number;
  title: string;
  lines: string[];
  tone?: 'warning';
}

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
  const highlightFlags = useDataPrefs((s) => s.highlightFlags);
  const headerLabels = useDataPrefs((s) => s.headerLabels);
  const m = useGridTheme();
  const ref = useRef<DataEditorRef>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<GridSelection>(EMPTY_SEL);
  const [menu, setMenu] = useState<{ items: MenuEntry[]; x: number; y: number; label?: string } | null>(null);
  const [widths, setWidths] = useState<Record<number, number>>({});
  const [tip, setTip] = useState<Tip | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flagChip = useMemo(
    () => (
      <FilterChip selected={highlightFlags} icon="flag" onToggle={(b) => useDataPrefs.getState().set({ highlightFlags: b })}>
        {t('dataView.flagsChip')}
      </FilterChip>
    ),
    [highlightFlags, t],
  );
  useCommandBarSlot('data', flagChip);

  const nVars = ds?.variables.length ?? 0;
  const nCases = caseCount(ds);
  const extraCols = Math.max(3, 16 - nVars);
  const totalCols = nVars + extraCols;
  const totalRows = Math.max(nCases + 100, 200);
  const anyLabels = useMemo(() => !!ds?.variables.some((v) => v.label), [ds?.variables]);
  const twoLineHeader = headerLabels && anyLabels;
  const headerHeight = twoLineHeader ? m.headerHeight : Math.round(m.headerHeight * 0.78);

  // per-variable lookup tables, rebuilt only when the dictionary changes
  const info = useMemo<VarInfo[]>(
    () =>
      (ds?.variables ?? []).map((v) => ({
        v,
        options: v.valueLabels.length
          ? v.valueLabels.map((l) => ({ code: labelValueText(l.value, v, { decimalSeparator: dec }), label: l.label, missing: hasUserMissing(v) && isMissingValue(l.value, v) }))
          : undefined,
        check: cellChecker(v),
        userMissing: hasUserMissing(v),
        tag: isCategoricalVar(v) ? measureKey(v) : null,
      })),
    [ds?.variables, dec],
  );

  const columns = useMemo<GridColumn[]>(() => {
    const cols: GridColumn[] = [];
    if (!ds) return cols;
    ds.variables.forEach((v, i) => {
      const labelled = v.valueLabels.length > 0 && isCategoricalVar(v);
      const longest = labelled ? v.valueLabels.reduce((n, l) => Math.max(n, l.label.length), 0) : 0;
      const base = Math.max(v.columns * m.charWidth + 34, v.name.length * 8 * m.zoom + 64, labelled ? Math.min(220 * m.zoom, longest * 7 * m.zoom + 40) : 72);
      const w = widths[i] ?? Math.round(Math.min(360, base));
      cols.push({ id: `v${i}-${v.name}`, title: v.name, width: w, hasMenu: true });
    });
    for (let i = 0; i < extraCols; i++) cols.push({ id: `empty${i}`, title: i === 0 ? t('dataView.addVariable') : '', width: Math.round((i === 0 ? 150 : 84) * m.zoom) });
    return cols;
  }, [ds, extraCols, widths, m.charWidth, m.zoom, t]);

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const vi = info[col];
      const blank = (name?: string, options?: PickOption[], isString?: boolean): DataCell => ({
        kind: GridCellKind.Custom,
        allowOverlay: true,
        readonly: false,
        copyData: '',
        data: { kind: 'pspp-data', text: '', raw: '', tag: null, state: 'empty', flag: null, align: 'left', row, name, options, isString },
      });
      if (!ds || !vi) return blank();
      const v = vi.v;
      const c: Cell = row < nCases ? ds.columns[col][row] ?? null : null;
      if (c === null || c === '') return blank(v.name, vi.options, v.type === 'string');
      const label = valueLabels && vi.options ? valueLabelFor(c, v) : undefined;
      const missing = vi.userMissing && isMissingValue(c, v);
      const text = label ?? formatCell(c, v, { decimalSeparator: dec });
      const raw = editText(c, v, { decimalSeparator: dec });
      const tag = label !== undefined && !missing ? vi.tag : null;
      return {
        kind: GridCellKind.Custom,
        allowOverlay: true,
        readonly: false,
        copyData: valueLabels ? text : raw,
        data: {
          kind: 'pspp-data',
          text,
          raw,
          tag,
          state: missing ? 'userMissing' : 'value',
          flag: highlightFlags ? vi.check(c) : null,
          align: valueLabels && vi.tag && vi.options ? 'left' : v.align,
          row,
          name: v.name,
          options: vi.options,
          isString: v.type === 'string',
        },
      } as DataCell;
    },
    [ds, info, nCases, valueLabels, dec, highlightFlags],
  );

  // canvas renderers read the live palette through refs, so they are created once
  const paletteRef = useRef(m.palette);
  paletteRef.current = m.palette;
  const zoomRef = useRef(m.zoom);
  zoomRef.current = m.zoom;
  const infoRef = useRef(info);
  infoRef.current = info;
  const labelsRef = useRef(twoLineHeader);
  labelsRef.current = twoLineHeader;
  const addText = t('dataView.addVariable');
  const addRef = useRef(addText);
  addRef.current = addText;
  const nVarsRef = useRef(nVars);
  nVarsRef.current = nVars;
  const customRenderers = useMemo(() => [makeDataCellRenderer(() => paletteRef.current, () => zoomRef.current)], []);
  const drawHeader = useMemo(
    () =>
      makeDrawHeader(
        (col): HeaderInfo => {
          const vi = infoRef.current[col];
          if (vi) return { kind: 'var', name: vi.v.name, label: vi.v.label, measure: measureKey(vi.v), icon: variableIcon(vi.v) };
          return col === nVarsRef.current ? { kind: 'add', text: addRef.current } : { kind: 'blank' };
        },
        () => paletteRef.current,
        () => zoomRef.current,
        () => labelsRef.current,
      ),
    [],
  );
  // redraw headers when what they show changes
  useEffect(() => {
    ref.current?.updateCells(Array.from({ length: totalCols }, (_, c) => ({ cell: [c, -1] as Item })));
  }, [info, m.key, twoLineHeader, totalCols]);

  const provideEditor = useCallback<ProvideEditorCallback<GridCell>>((cell) => {
    if (!isDataCell(cell)) return undefined;
    const editor = cell.data.options?.length ? LabelPickerEditor : TextEditor;
    return { editor: editor as never, disablePadding: true, disableStyling: true };
  }, []);

  const getRowThemeOverride = useCallback(
    (row: number) => (row >= nCases ? { bgCell: m.palette.canvas, textLight: m.palette.ink3, borderColor: m.palette.line } : undefined),
    [nCases, m.palette],
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

  const cellName = useCallback((col: number, row: number) => `${ds?.variables[col]?.name ?? t('dataView.newVariable')}[${row + 1}]`, [ds, t]);

  const applyEdits = useCallback(
    (raw: { col: number; row: number; text: string }[], label?: string) => {
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
      for (const e of edits) if (ds && e.col >= ds.variables.length && newColString.get(e.col) && e.value === null) e.value = '';
      if (edits.length) setCells(edits, label ?? (edits.length === 1 ? t('undo.editCell', { cell: cellName(edits[0].col, edits[0].row) }) : t('undo.editCells', { count: edits.length })));
      if (bad.length) {
        const first = raw.find((e) => e.text === bad[0]);
        const v = first ? ds?.variables[first.col] : undefined;
        toast(bad.length === 1 && v ? t('data.invalidValue', { value: bad[0], name: v.name }) : t('data.invalidValues', { count: bad.length, example: bad[0] }), { kind: 'error' });
      }
    },
    [ds, dec, setCells, toast, t, toValue, cellName],
  );

  const onCellEdited = useCallback(
    ([col, row]: Item, val: EditableGridCell) => {
      if (!isDataCell(val)) return;
      const cur = ds && col < nVars && row < nCases ? editText(ds.columns[col][row] ?? null, ds.variables[col], { decimalSeparator: dec }) : '';
      if (val.data.raw === cur) return;
      applyEdits([{ col, row, text: val.data.raw }]);
    },
    [applyEdits, ds, nVars, nCases, dec],
  );

  const onPaste = useCallback(
    ([col, row]: Item, values: readonly (readonly string[])[]) => {
      const raw: { col: number; row: number; text: string }[] = [];
      values.forEach((line, r) => line.forEach((text, c) => raw.push({ col: col + c, row: row + r, text })));
      applyEdits(raw, raw.length === 1 ? undefined : t('undo.paste', { count: raw.length }));
      return false;
    },
    [applyEdits, t],
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
      if (edits.length) setCells(edits, edits.length === 1 ? t('undo.clearCell', { cell: cellName(edits[0].col, edits[0].row) }) : t('undo.clearCells', { count: edits.length }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ds, nVars, nCases, setCells, t, cellName],
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

  const undoToast = useCallback((message: string) => toast(message, { action: { label: t('actions.undo'), run: () => useData.getState().undo() } }), [toast, t]);

  const gotoCell = useCallback(
    (row: number, col = selection.current?.cell[0] ?? 0) => {
      const c = Math.max(0, Math.min(totalCols - 1, col));
      const r = Math.max(0, Math.min(totalRows - 1, row));
      const sel: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: { cell: [c, r], range: { x: c, y: r, width: 1, height: 1 }, rangeStack: [] } };
      setSelection(sel);
      select({ row: r, col: c });
      if (c < nVars) useActiveVariable.getState().setActive(c);
      ref.current?.scrollTo(c, r, 'both', 0, 0, { vAlign: 'center' });
      ref.current?.focus();
    },
    [selection, totalCols, totalRows, select, nVars],
  );

  const deleteCases = useCallback(
    (rows: number[]) => {
      if (!rows.length) return;
      useData.getState().deleteCases(rows, t('undo.deleteCases', { count: rows.length }));
      setSelection(EMPTY_SEL);
      undoToast(t('dataView.casesDeleted', { count: rows.length }));
    },
    [t, undoToast],
  );
  const deleteVariables = useCallback(
    (cols: number[]) => {
      if (!cols.length || !ds) return;
      const names = cols.map((c) => ds.variables[c]?.name).filter(Boolean).join(', ');
      useData.getState().deleteVariables(cols, t('undo.deleteVariables', { count: cols.length, names }));
      setSelection(EMPTY_SEL);
      undoToast(t('dataView.variablesDeleted', { count: cols.length, names }));
    },
    [ds, t, undoToast],
  );
  const sortBy = useCallback(
    (col: number, dir: 1 | -1) => {
      const v = ds?.variables[col];
      if (!v) return;
      const d = t(dir === 1 ? 'dataView.ascending' : 'dataView.descending');
      useData.getState().sortBy(col, dir, t('undo.sort', { name: v.name, dir: d }));
      undoToast(t('dataView.sorted', { name: v.name, dir: d }));
    },
    [ds, t, undoToast],
  );
  const insertVariable = useCallback(
    (at: number) => {
      const name = useData.getState().insertVariable(at, {}, t('undo.insertVariable'));
      if (name) setTimeout(() => gotoVariableRef.current(at), 0);
    },
    [t],
  );
  const insertCases = useCallback((at: number) => useData.getState().insertCases(at, 1, t('undo.insertCase', { row: at + 1 })), [t]);

  const gotoVariable = useCallback(
    (index: number) => {
      const c = Math.max(0, Math.min(totalCols - 1, index));
      const r = selection.current?.cell[1] ?? 0;
      const sel: GridSelection = { columns: CompactSelection.fromSingleSelection(c), rows: CompactSelection.empty(), current: { cell: [c, r], range: { x: c, y: r, width: 1, height: 1 }, rangeStack: [] } };
      setSelection(sel);
      select({ row: r, col: c });
      if (c < nVars) useActiveVariable.getState().setActive(c);
      ref.current?.scrollTo(c, r, 'horizontal');
      ref.current?.focus();
    },
    [totalCols, selection, select, nVars],
  );
  const gotoVariableRef = useRef(gotoVariable);
  gotoVariableRef.current = gotoVariable;

  // keep the inspector in sync when the Data View opens; with nothing selected yet, start on the
  // first cell of the first variable that is not a case identifier (all values distinct), so the
  // formula bar and inspector show something useful instead of "select a cell"
  useEffect(() => {
    const c = selection.current?.cell[0];
    if (c !== undefined && c < nVars) useActiveVariable.getState().setActive(c, selectedCols(selection));
    else if (nVars && ds) {
      const n = Math.min(200, Math.max(0, ...ds.columns.map((x) => x?.length ?? 0)));
      const isId = (i: number) => {
        const col = (ds.columns[i] ?? []).slice(0, n).filter((x) => x !== null && x !== '');
        return col.length > 1 && new Set(col).size === col.length;
      };
      let first = 0;
      while (first < nVars - 1 && isId(first)) first++;
      if (n > 0) {
        const sel: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: { cell: [first, 0], range: { x: first, y: 0, width: 1, height: 1 }, rangeStack: [] } };
        setSelection(sel);
        select({ row: 0, col: first });
      }
      useActiveVariable.getState().setActive(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nVars]);

  // register commands for menus/toolbar
  const selRef = useRef(selection);
  selRef.current = selection;
  useEffect(
    () =>
      registerGrid({
        copy: () => void ref.current?.emit('copy'),
        cut: () => {
          const sel = selRef.current;
          void ref.current?.emit('copy').then(() => clearSelection(sel));
        },
        paste: () => void ref.current?.emit('paste'),
        clear: () => clearSelection(selRef.current),
        insertCase: () => insertCases(Math.min(selRef.current.current?.cell[1] ?? nCases, nCases)),
        insertVariable: () => insertVariable(Math.min(selRef.current.current?.cell[0] ?? nVars, nVars)),
        deleteCases: () => deleteCases(selectedRows(selRef.current)),
        deleteVariables: () => deleteVariables(selectedCols(selRef.current)),
        gotoCase: (row, col) => gotoCell(row, col),
        gotoVariable: (i) => gotoVariable(i),
        focus: () => ref.current?.focus(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearSelection, gotoCell, gotoVariable, nCases, nVars, insertCases, insertVariable, deleteCases, deleteVariables],
  );

  // accessible name for the canvas grid (A-1)
  const title = useData((s) => s.title);
  useEffect(() => {
    wrapRef.current?.querySelector('[role="grid"]')?.setAttribute('aria-label', t('dataView.gridLabel', { title }));
  });

  const setMeasure = (cols: number[], measure: Measure) => {
    if (!ds) return;
    const names = cols.map((c) => ds.variables[c].name).join(', ');
    useData.getState().apply((d) => ({ ...d, variables: d.variables.map((v, i) => (cols.includes(i) && !(measure === 'scale' && v.type === 'string') ? { ...v, measure } : v)) }), t('undo.setMeasure', { names, measure: t(`measure.${measure}`) }));
  };

  const headerMenu = (col: number, x: number, y: number) => {
    hideTip();
    if (!ds) return;
    if (col >= nVars) {
      setMenu({ x, y, items: [{ type: 'item', id: 'nv', label: t('dataView.addVariable'), icon: 'add_column_right', onSelect: () => insertVariable(nVars) }] });
      return;
    }
    const v = ds.variables[col];
    const sel = selectedCols(selection);
    const cols = sel.includes(col) ? sel : [col];
    const names = cols.map((c) => ds.variables[c].name);
    const many = cols.length > 1;
    const allString = cols.every((c) => ds.variables[c].type === 'string');
    const prefs = useDataPrefs.getState();
    setMenu({
      x,
      y,
      label: v.name,
      items: [
        { type: 'header', label: many ? t('dataView.nVariables', { count: cols.length }) : v.label ? `${v.name} · ${v.label}` : v.name },
        { type: 'item', id: 'freq', label: t('dataView.frequencies'), icon: 'bar_chart', onSelect: () => quickAnalysis('frequencies', names) },
        { type: 'item', id: 'desc', label: t('dataView.descriptives'), icon: 'functions', disabled: allString, onSelect: () => quickAnalysis('descriptives', names.filter((_, i) => ds.variables[cols[i]].type !== 'string')) },
        { type: 'item', id: 'expl', label: t('dataView.explore'), icon: 'query_stats', disabled: allString, onSelect: () => quickAnalysis('explore', names.filter((_, i) => ds.variables[cols[i]].type !== 'string')) },
        { type: 'item', id: 'rec', label: t('dataView.recode'), icon: 'swap_horiz', onSelect: () => quickAnalysis('recode', names) },
        { type: 'sep' },
        { type: 'item', id: 'sa', label: t('data.sortAsc'), icon: 'arrow_upward', disabled: many, onSelect: () => sortBy(col, 1) },
        { type: 'item', id: 'sd', label: t('data.sortDesc'), icon: 'arrow_downward', disabled: many, onSelect: () => sortBy(col, -1) },
        { type: 'sep' },
        {
          type: 'submenu',
          id: 'measure',
          label: t('dataView.measure'),
          icon: variableIcon(v),
          items: (['nominal', 'ordinal', 'scale'] as Measure[]).map((ms) => ({
            type: 'item' as const,
            id: ms,
            label: t(`measure.${ms}`),
            icon: ms === 'nominal' ? 'category' : ms === 'ordinal' ? 'signal_cellular_alt' : 'straighten',
            checked: cols.every((c) => ds.variables[c].measure === ms),
            disabled: ms === 'scale' && allString,
            onSelect: () => setMeasure(cols, ms),
          })),
        },
        { type: 'item', id: 'vl', label: t('data.valueLabelsEdit'), icon: 'sell', disabled: many, onSelect: () => openModal({ kind: 'valueLabels', index: col }) },
        { type: 'item', id: 'insp', label: t('dataView.inspect'), icon: 'right_panel_open', shortcut: formatShortcut('Mod+I'), onSelect: () => inspectVariable(col) },
        { type: 'item', id: 'props', label: t('dataView.openInVariableView'), icon: 'view_list', onSelect: () => { useActiveVariable.getState().setActive(col); select({ row: col, col: 0 }); setView('variables'); } },
        { type: 'sep' },
        { type: 'item', id: 'ib', label: t('data.insertVarBefore'), icon: 'add_column_left', onSelect: () => insertVariable(col) },
        { type: 'item', id: 'ia', label: t('data.insertVarAfter'), icon: 'add_column_right', onSelect: () => insertVariable(col + 1) },
        { type: 'item', id: 'del', label: many ? t('dataView.deleteVariables', { count: cols.length }) : t('data.deleteVariable'), icon: 'delete', danger: true, onSelect: () => deleteVariables(cols) },
        { type: 'sep' },
        { type: 'item', id: 'vlab', label: t('actions.valueLabels'), shortcut: formatShortcut('Mod+L'), checked: useUi.getState().valueLabels, onSelect: () => runAction('view.valueLabels') },
        { type: 'item', id: 'flags', label: t('dataView.highlightFlags'), checked: prefs.highlightFlags, onSelect: () => prefs.set({ highlightFlags: !prefs.highlightFlags }) },
        { type: 'item', id: 'hl', label: t('dataView.headerLabels'), checked: prefs.headerLabels, onSelect: () => prefs.set({ headerLabels: !prefs.headerLabels }) },
      ],
    });
  };

  const cellMenu = (col: number, row: number, x: number, y: number) => {
    hideTip();
    const inSel = selection.current && selectedRects(selection).some((r) => col >= r.x && col < r.x + r.width && row >= r.y && row < r.y + r.height);
    if (!inSel) gotoCell(row, col);
    const sel = inSel ? selection : { ...EMPTY_SEL, current: { cell: [col, row] as Item, range: { x: col, y: row, width: 1, height: 1 }, rangeStack: [] } };
    const v = ds?.variables[col];
    setMenu({
      x,
      y,
      items: [
        { type: 'item', id: 'cut', label: t('actions.cut'), icon: 'content_cut', shortcut: formatShortcut('Mod+X'), onSelect: () => void ref.current?.emit('copy').then(() => clearSelection(sel)) },
        { type: 'item', id: 'copy', label: t('actions.copy'), icon: 'content_copy', shortcut: formatShortcut('Mod+C'), onSelect: () => void ref.current?.emit('copy') },
        { type: 'item', id: 'paste', label: t('actions.paste'), icon: 'content_paste', shortcut: formatShortcut('Mod+V'), onSelect: () => void ref.current?.emit('paste') },
        { type: 'item', id: 'clear', label: t('actions.clearCells'), icon: 'backspace', shortcut: 'Del', onSelect: () => clearSelection(sel) },
        { type: 'sep' },
        { type: 'item', id: 'ica', label: t('data.insertCaseAbove'), icon: 'add_row_above', onSelect: () => insertCases(Math.min(row, nCases)) },
        { type: 'item', id: 'icb', label: t('data.insertCaseBelow'), icon: 'add_row_below', onSelect: () => insertCases(Math.min(row + 1, nCases)) },
        { type: 'item', id: 'dc', label: t('actions.deleteCases'), icon: 'delete_sweep', danger: true, disabled: row >= nCases, onSelect: () => deleteCases(selectedRows(sel).length ? selectedRows(sel) : [row]) },
        ...(v
          ? ([
              { type: 'sep' },
              { type: 'item', id: 'sa', label: t('data.sortAsc'), icon: 'arrow_upward', onSelect: () => sortBy(col, 1) },
              { type: 'item', id: 'sd', label: t('data.sortDesc'), icon: 'arrow_downward', onSelect: () => sortBy(col, -1) },
              { type: 'item', id: 'insp', label: t('dataView.inspect'), icon: 'right_panel_open', shortcut: formatShortcut('Mod+I'), onSelect: () => inspectVariable(col) },
            ] as MenuEntry[])
          : []),
      ],
    });
  };

  // ---- tooltips: header summary and data-quality flags ----
  const hideTip = useCallback(() => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = null;
    setTip(null);
  }, []);
  useEffect(() => hideTip, [hideTip]);

  const flagMessage = useCallback(
    (kind: FlagKind, c: Cell, v: Variable): string => {
      const value = typeof c === 'number' ? labelValueText(c, v, { decimalSeparator: dec }) : `„${String(c)}“`;
      if (kind === 'outOfRange') {
        const r = v.validRange;
        const show = (x: number | undefined, inf: string) => (x === undefined || !Number.isFinite(x) ? inf : labelValueText(x, v, { decimalSeparator: dec }));
        return t('dataView.flag.outOfRange', { value, min: show(r?.min, '−∞'), max: show(r?.max, '∞') });
      }
      if (kind === 'whitespace') return t('dataView.flag.whitespace');
      if (kind === 'caseVariant') return t('dataView.flag.caseVariant', { value });
      const codes = v.valueLabels.map((l) => labelValueText(l.value, v, { decimalSeparator: dec }));
      return t('dataView.flag.noLabel', { value, name: v.name, codes: codes.length > 8 ? `${codes.slice(0, 8).join(', ')}, …` : codes.join(', ') });
    },
    [t, dec],
  );

  const onItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      if (tipTimer.current) clearTimeout(tipTimer.current);
      tipTimer.current = null;
      setTip(null);
      if (!ds) return;
      const [col, row] = args.location;
      const v = ds.variables[col];
      if (!v) return;
      if (args.kind !== 'header' && args.kind !== 'cell') return;
      const b = args.bounds;
      if (args.kind === 'header') {
        tipTimer.current = setTimeout(() => {
          if (useUi.getState().modal || document.querySelector('.menu')) return;
          const column = ds.columns[col] ?? [];
          let sys = 0;
          let user = 0;
          const um = hasUserMissing(v);
          for (let r = 0; r < nCases; r++) {
            const c = column[r] ?? null;
            if (c === null || c === '') sys++;
            else if (um && isMissingValue(c, v)) user++;
          }
          const lines = [
            `${t(`measure.${v.type === 'string' ? 'nominal' : v.measure}`)} · ${typeLabel(v, t)} ${formatSpec(v.print)}`,
            t('dataView.tipCounts', { valid: nCases - sys - user, missing: sys + user }),
          ];
          if (v.valueLabels.length) lines.push(t('dataView.tipLabels', { count: v.valueLabels.length }));
          if (labelsDefineDomain(v) || v.validRange) lines.push(t('dataView.tipFlagsHint'));
          setTip({ x: b.x, y: b.y, below: b.y + b.height, title: v.label ? `${v.name} — ${v.label}` : v.name, lines });
        }, 450);
        return;
      }
      if (args.kind === 'cell' && highlightFlags && row < nCases) {
        const c = ds.columns[col][row] ?? null;
        const kind = c === null ? null : info[col]?.check(c);
        if (!kind) return;
        tipTimer.current = setTimeout(() => !useUi.getState().modal && setTip({ x: b.x, y: b.y, below: b.y + b.height, title: t(`dataView.flagTitle.${kind}`), lines: [flagMessage(kind, c, v)], tone: 'warning' }), 300);
      }
    },
    [ds, nCases, info, highlightFlags, t, flagMessage],
  );

  if (!ds) {
    return (
      <div className="view-empty data-empty">
        <EmptyState
          icon="table"
          title={t('data.noDataTitle')}
          description={t('data.noDataText')}
          actions={
            <>
              <Button variant="primary" iconStart="add" onClick={newDataset}>
                {t('actions.newData')}
              </Button>
              <Button iconStart="folder_open" onClick={() => void openFileDialog()}>
                {t('actions.open')}
              </Button>
              <Button variant="ghost" iconStart="school" onClick={() => void openSample('students')}>
                {t('samples.students.title')}
              </Button>
            </>
          }
        />
      </div>
    );
  }

  const tipStyle = tip ? (() => {
    const host = wrapRef.current?.getBoundingClientRect();
    const left = Math.max(8, Math.min(tip.x, window.innerWidth - 300));
    return { left: left - (host?.left ?? 0), top: tip.below - (host?.top ?? 0) + 6 };
  })() : undefined;

  return (
    <div
      className="grid-wrap data-grid"
      ref={wrapRef}
      onContextMenu={(e) => e.preventDefault()}
      onPointerLeave={hideTip}
      onKeyDown={(e) => {
        // Shift+F10 / context-menu key opens the menu for the focused cell or column (A-1)
        if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
          e.preventDefault();
          const cur = selection.current;
          if (selection.columns.length && !cur) {
            const c = selection.columns.first() ?? 0;
            const b = ref.current?.getBounds(c, -1);
            if (b) headerMenu(c, b.x, b.y + b.height);
          } else if (cur) {
            const b = ref.current?.getBounds(cur.cell[0], cur.cell[1]);
            if (b) cellMenu(cur.cell[0], cur.cell[1], b.x + 8, b.y + b.height);
          }
        }
      }}
    >
      <DataEditor
        ref={ref}
        width="100%"
        height="100%"
        columns={columns}
        rows={totalRows}
        getCellContent={getCellContent}
        customRenderers={customRenderers as never}
        provideEditor={provideEditor}
        drawHeader={drawHeader}
        getRowThemeOverride={getRowThemeOverride}
        onCellEdited={onCellEdited}
        onPaste={onPaste}
        getCellsForSelection
        rowMarkers={{ kind: 'clickable-number', width: Math.round(Math.max(44, String(totalRows).length * 9 + 18) * m.zoom) }}
        smoothScrollX
        smoothScrollY
        theme={m.theme}
        rowHeight={m.rowHeight}
        headerHeight={headerHeight}
        gridSelection={selection}
        onGridSelectionChange={(sel) => {
          setSelection(sel);
          hideTip();
          if (sel.current) select({ row: sel.current.cell[1], col: sel.current.cell[0] });
          else if (sel.columns.length) select({ row: 0, col: sel.columns.first() ?? 0 });
          const cols = selectedCols(sel);
          const c = sel.current?.cell[0] ?? sel.columns.first();
          if (c !== undefined && c < nVars) useActiveVariable.getState().setActive(c, cols.includes(c) ? cols : [c]);
        }}
        onDelete={(sel) => {
          clearSelection(sel);
          return false;
        }}
        onItemHovered={onItemHovered}
        onVisibleRegionChanged={hideTip}
        rangeSelect="multi-rect"
        columnSelect="multi"
        rowSelect="multi"
        onHeaderClicked={(col) => {
          if (col === nVars) insertVariable(nVars);
        }}
        onColumnResize={(_c, w, idx) => setWidths((x) => ({ ...x, [idx]: w }))}
        onColumnResizeEnd={(_c, w, idx) => {
          const v = ds.variables[idx];
          if (v) useData.getState().updateVariable(idx, { columns: Math.max(1, Math.round((w - 34) / m.charWidth)) }, t('undo.columnWidth', { name: v.name }));
          setWidths((x) => {
            const n = { ...x };
            delete n[idx];
            return n;
          });
        }}
        onColumnMoved={(from, to) => {
          if (from < nVars && to < nVars) useData.getState().moveVariable(from, to, t('undo.moveVariable', { name: ds.variables[from].name }));
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
      {tip && (
        <div className={`data-tip ${tip.tone === 'warning' ? 'warning' : ''}`} role="tooltip" style={tipStyle}>
          <div className="data-tip-title">{tip.title}</div>
          {tip.lines.map((l, i) => (
            <div key={i} className="data-tip-line">
              {l}
            </div>
          ))}
        </div>
      )}
      {menu && <Menu items={menu.items} label={menu.label} anchor={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />}
    </div>
  );
}
