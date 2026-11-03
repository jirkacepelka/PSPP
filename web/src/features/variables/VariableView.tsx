/*
 * Variable View: dictionary editor (one row per variable).
 * Essential columns by default (VV-1), measurement icon before the name (VV-2), value labels and
 * missing values drawn as chips (VV-4), bulk edits on multi-row selections (VV-3), drag to
 * reorder rows, inline name validation (VV-8), named undo steps.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CompactSelection,
  DataEditor,
  GridCellKind,
  type DataEditorRef,
  type DrawCellCallback,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import '../data/data.css';
import './variables.css';
import type { Align, Measure, Role, Variable } from '../../engine/types';
import { useData } from '../../store/data';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { formatSpec, labelValueText, valueLabelFor } from '../../lib/format';
import { isValidVarName, makeVariable, measureKey, nextVarName } from '../../lib/variables';
import { registerGrid, useActiveVariable } from '../../app/gridBus';
import { variableIcon } from '../../app/varIcons';
import { newDataset } from '../../app/files';
import { useGridTheme, type GridPalette } from '../grid/gridTheme';
import { drawIcon, fitText, roundRect, textWidth } from '../grid/canvas';
import { columnQuality } from '../grid/quality';
import { Menu, type MenuEntry } from '../../components/Menu';
import { MenuButton } from '../../components/MenuButton';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { FilterChip } from '../../components/Chip';
import { ToolbarGroup } from '../../components/Toolbar';
import { useCommandBarSlot } from '../shell/layout';
import { inspectVariable, quickAnalysis } from '../data/quickActions';
import { missingSummary, typeLabel, valueLabelsSummary } from './describe';

type ColId = 'name' | 'label' | 'measure' | 'type' | 'width' | 'decimals' | 'values' | 'missing' | 'columns' | 'align' | 'role' | 'check';
const ALL_COLS: { id: ColId; w: number; essential?: boolean }[] = [
  { id: 'name', w: 160, essential: true },
  { id: 'label', w: 240, essential: true },
  { id: 'measure', w: 132, essential: true },
  { id: 'type', w: 150, essential: true },
  { id: 'width', w: 72 },
  { id: 'decimals', w: 92 },
  { id: 'values', w: 260, essential: true },
  { id: 'missing', w: 170, essential: true },
  { id: 'columns', w: 80 },
  { id: 'align', w: 104 },
  { id: 'role', w: 104 },
  { id: 'check', w: 104 },
];

const ALIGNS: Align[] = ['left', 'right', 'center'];
const MEASURES: Measure[] = ['nominal', 'ordinal', 'scale'];
const ROLES: Role[] = ['input', 'target', 'both', 'none', 'partition', 'split'];
const MEASURE_ICON: Record<string, string> = { nominal: 'category', ordinal: 'signal_cellular_alt', scale: 'straighten', unknown: 'help' };
const ALIGN_ICON: Record<string, string> = { left: 'format_align_left', right: 'format_align_right', center: 'format_align_center' };
const CHOICE: ColId[] = ['measure', 'align', 'role'];
const DIALOG: ColId[] = ['type', 'values', 'missing'];

interface Chip {
  code: string;
  label: string;
}

/** Draws value chips "code │ label" left to right; returns nothing. */
function drawChips(ctx: CanvasRenderingContext2D, chips: Chip[], extra: number, x0: number, y: number, w: number, h: number, pal: GridPalette, font: string, z: number) {
  let x = x0;
  const end = x0 + w;
  const ch = Math.min(h - 8, Math.round(20 * z));
  const cy = y + h / 2 + 0.5;
  const top = y + (h - ch) / 2;
  const padX = Math.round(6 * z);
  const gap = Math.round(4 * z);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (let i = 0; i < chips.length; i++) {
    const c = chips[i];
    const remaining = chips.length - i - 1 + extra;
    const moreW = remaining ? textWidth(ctx, `+${remaining}`) + gap * 2 : 0;
    const codeW = textWidth(ctx, c.code) + padX * 2;
    if (x + codeW + moreW > end) {
      // no room: show "+n" for the rest
      ctx.fillStyle = pal.ink3;
      ctx.fillText(`+${chips.length - i + extra}`, x + 2, cy);
      return;
    }
    const labelMax = end - x - codeW - moreW - padX * 2;
    const label = c.label ? fitText(ctx, c.label, Math.max(0, labelMax)) : '';
    const labelW = label ? textWidth(ctx, label) + padX * 2 : 0;
    const cw = codeW + labelW;
    ctx.fillStyle = pal.surface;
    roundRect(ctx, x + 0.5, top + 0.5, cw - 1, ch - 1, 4);
    ctx.fill();
    ctx.strokeStyle = pal.lineStrong;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    roundRect(ctx, x + 0.5, top + 0.5, codeW, ch - 1, 4);
    ctx.clip();
    ctx.fillStyle = pal.sunken;
    ctx.fillRect(x, top, codeW, ch);
    ctx.restore();
    ctx.fillStyle = pal.lineStrong;
    ctx.fillRect(x + codeW, top + 1, 1, ch - 2);
    ctx.fillStyle = pal.ink2;
    ctx.fillText(c.code, x + padX, cy);
    if (label) {
      ctx.fillStyle = pal.ink;
      ctx.fillText(label, x + codeW + padX, cy);
    }
    x += cw + gap;
    if (!label && c.label) {
      ctx.fillStyle = pal.ink3;
      ctx.fillText(`+${chips.length - i - 1 + extra}`, x, cy);
      return;
    }
  }
  if (extra) {
    ctx.fillStyle = pal.ink3;
    ctx.fillText(`+${extra}`, x + 2, cy);
  }
}

