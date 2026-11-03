/*
 * Variable View: dictionary editor (one row per variable).
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
  type GridSelection,
  type Item,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import type { Align, Measure, Role, Variable } from '../../engine/types';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { isValidVarName, nextVarName } from '../../lib/variables';
import { registerGrid } from '../../app/gridBus';
import { useGridTheme } from '../grid/gridTheme';
import { Menu, type MenuEntry } from '../../components/Menu';
import { Icon } from '../../components/Icon';
import { missingSummary, typeLabel, valueLabelsSummary } from './describe';
import { variableIcon } from '../../app/varIcons';
import { newDataset } from '../../app/files';

type ColId = 'name' | 'type' | 'width' | 'decimals' | 'label' | 'values' | 'missing' | 'columns' | 'align' | 'measure' | 'role';
const COLS: { id: ColId; w: number }[] = [
  { id: 'name', w: 140 },
  { id: 'type', w: 110 },
  { id: 'width', w: 72 },
  { id: 'decimals', w: 124 },
  { id: 'label', w: 240 },
  { id: 'values', w: 180 },
  { id: 'missing', w: 120 },
  { id: 'columns', w: 84 },
  { id: 'align', w: 96 },
  { id: 'measure', w: 112 },
  { id: 'role', w: 100 },
];

const ALIGNS: Align[] = ['left', 'right', 'center'];
const MEASURES: Measure[] = ['nominal', 'ordinal', 'scale'];
const ROLES: Role[] = ['input', 'target', 'both', 'none', 'partition', 'split'];
const MEASURE_ICON: Record<string, string> = { nominal: 'category', ordinal: 'signal_cellular_alt', scale: 'straighten', unknown: 'help' };
const ALIGN_ICON: Record<string, string> = { left: 'format_align_left', right: 'format_align_right', center: 'format_align_center' };

export function VariableView() {
  const { t } = useTranslation();
  const ds = useData((s) => s.dataset);
  const updateVariable = useData((s) => s.updateVariable);
  const openModal = useUi((s) => s.openModal);
  const toast = useUi((s) => s.toast);
  const selected = useUi((s) => s.selected);
  const m = useGridTheme();
  const ref = useRef<DataEditorRef>(null);
  const [selection, setSelection] = useState<GridSelection>({ columns: CompactSelection.empty(), rows: CompactSelection.empty() });
  const [menu, setMenu] = useState<{ items: MenuEntry[]; x: number; y: number } | null>(null);

  const vars = ds?.variables ?? [];
  const nVars = vars.length;
  const totalRows = Math.max(nVars + 30, 60);

  const columns = useMemo<GridColumn[]>(
    () => COLS.map((c) => ({ id: c.id, title: t(`variables.col.${c.id}`), width: Math.round(c.w * m.zoom) })),
    [t, m.zoom],
  );

  // jump to the variable selected in the data view
  useEffect(() => {
    if (selected && selected.col === 0 && selected.row < nVars) {
      setSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: { cell: [0, selected.row], range: { x: 0, y: selected.row, width: 1, height: 1 }, rangeStack: [] } });
      ref.current?.scrollTo(0, selected.row);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const id = COLS[col].id;
      const v = vars[row];
      if (!v) {
        return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: id === 'name', readonly: id !== 'name' };
      }
      const text = (data: string, display = data, editable = true): GridCell => ({ kind: GridCellKind.Text, data, displayData: display, allowOverlay: editable, readonly: !editable });
      const choice = (display: string): GridCell => ({ kind: GridCellKind.Text, data: display, displayData: `${display}  ▾`, allowOverlay: false, readonly: true, cursor: 'pointer' });
      const dialog = (display: string): GridCell => ({ kind: GridCellKind.Text, data: display, displayData: `${display}  …`, allowOverlay: false, readonly: true, cursor: 'pointer' });
      switch (id) {
        case 'name':
          return text(v.name);
        case 'type':
          return dialog(typeLabel(v, t));
        case 'width':
          return { ...text(String(v.type === 'string' ? v.width : v.print.w)), contentAlign: 'right' } as GridCell;
        case 'decimals':
          return { ...text(String(v.print.d), String(v.print.d), v.type === 'numeric'), contentAlign: 'right' } as GridCell;
        case 'label':
          return text(v.label);
        case 'values':
          return dialog(valueLabelsSummary(v, t));
        case 'missing':
          return dialog(missingSummary(v, t));
        case 'columns':
          return { ...text(String(v.columns)), contentAlign: 'right' } as GridCell;
        case 'align':
          return choice(t(`align.${v.align}`));
        case 'measure':
          return choice(t(`measure.${v.measure}`));
        case 'role':
          return choice(t(`role.${v.role}`));
      }
    },
    [vars, t],
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
        variables.push({ ...emptyVar(nm) });
        columns.push(new Array(n).fill(null));
      }
      return { ...ds0, variables, columns };
    });
  };

  const onCellEdited = useCallback(
    ([col, row]: Item, val: EditableGridCell) => {
      if (val.kind !== GridCellKind.Text) return;
      const id = COLS[col].id;
      const text = val.data.trim();
      const v = vars[row];
      if (!v) {
        if (id === 'name' && text) {
          if (!isValidVarName(text) || vars.some((x) => x.name.toUpperCase() === text.toUpperCase())) {
            toast(t('variables.invalidName', { name: text }), { kind: 'error' });
            return;
          }
          createUpTo(row, text);
        }
        return;
      }
      const int = (s: string, min: number, max: number) => {
        const n = Number(s);
        return Number.isInteger(n) && n >= min && n <= max ? n : null;
      };
      switch (id) {
        case 'name':
          if (text === v.name) return;
          if (!isValidVarName(text) || vars.some((x, i) => i !== row && x.name.toUpperCase() === text.toUpperCase())) {
            toast(t('variables.invalidName', { name: text }), { kind: 'error' });
            return;
          }
          updateVariable(row, { name: text });
          return;
        case 'label':
          updateVariable(row, { label: val.data });
          return;
        case 'width': {
          const n = int(text, 1, v.type === 'string' ? 32767 : 40);
          if (n === null) return void toast(t('variables.invalidNumber'), { kind: 'error' });
          if (v.type === 'string') useData.getState().setVariableType(row, 'string', { type: 'A', w: n, d: 0 });
          else updateVariable(row, { print: { ...v.print, w: n, d: Math.min(v.print.d, Math.max(0, n - 1)) }, write: { ...v.write, w: n, d: Math.min(v.write.d, Math.max(0, n - 1)) } });
          return;
        }
        case 'decimals': {
          const n = int(text, 0, 16);
          if (n === null) return void toast(t('variables.invalidNumber'), { kind: 'error' });
          const w = Math.max(v.print.w, n + 2);
          updateVariable(row, { print: { ...v.print, d: n, w }, write: { ...v.write, d: n, w } });
          return;
        }
        case 'columns': {
          const n = int(text, 1, 255);
          if (n === null) return void toast(t('variables.invalidNumber'), { kind: 'error' });
          updateVariable(row, { columns: n });
          return;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vars, updateVariable, toast, t],
  );

  const choiceMenu = (id: ColId, row: number, x: number, y: number) => {
    const v = vars[row];
    if (!v) return;
    let items: MenuEntry[] = [];
    if (id === 'align') items = ALIGNS.map((a) => ({ type: 'item', id: a, label: t(`align.${a}`), icon: ALIGN_ICON[a], checked: undefined, onSelect: () => updateVariable(row, { align: a }) }));
    if (id === 'measure')
      items = MEASURES.map((ms) => ({ type: 'item', id: ms, label: t(`measure.${ms}`), icon: MEASURE_ICON[ms], onSelect: () => updateVariable(row, { measure: ms }), disabled: ms === 'scale' && v.type === 'string' }));
    if (id === 'role') items = ROLES.map((r) => ({ type: 'item', id: r, label: t(`role.${r}`), icon: r === v.role ? 'check' : '', onSelect: () => updateVariable(row, { role: r }) }));
    setMenu({ items, x, y });
  };

  const activate = (col: number, row: number, bounds?: { x: number; y: number; height: number }) => {
    const id = COLS[col]?.id;
    if (!id || row >= nVars) return;
    if (id === 'type') openModal({ kind: 'varType', index: row });
    else if (id === 'values') openModal({ kind: 'valueLabels', index: row });
    else if (id === 'missing') openModal({ kind: 'missing', index: row });
    else if (id === 'align' || id === 'measure' || id === 'role') {
      const b = bounds ?? ref.current?.getBounds(col, row);
      if (b) choiceMenu(id, row, b.x, b.y + b.height);
    }
  };

  const selectedRows = () => {
    const rows = new Set<number>(selection.rows.toArray());
    if (!rows.size && selection.current) for (let r = selection.current.range.y; r < selection.current.range.y + selection.current.range.height; r++) rows.add(r);
    return [...rows].filter((r) => r < nVars);
  };

  useEffect(
    () =>
      registerGrid({
        copy: () => void ref.current?.emit('copy'),
        cut: () => void ref.current?.emit('copy'),
        paste: () => void ref.current?.emit('paste'),
        clear: () => {},
        insertCase: () => useData.getState().insertCases(Math.max(0, ...useData.getState().dataset!.columns.map((c) => c.length))),
        insertVariable: () => useData.getState().insertVariable(Math.min(selection.current?.cell[1] ?? nVars, nVars)),
        deleteCases: () => {},
        deleteVariables: () => {
          const rows = selectedRows();
          if (rows.length) useData.getState().deleteVariables(rows);
        },
        gotoCase: () => {},
        focus: () => ref.current?.focus(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, nVars],
  );

  if (!ds) {
    return (
      <div className="view-empty">
        <div className="empty-hint">
          <Icon name="view_list" />
          <h2>{t('data.noDataTitle')}</h2>
          <button type="button" className="btn btn-filled" onClick={newDataset}>
            <Icon name="add" />
            {t('actions.newData')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid-wrap" onContextMenu={(e) => e.preventDefault()}>
      <DataEditor
        ref={ref}
        width="100%"
        height="100%"
        columns={columns}
        rows={totalRows}
        getCellContent={getCellContent}
        onCellEdited={onCellEdited}
        getCellsForSelection
        rowMarkers={{ kind: 'clickable-number', width: Math.round(48 * m.zoom) }}
        theme={m.theme}
        rowHeight={m.rowHeight}
        headerHeight={m.headerHeight}
        gridSelection={selection}
        onGridSelectionChange={setSelection}
        cellActivationBehavior="second-click"
        onCellActivated={([c, r]) => activate(c, r)}
        onCellClicked={([c, r], e) => {
          const id = COLS[c]?.id;
          if (id === 'align' || id === 'measure' || id === 'role') activate(c, r, e.bounds);
        }}
        onCellContextMenu={([, row], e) => {
          e.preventDefault();
          if (row >= nVars) return;
          setMenu({
            x: e.bounds.x + e.localEventX,
            y: e.bounds.y + e.localEventY,
            items: [
              { type: 'item', id: 'ib', label: t('variables.insertAbove'), icon: 'add', onSelect: () => useData.getState().insertVariable(row) },
              { type: 'item', id: 'ia', label: t('variables.insertBelow'), icon: 'add', onSelect: () => useData.getState().insertVariable(row + 1) },
              { type: 'item', id: 'del', label: t('data.deleteVariable'), icon: 'delete', onSelect: () => useData.getState().deleteVariables(selectedRows().includes(row) ? selectedRows() : [row]) },
              { type: 'sep' },
              { type: 'item', id: 'vl', label: t('variables.editValueLabels'), icon: 'label', onSelect: () => openModal({ kind: 'valueLabels', index: row }) },
              { type: 'item', id: 'ms', label: t('variables.editMissing'), icon: 'block', onSelect: () => openModal({ kind: 'missing', index: row }) },
              { type: 'item', id: 'ty', label: t('variables.editType'), icon: 'data_object', onSelect: () => openModal({ kind: 'varType', index: row }) },
            ],
          });
        }}
        keybindings={{ search: false }}
        scaleToRem={false}
        rowSelect="multi"
        drawCell={(args, draw) => {
          const { cell, rect, ctx, col, row } = args;
          if (COLS[col]?.id === 'name' && row < nVars && cell.kind === GridCellKind.Text && iconFontReady()) {
            // draw a small measure icon glyph before the name using the icon font
            draw();
            const v = vars[row];
            ctx.save();
            ctx.font = `${Math.round(16 * m.zoom)}px 'Material Symbols Rounded'`;
            ctx.fillStyle = m.muted;
            ctx.textBaseline = 'middle';
            ctx.fillText(variableIcon(v), rect.x + rect.width - Math.round(22 * m.zoom), rect.y + rect.height / 2);
            ctx.restore();
            return;
          }
          draw();
        }}
      />
      {menu && <Menu items={menu.items} anchor={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />}
    </div>
  );
}

function iconFontReady(): boolean {
  try {
    return document.fonts.check("16px 'Material Symbols Rounded'");
  } catch {
    return false;
  }
}

function emptyVar(name: string): Variable {
  return {
    name,
    label: '',
    type: 'numeric',
    width: 0,
    print: { type: 'F', w: 8, d: 2 },
    write: { type: 'F', w: 8, d: 2 },
    valueLabels: [],
    missing: { values: [] },
    columns: 8,
    align: 'right',
    measure: 'scale',
    role: 'input',
  };
}