export function VariableView() {
  const { t } = useTranslation();
  const ds = useData((s) => s.dataset);
  const revision = useData((s) => s.revision);
  const updateVariable = useData((s) => s.updateVariable);
  const openModal = useUi((s) => s.openModal);
  const toast = useUi((s) => s.toast);
  const dec = useSettings((s) => s.decimalSeparator);
  const allCols = useSettings((s) => s.variableViewAllColumns);
  const m = useGridTheme();
  const ref = useRef<DataEditorRef>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<GridSelection>({ columns: CompactSelection.empty(), rows: CompactSelection.empty() });
  const [menu, setMenu] = useState<{ items: MenuEntry[]; x: number; y: number } | null>(null);

  const vars = useMemo(() => ds?.variables ?? [], [ds?.variables]);
  const nVars = vars.length;
  const totalRows = Math.max(nVars + 30, 60);
  const COLS = useMemo(() => ALL_COLS.filter((c) => allCols || c.essential), [allCols]);

  const columns = useMemo<GridColumn[]>(() => COLS.map((c) => ({ id: c.id, title: t(c.id === 'check' ? 'varView.col.check' : `variables.col.${c.id}`), width: Math.round(c.w * m.zoom) })), [COLS, t, m.zoom]);

  // data-quality counts per variable (only shown with all columns)
  const quality = useMemo(() => (allCols && ds ? ds.variables.map((v, i) => columnQuality(v, ds.columns[i] ?? [], 0, 0).total) : []), [allCols, ds]);

  const selectedRows = useCallback(
    (sel: GridSelection = selection) => {
      const rows = new Set<number>(sel.rows.toArray());
      if (!rows.size && sel.current) for (let r = sel.current.range.y; r < sel.current.range.y + sel.current.range.height; r++) rows.add(r);
      return [...rows].filter((r) => r < nVars).sort((a, b) => a - b);
    },
    [selection, nVars],
  );

  // follow the active variable (e.g. chosen in the Data View or the palette)
  useEffect(() => {
    const i = useActiveVariable.getState().index;
    if (i !== null && i < nVars) {
      setSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: { cell: [0, i], range: { x: 0, y: i, width: 1, height: 1 }, rangeStack: [] } });
      setTimeout(() => ref.current?.scrollTo(0, i, 'vertical', 0, 0, { vAlign: 'center' }), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const id = COLS[col].id;
      const v = vars[row];
      if (!v) return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: id === 'name', readonly: id !== 'name' };
      const text = (data: string, display = data, editable = true): GridCell => ({ kind: GridCellKind.Text, data, displayData: display, allowOverlay: editable, readonly: !editable });
      const fixed = (display: string): GridCell => ({ kind: GridCellKind.Text, data: display, displayData: display, allowOverlay: false, readonly: true, cursor: 'pointer' });
      switch (id) {
        case 'name':
          return { ...text(v.name), copyData: v.name } as GridCell;
        case 'label':
          return text(v.label);
        case 'measure':
          return fixed(t(`measure.${v.type === 'string' && v.measure === 'scale' ? 'nominal' : v.measure}`));
        case 'type':
          return fixed(`${typeLabel(v, t)} ${formatSpec(v.print)}`);
        case 'width':
          return { ...text(String(v.type === 'string' ? v.width : v.print.w)), contentAlign: 'right' } as GridCell;
        case 'decimals':
          return { ...text(String(v.print.d), String(v.print.d), v.type === 'numeric'), contentAlign: 'right' } as GridCell;
        case 'values':
          return fixed(valueLabelsSummary(v, t));
        case 'missing':
          return fixed(missingSummary(v, t));
        case 'columns':
          return { ...text(String(v.columns)), contentAlign: 'right' } as GridCell;
        case 'align':
          return fixed(t(`align.${v.align}`));
        case 'role':
          return fixed(t(`role.${v.role}`));
        case 'check': {
          const n = quality[row] ?? 0;
          return { ...fixed(n ? t('varView.flagged', { count: n }) : ''), contentAlign: 'right' } as GridCell;
        }
      }
    },
    [COLS, vars, t, quality],
  );

  const createUpTo = (row: number, name?: string) => {
    const d = useData.getState();
    if (!d.dataset) return;
    d.apply((ds0) => {
      const variables = ds0.variables.slice();
      const columns = ds0.columns.slice();
      const n = Math.max(0, ...ds0.columns.map((c) => c.length));
      while (variables.length <= row) {
        const isLast = variables.length === row;
        const nm = isLast && name ? name : nextVarName(variables.map((x) => x.name));
        const def = useSettings.getState().defaultDecimals;
        variables.push(makeVariable(nm, { print: { type: 'F', w: Math.max(8, def + 2), d: def }, write: { type: 'F', w: Math.max(8, def + 2), d: def } }));
        columns.push(new Array(n).fill(null));
      }
      return { ...ds0, variables, columns };
    }, t('undo.insertVariable'));
  };

  const nameError = useCallback(
    (text: string, row: number): string | null => {
      if (!isValidVarName(text)) return t('varView.nameRule');
      if (vars.some((x, i) => i !== row && x.name.toUpperCase() === text.toUpperCase())) return t('varView.nameTaken', { name: text });
      return null;
    },
    [vars, t],
  );

  const onCellEdited = useCallback(
    ([col, row]: Item, val: EditableGridCell) => {
      if (val.kind !== GridCellKind.Text) return;
      const id = COLS[col].id;
      const text = val.data.trim();
      const v = vars[row];
      if (!v) {
        if (id === 'name' && text) {
          const err = nameError(text, row);
          if (err) return void toast(err, { kind: 'error' });
          createUpTo(row, text);
        }
        return;
      }
      const int = (s: string, min: number, max: number) => {
        const n = Number(s);
        return Number.isInteger(n) && n >= min && n <= max ? n : null;
      };
      const L = (prop: string) => t('undo.varProp', { name: v.name, prop: t(`variables.col.${prop}`) });
      switch (id) {
        case 'name': {
          if (text === v.name) return;
          const err = nameError(text, row);
          if (err) return void toast(err, { kind: 'error' });
          updateVariable(row, { name: text }, t('undo.rename', { from: v.name, to: text }));
          return;
        }
        case 'label':
          if (val.data !== v.label) updateVariable(row, { label: val.data }, L('label'));
          return;
        case 'width': {
          const n = int(text, 1, v.type === 'string' ? 32767 : 40);
          if (n === null) return void toast(t('variables.invalidNumber'), { kind: 'error' });
          if (v.type === 'string') useData.getState().setVariableType(row, 'string', { type: 'A', w: n, d: 0 }, L('width'));
          else updateVariable(row, { print: { ...v.print, w: n, d: Math.min(v.print.d, Math.max(0, n - 1)) }, write: { ...v.write, w: n, d: Math.min(v.write.d, Math.max(0, n - 1)) } }, L('width'));
          return;
        }
        case 'decimals': {
          const n = int(text, 0, 16);
          if (n === null) return void toast(t('variables.invalidNumber'), { kind: 'error' });
          const w = Math.max(v.print.w, n + 2);
          updateVariable(row, { print: { ...v.print, d: n, w }, write: { ...v.write, d: n, w } }, L('decimals'));
          return;
        }
        case 'columns': {
          const n = int(text, 1, 255);
          if (n === null) return void toast(t('variables.invalidNumber'), { kind: 'error' });
          updateVariable(row, { columns: n }, L('columns'));
          return;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [COLS, vars, updateVariable, toast, t, nameError],
  );

  /** Applies PATCH to every variable in ROWS as one undo step. */
  const bulk = useCallback(
    (rows: number[], patch: (v: Variable) => Partial<Variable>, label: string) => {
      const set = new Set(rows);
      useData.getState().apply((d) => ({ ...d, variables: d.variables.map((v, i) => (set.has(i) ? { ...v, ...patch(v) } : v)) }), label);
    },
    [],
  );
  const namesOf = (rows: number[]) => {
    const n = rows.map((r) => vars[r]?.name).filter(Boolean);
    return n.length > 3 ? `${n.slice(0, 3).join(', ')} +${n.length - 3}` : n.join(', ');
  };

  const choiceItems = (id: ColId, rows: number[]): MenuEntry[] => {
    const vs = rows.map((r) => vars[r]).filter(Boolean);
    const names = namesOf(rows);
    if (id === 'align')
      return ALIGNS.map((a) => ({ type: 'item', id: a, label: t(`align.${a}`), icon: ALIGN_ICON[a], checked: vs.every((v) => v.align === a), onSelect: () => bulk(rows, () => ({ align: a }), t('undo.setAlign', { names, value: t(`align.${a}`) })) }));
    if (id === 'role')
      return ROLES.map((r) => ({ type: 'item', id: r, label: t(`role.${r}`), checked: vs.every((v) => v.role === r), onSelect: () => bulk(rows, () => ({ role: r }), t('undo.setRole', { names, value: t(`role.${r}`) })) }));
    return MEASURES.map((ms) => ({
      type: 'item',
      id: ms,
      label: t(`measure.${ms}`),
      icon: MEASURE_ICON[ms],
      checked: vs.every((v) => v.measure === ms),
      disabled: ms === 'scale' && vs.every((v) => v.type === 'string'),
      onSelect: () => bulk(rows, (v) => (ms === 'scale' && v.type === 'string' ? {} : { measure: ms }), t('undo.setMeasure', { names, measure: t(`measure.${ms}`) })),
    }));
  };

  const rowsFor = (row: number) => {
    const sel = selectedRows();
    return sel.includes(row) ? sel : [row];
  };

  const activate = (col: number, row: number, bounds?: { x: number; y: number; height: number }) => {
    const id = COLS[col]?.id;
    if (!id || row >= nVars) return;
    if (id === 'type') openModal({ kind: 'varType', index: row });
    else if (id === 'values') openModal({ kind: 'valueLabels', index: row });
    else if (id === 'missing') openModal({ kind: 'missing', index: row });
    else if (CHOICE.includes(id)) {
      const b = bounds ?? ref.current?.getBounds(col, row);
      if (b) setMenu({ items: choiceItems(id, rowsFor(row)), x: b.x, y: b.y + b.height });
    }
  };

  const copyPropsFrom = (src: number, rows: number[]) => {
    const s = vars[src];
    if (!s) return;
    const targets = rows.filter((r) => r !== src && vars[r]?.type === s.type);
    if (!targets.length) return void toast(t('varView.copyNoTargets'), { kind: 'info' });
    bulk(targets, () => ({ valueLabels: s.valueLabels.map((l) => ({ ...l })), missing: { values: [...s.missing.values], range: s.missing.range && { ...s.missing.range } }, measure: s.measure }), t('undo.copyProps', { from: s.name, names: namesOf(targets) }));
    toast(t('varView.copied', { from: s.name, count: targets.length }), { action: { label: t('actions.undo'), run: () => useData.getState().undo() } });
  };

  const rowMenu = (row: number, x: number, y: number) => {
    const rows = rowsFor(row);
    const many = rows.length > 1;
    const names = rows.map((r) => vars[r].name);
    setMenu({
      x,
      y,
      items: [
        { type: 'header', label: many ? t('dataView.nVariables', { count: rows.length }) : vars[row].name },
        { type: 'submenu', id: 'ms', label: t('dataView.measure'), icon: variableIcon(vars[row]), items: choiceItems('measure', rows) },
        { type: 'submenu', id: 'rl', label: t('variables.col.role'), icon: 'badge', items: choiceItems('role', rows) },
        ...(many
          ? ([{ type: 'item', id: 'cp', label: t('varView.copyProps', { name: vars[rows[0]].name }), icon: 'content_copy', onSelect: () => copyPropsFrom(rows[0], rows) }] as MenuEntry[])
          : ([
              { type: 'item', id: 'vl', label: t('variables.editValueLabels'), icon: 'sell', onSelect: () => openModal({ kind: 'valueLabels', index: row }) },
              { type: 'item', id: 'mi', label: t('variables.editMissing'), icon: 'block', onSelect: () => openModal({ kind: 'missing', index: row }) },
              { type: 'item', id: 'ty', label: t('variables.editType'), icon: 'data_object', onSelect: () => openModal({ kind: 'varType', index: row }) },
            ] as MenuEntry[])),
        { type: 'item', id: 'insp', label: t('dataView.inspect'), icon: 'right_panel_open', onSelect: () => inspectVariable(row) },
        { type: 'sep' },
        { type: 'item', id: 'freq', label: t('dataView.frequencies'), icon: 'bar_chart', onSelect: () => quickAnalysis('frequencies', names) },
        { type: 'item', id: 'desc', label: t('dataView.descriptives'), icon: 'functions', onSelect: () => quickAnalysis('descriptives', names.filter((_, i) => vars[rows[i]].type !== 'string')) },
        { type: 'sep' },
        { type: 'item', id: 'ib', label: t('variables.insertAbove'), icon: 'add', onSelect: () => useData.getState().insertVariable(row, {}, t('undo.insertVariable')) },
        { type: 'item', id: 'ia', label: t('variables.insertBelow'), icon: 'add', onSelect: () => useData.getState().insertVariable(row + 1, {}, t('undo.insertVariable')) },
        { type: 'item', id: 'del', label: many ? t('dataView.deleteVariables', { count: rows.length }) : t('data.deleteVariable'), icon: 'delete', danger: true, onSelect: () => deleteRows(rows) },
      ],
    });
  };

  const deleteRows = (rows: number[]) => {
    if (!rows.length) return;
    const names = namesOf(rows);
    useData.getState().deleteVariables(rows, t('undo.deleteVariables', { count: rows.length, names }));
    setSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty() });
    toast(t('dataView.variablesDeleted', { count: rows.length, names }), { action: { label: t('actions.undo'), run: () => useData.getState().undo() } });
  };

  const gotoVariable = useCallback((i: number) => {
    setSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: { cell: [0, i], range: { x: 0, y: i, width: 1, height: 1 }, rangeStack: [] } });
    ref.current?.scrollTo(0, i, 'vertical', 0, 0, { vAlign: 'center' });
    ref.current?.focus();
  }, []);

  const selRef = useRef(selection);
  selRef.current = selection;
  useEffect(
    () =>
      registerGrid({
        copy: () => void ref.current?.emit('copy'),
        cut: () => void ref.current?.emit('copy'),
        paste: () => void ref.current?.emit('paste'),
        clear: () => {},
        insertCase: () => {
          const d = useData.getState().dataset;
          if (d) useData.getState().insertCases(Math.max(0, ...d.columns.map((c) => c.length)), 1, t('undo.insertCase', { row: Math.max(0, ...d.columns.map((c) => c.length)) + 1 }));
        },
        insertVariable: () => void useData.getState().insertVariable(Math.min(selRef.current.current?.cell[1] ?? nVars, nVars), {}, t('undo.insertVariable')),
        deleteCases: () => {},
        deleteVariables: () => deleteRows(selectedRows(selRef.current)),
        gotoCase: () => {},
        gotoVariable,
        focus: () => ref.current?.focus(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nVars, gotoVariable, selectedRows, t],
  );

  useEffect(() => {
    wrapRef.current?.querySelector('[role="grid"]')?.setAttribute('aria-label', t('varView.gridLabel'));
  });

  // ---- command bar: column set toggle + bulk measurement level ----
  const selRows = selectedRows();
  const slot = useMemo(
    () => (
      <ToolbarGroup>
        <FilterChip selected={allCols} icon="view_column" onToggle={(b) => useSettings.getState().set({ variableViewAllColumns: b })}>
          {t('varView.allColumns')}
        </FilterChip>
        <MenuButton
          size="sm"
          icon="category"
          label={selRows.length > 1 ? t('varView.setMeasureN', { count: selRows.length }) : t('varView.setMeasure')}
          disabled={!selRows.length}
          items={selRows.length ? choiceItems('measure', selRows) : []}
        />
      </ToolbarGroup>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allCols, selRows.join(','), t, revision],
  );
  useCommandBarSlot('variables', slot);

  // ---- canvas drawing for rich cells ----
  const monoFamily = useMemo(() => {
    void m.key;
    try {
      return getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace';
    } catch {
      return 'monospace';
    }
  }, [m.key]);
  const drawCell = useCallback<DrawCellCallback>(
    (args, draw) => {
      const { cell, rect, ctx, col, row, theme } = args;
      const id = COLS[col]?.id;
      const v = vars[row];
      if (!v || !id || cell.kind !== GridCellKind.Text) return draw();
      const pal = m.palette;
      const z = m.zoom;
      const pad = theme.cellHorizontalPadding;
      const font = `${theme.baseFontStyle} ${theme.fontFamily}`;
      const small = `${Math.round(12 * z)}px ${theme.fontFamily}`;
      const cy = rect.y + rect.height / 2 + 0.5;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const chevron = () => drawIcon(ctx, 'expand_more', rect.x + rect.width - pad - Math.round(16 * z) + 2, cy, Math.round(16 * z), pal.ink3);
      switch (id) {
        case 'name': {
          const s = Math.round(16 * z);
          drawIcon(ctx, variableIcon(v), rect.x + pad - 2, cy, s, pal.measure[measureKey(v)]);
          ctx.font = `500 ${theme.baseFontStyle} ${theme.fontFamily}`;
          ctx.fillStyle = pal.ink;
          ctx.fillText(fitText(ctx, v.name, rect.width - 2 * pad - s - 4), rect.x + pad + s + 4, cy);
          return;
        }
        case 'measure': {
          const s = Math.round(16 * z);
          const mk = measureKey(v);
          drawIcon(ctx, v.type === 'string' ? 'text_fields' : MEASURE_ICON[v.measure], rect.x + pad - 2, cy, s, pal.measure[mk]);
          ctx.font = font;
          ctx.fillStyle = pal.ink;
          ctx.fillText(fitText(ctx, cell.displayData, rect.width - 2 * pad - 2 * s - 4), rect.x + pad + s + 4, cy);
          chevron();
          return;
        }
        case 'align':
        case 'role': {
          ctx.font = font;
          ctx.fillStyle = pal.ink;
          ctx.fillText(fitText(ctx, cell.displayData, rect.width - 2 * pad - 18 * z), rect.x + pad, cy);
          chevron();
          return;
        }
        case 'type': {
          ctx.font = font;
          ctx.fillStyle = pal.ink;
          const tl = typeLabel(v, t);
          ctx.fillText(fitText(ctx, tl, rect.width - 2 * pad), rect.x + pad, cy);
          const tw = textWidth(ctx, tl);
          ctx.font = `${Math.round(11.5 * z)}px ${monoFamily}`;
          ctx.fillStyle = pal.ink3;
          ctx.fillText(fitText(ctx, formatSpec(v.print), rect.width - 2 * pad - tw - 8), rect.x + pad + tw + 8, cy);
          return;
        }
        case 'values': {
          if (!v.valueLabels.length) {
            ctx.font = font;
            ctx.fillStyle = pal.ink3;
            ctx.fillText(t('varView.addLabels'), rect.x + pad, cy);
            return;
          }
          const chips = v.valueLabels.slice(0, 6).map((l) => ({ code: labelValueText(l.value, v, { decimalSeparator: dec }), label: l.label }));
          drawChips(ctx, chips, Math.max(0, v.valueLabels.length - 6), rect.x + pad - 2, rect.y, rect.width - 2 * pad + 2, rect.height, pal, small, z);
          return;
        }
        case 'missing': {
          const chips: Chip[] = [];
          if (v.missing.range) {
            const lo = v.missing.range.low === -Infinity ? t('varView.lowest') : labelValueText(v.missing.range.low, v, { decimalSeparator: dec });
            const hi = v.missing.range.high === Infinity ? t('varView.highest') : labelValueText(v.missing.range.high, v, { decimalSeparator: dec });
            chips.push({ code: `${lo}–${hi}`, label: '' });
          }
          for (const x of v.missing.values) chips.push({ code: labelValueText(x, v, { decimalSeparator: dec }), label: valueLabelFor(x, v) ?? '' });
          if (!chips.length) {
            ctx.font = font;
            ctx.fillStyle = pal.ink3;
            ctx.fillText(t('variables.none'), rect.x + pad, cy);
            return;
          }
          drawChips(ctx, chips, 0, rect.x + pad - 2, rect.y, rect.width - 2 * pad + 2, rect.height, pal, small, z);
          return;
        }
        case 'check': {
          if (!cell.displayData) return;
          ctx.font = small;
          ctx.fillStyle = pal.warning;
          const w = textWidth(ctx, cell.displayData);
          ctx.fillText(cell.displayData, rect.x + rect.width - pad - w, cy);
          return;
        }
      }
      draw();
    },
    [COLS, vars, m.palette, m.zoom, t, dec, monoFamily],
  );

  if (!ds) {
    return (
      <div className="view-empty data-empty">
        <EmptyState
          icon="view_list"
          title={t('data.noDataTitle')}
          description={t('data.noDataText')}
          actions={
            <Button variant="primary" iconStart="add" onClick={newDataset}>
              {t('actions.newData')}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div
      className="grid-wrap var-grid"
      ref={wrapRef}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const cur = selection.current;
        if (!cur) return;
        const [c, r] = cur.cell;
        if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
          e.preventDefault();
          const b = ref.current?.getBounds(c, r);
          if (b && r < nVars) rowMenu(r, b.x + 8, b.y + b.height);
        } else if ((e.key === ' ' || e.key === 'Enter') && r < nVars && (CHOICE.includes(COLS[c]?.id) || DIALOG.includes(COLS[c]?.id))) {
          e.preventDefault();
          activate(c, r);
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
        onCellEdited={onCellEdited}
        validateCell={([col, row], v) => {
          if (COLS[col]?.id !== 'name' || v.kind !== GridCellKind.Text) return true;
          const text = v.data.trim();
          if (!text && row >= nVars) return true;
          return nameError(text, row) === null;
        }}
        getCellsForSelection
        rowMarkers={{ kind: 'clickable-number', width: Math.round(48 * m.zoom) }}
        onRowMoved={(from, to) => {
          if (from < nVars && to < nVars && from !== to) useData.getState().moveVariable(from, to, t('undo.moveVariable', { name: vars[from].name }));
        }}
        theme={m.theme}
        rowHeight={m.rowHeight + Math.round(2 * m.zoom)}
        headerHeight={Math.round(m.headerHeight * 0.78)}
        gridSelection={selection}
        onGridSelectionChange={(sel) => {
          setSelection(sel);
          const rows = selectedRows(sel);
          const r = sel.current?.cell[1] ?? rows[0];
          if (r !== undefined && r < nVars) useActiveVariable.getState().setActive(r, rows.includes(r) ? rows : [r]);
        }}
        cellActivationBehavior="second-click"
        onCellActivated={([c, r]) => activate(c, r)}
        onCellClicked={([c, r], e) => {
          const id = COLS[c]?.id;
          if (CHOICE.includes(id) && r < nVars) activate(c, r, e.bounds);
        }}
        onCellContextMenu={([, row], e) => {
          e.preventDefault();
          if (row >= nVars) return;
          rowMenu(row, e.bounds.x + e.localEventX, e.bounds.y + e.localEventY);
        }}
        drawCell={drawCell}
        keybindings={{ search: false }}
        scaleToRem={false}
        rowSelect="multi"
        rangeSelect="multi-rect"
      />
      {menu && <Menu items={menu.items} anchor={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />}
    </div>
  );
}
