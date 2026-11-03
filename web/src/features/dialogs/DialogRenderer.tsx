/*
 * Generic renderer for declarative analysis dialogs.
 *
 * Data-aware (measurement icons, suitability sorting, soft warnings with one-click fixes, group
 * values picked from value labels), keyboard-operable (Ctrl+Enter runs, Ctrl+Shift+Enter pastes,
 * arrow keys / Enter / Delete / Ctrl+1–3 in the variable lists), remembers its values per dataset
 * and records its source so a result can be edited and re-run.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { Tabs } from '../../components/Tabs';
import { MeasureIcon } from '../../components/Chip';
import type { Variable } from '../../engine/types';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { useDialogMemory } from '../../store/dialogs';
import { pasteSyntax, runSyntaxDetailed } from '../../app/engine';
import { manualUrl } from '../../app/help';
import { formatShortcut } from '../../app/actions';
import {
  defaultValues,
  fieldLabels,
  validateDetailed,
  walkFields,
  type DialogContext,
  type DialogSpec,
  type Field,
  type GroupValuesField,
  type Hint,
  type RowsField,
  type Values,
  type VarFilter,
  type VarListField,
} from './types';
import { displayMeasure, distinctCount, distinctValues, measureHints, suits } from './dialogData';
import { FUNCTIONS_BY_GROUP } from './expressionHelp';
import './dialogs.css';

function matchesFilter(v: Variable, f?: VarFilter) {
  if (!f || f === 'any') return true;
  return v.type === f;
}

/** Translates a label key; plain words (without a dot) are shown as-is. */
function useLabel() {
  const { t } = useTranslation();
  return (key: string | undefined, args?: Record<string, unknown>) => (key ? (key.includes('.') && !key.includes(' ') ? t(key, args) : key) : '');
}

const OPERATORS = ['+', '-', '*', '/', '**', '(', ')', '=', '<>', '<', '>', '<=', '>=', 'AND', 'OR', 'NOT'];
const MAIN_TAB = '__main';

function datasetKey(): string {
  const d = useData.getState();
  return d.title || d.dataset?.name || '';
}

/** Initial values: preset (Edit / assistant / grid selection) wins; otherwise the remembered values. */
function initialValues(spec: DialogSpec, variables: Variable[], preset?: Record<string, unknown>): Values {
  const base = defaultValues(spec);
  const prev = preset ? undefined : useDialogMemory.getState().get(datasetKey(), spec.id);
  const merged: Values = { ...base, ...(prev ?? {}), ...(preset ?? {}) };
  const names = new Set(variables.map((v) => v.name));
  walkFields(spec.fields, (f) => {
    if (f.kind === 'varlist') merged[f.id] = ((merged[f.id] as string[]) ?? []).filter((n) => names.has(n));
  });
  return merged;
}

const sameValues = (a: Values, b: Values) => JSON.stringify(a) === JSON.stringify(b);

export function AnalysisDialog({
  spec,
  preset,
  replaceEntryId,
}: {
  spec: DialogSpec;
  /** Field id → initial value (e.g. variables selected in the grid, or a result's values for Edit). */
  preset?: Record<string, unknown>;
  /** Output entry that the run replaces (Edit / Re-run). */
  replaceEntryId?: string;
}) {
  const { t } = useTranslation();
  const L = useLabel();
  const dataset = useData((s) => s.dataset);
  const closeModal = useUi((s) => s.closeModal);
  const toast = useUi((s) => s.toast);
  const listShows = useSettings((s) => s.listShows);
  const showPreview = useSettings((s) => s.showSyntaxPreview);
  const setSettings = useSettings((s) => s.set);
  const variables = useMemo(() => dataset?.variables ?? [], [dataset]);
  const ctx: DialogContext = useMemo(
    () => ({
      variables,
      column: (name: string) => {
        const i = variables.findIndex((v) => v.name === name);
        return i >= 0 ? dataset?.columns[i] : undefined;
      },
    }),
    [variables, dataset],
  );
  const [values, setValues] = useState<Values>(() => initialValues(spec, variables, preset));
  const [selectedSource, setSelectedSource] = useState<string[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<{ list: string; names: string[] } | null>(null);
  const [activeList, setActiveList] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState(MAIN_TAB);
  const [error, setError] = useState<{ key: string; field?: string } | null>(null);
  const lastExpr = useRef<{ id: string; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const anchor = useRef<number>(-1);
  const typeAhead = useRef<{ text: string; time: number }>({ text: '', time: 0 });
  const sourceRef = useRef<HTMLUListElement>(null);
  const labels = useMemo(() => fieldLabels(spec), [spec]);
  const isTransform = spec.kind === 'transform' || spec.kind === 'data';

  const set = (patch: Values) => {
    setError(null);
    setValues((v) => ({ ...v, ...patch }));
  };

  const varLists: VarListField[] = [];
  walkFields(spec.fields, (f) => {
    if (f.kind === 'varlist' && (!f.when || f.when(values))) varLists.push(f);
  });
  const used = new Set(varLists.flatMap((f) => (values[f.id] as string[]) ?? []));
  const hasVarlists = varLists.length > 0;
  const needsSource = hasVarlists || spec.fields.some(function has(f: Field): boolean {
    return (f.kind === 'text' && !!f.expression) || ((f.kind === 'group' || f.kind === 'subdialog') && f.fields.some(has));
  });
  const hasExpression = spec.fields.some(function has(f: Field): boolean {
    return (f.kind === 'text' && !!f.expression) || ((f.kind === 'group' || f.kind === 'subdialog') && f.fields.some(has));
  });

  // the list new variables go to: the selected/focused one, else the first that still has room
  const firstOpen = varLists.find((f) => !f.max || ((values[f.id] as string[]) ?? []).length < f.max);
  const active = varLists.find((f) => f.id === activeList) ?? firstOpen ?? varLists[0];

  const distinct = useMemo(() => {
    const m = new Map<string, number>();
    if (varLists.some((f) => f.groups)) variables.forEach((v, i) => m.set(v.name, distinctCount(v, dataset?.columns[i])));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variables, dataset, varLists.some((f) => f.groups)]);

  const q = filter.trim().toLowerCase();
  const source = variables
    .filter((v) => matchesFilter(v, spec.source) && !used.has(v.name) && (!q || v.name.toLowerCase().includes(q) || v.label.toLowerCase().includes(q)))
    .map((v, i) => ({ v, i, ok: suits(active, v) && matchesFilter(v, active?.filter) }))
    .sort((a, b) => (a.ok === b.ok ? a.i - b.i : a.ok ? -1 : 1))
    .map((x) => x.v);
  const suitable = new Set(source.filter((v) => suits(active, v) && matchesFilter(v, active?.filter)).map((v) => v.name));

  const canAccept = (f: VarListField, names: string[]) =>
    names.filter((n) => {
      const v = variables.find((x) => x.name === n);
      return v && matchesFilter(v, f.filter) && (!f.measures || f.measures.includes(v.measure));
    });

  const moveTo = (f: VarListField, names: string[]) => {
    const ok = canAccept(f, names);
    if (!ok.length) return;
    const cur = (values[f.id] as string[]) ?? [];
    const removedElsewhere: Values = {};
    for (const other of varLists) {
      if (other.id === f.id) continue;
      const list = (values[other.id] as string[]) ?? [];
      if (list.some((n) => ok.includes(n))) removedElsewhere[other.id] = list.filter((n) => !ok.includes(n));
    }
    let next = f.max === 1 ? [ok[0]] : [...cur, ...ok.filter((n) => !cur.includes(n))];
    if (f.max && f.max > 1) next = next.slice(0, f.max);
    set({ ...removedElsewhere, [f.id]: next });
    // keep a sensible selection in the source list for fast keyboard work
    const idx = source.findIndex((v) => v.name === names[names.length - 1]);
    const rest = source.filter((v) => !ok.includes(v.name));
    const nextSel = rest[Math.min(Math.max(0, idx), rest.length - 1)];
    setSelectedSource(nextSel ? [nextSel.name] : []);
    if (f.max && next.length >= f.max) setActiveList(null);
  };

  const removeFrom = (f: VarListField, names: string[]) => {
    set({ [f.id]: ((values[f.id] as string[]) ?? []).filter((n) => !names.includes(n)) });
    setSelectedTarget(null);
  };

  const firstAccepting = (names: string[]) => {
    const fits = (f: VarListField) => {
      const cur = (values[f.id] as string[]) ?? [];
      return canAccept(f, names).length > 0 && (!f.max || cur.length < f.max);
    };
    const v = variables.find((x) => x.name === names[0]);
    if (activeList) {
      const a = varLists.find((f) => f.id === activeList);
      if (a && (fits(a) || a.max === 1)) return a;
    }
    return varLists.find((f) => fits(f) && (!v || suits(f, v))) ?? varLists.find(fits) ?? varLists.find((f) => canAccept(f, names).length > 0);
  };

  // ------------------------------------------------------------ expressions (Compute, Select cases)
  const insertIntoExpression = (text: string) => {
    let target = lastExpr.current;
    if (!target || !document.body.contains(target.el)) {
      const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('.analysis-dialog [data-expression]');
      if (!el) return false;
      target = { id: el.dataset.expression!, el };
      lastExpr.current = target;
    }
    const el = target.el;
    const cur = el.value;
    const start = el.selectionStart ?? cur.length;
    const end = el.selectionEnd ?? cur.length;
    const before = cur.slice(0, start);
    const needsSpace = start > 0 && !/[\s(]$/.test(before) ? ' ' : '';
    const isFunc = text.endsWith('()');
    const ins = isFunc ? `${needsSpace}${text}` : `${needsSpace}${text} `;
    // Edit the DOM synchronously and commit to state in the same tick, so keystrokes typed right
    // after an insert can never interleave with a pending re-render (DLG-7 caret race).
    el.focus();
    el.setRangeText(ins, start, end, 'end');
    if (isFunc) el.setSelectionRange(start + ins.length - 1, start + ins.length - 1);
    const id = target.id;
    flushSync(() => set({ [id]: el.value }));
    return true;
  };

  const onSourceActivate = (names: string[]) => {
    if (!hasVarlists || (lastExpr.current && document.activeElement === lastExpr.current.el)) {
      insertIntoExpression(names[0]);
      return;
    }
    const f = firstAccepting(names);
    if (f) moveTo(f, names);
  };

  // ------------------------------------------------------------ validation, hints, syntax
  const validate = () => validateDetailed(spec, values, ctx);
  const hints: Hint[] = useMemo(() => {
    try {
      return [...measureHints(spec, values, ctx), ...(spec.hints?.(values, ctx) ?? [])];
    } catch {
      return [];
    }
  }, [spec, values, ctx]);

  const syntax = (() => {
    try {
      return validate() ? '' : spec.toSyntax(values, ctx);
    } catch {
      return '';
    }
  })();

  const remember = (v: Values) => {
    const key = datasetKey();
    if (key || dataset) useDialogMemory.getState().remember(key, spec.id, v);
  };

  const close = () => {
    // keep the draft (DLG-1b): reopening restores it, "Obnovit" clears it
    if (!sameValues(values, defaultValues(spec)) && !preset) remember(values);
    closeModal();
  };

  const focusField = (field?: string) => {
    if (!field) return;
    const inSub = spec.fields.find((f) => f.kind === 'subdialog' && JSON.stringify(f.fields).includes(`"${field}"`));
    if (inSub && inSub.kind === 'subdialog') setTab(inSub.id);
    else setTab(MAIN_TAB);
    requestAnimationFrame(() => {
      const el = document.getElementById(`${spec.id}-${field}`) ?? document.getElementById(`list-${spec.id}-${field}`);
      el?.focus();
    });
  };

  const finish = (mode: 'run' | 'paste') => {
    const err = validate();
    if (err) {
      setError(err);
      focusField(err.field);
      return;
    }
    remember(values);
    const s = spec.toSyntax(values, ctx);
    closeModal();
    if (mode === 'paste') {
      pasteSyntax(s);
      toast(t('dialogs.pasted'), { action: { label: t('dialogs.backToDialog'), run: () => useUi.getState().openModal({ kind: 'analysis', specId: spec.id, preset: values }) } });
      return;
    }
    void runSyntaxDetailed(s, { source: { specId: spec.id, values }, replaceEntryId, rollbackOnError: isTransform, origin: 'dialog' }).then((r) => {
      if (!r.ok && isTransform) toast(t('dialogs.rolledBack'), { kind: 'error', action: { label: t('dialogs.backToDialog'), run: () => useUi.getState().openModal({ kind: 'analysis', specId: spec.id, preset: values }) } });
    });
  };

  // ------------------------------------------------------------ variable display
  const display = (v: Variable | undefined, name: string) => {
    const lab = v?.label ?? '';
    if (listShows === 'label' && lab) return <span className="var-name">{lab}</span>;
    return (
      <>
        <span className="var-name">{name}</span>
        {listShows !== 'name' && lab && <span className="var-label">{lab}</span>}
      </>
    );
  };
  const tip = (v: Variable) => `${v.name}${v.label ? `: ${v.label}` : ''} · ${t(v.type === 'string' ? 'varType.string' : `measure.${v.measure === 'unknown' ? 'scale' : v.measure}`)}`;

  // ------------------------------------------------------------ field rendering
  const renderVarList = (f: VarListField, index: number) => {
    const list = (values[f.id] as string[]) ?? [];
    const single = f.max === 1;
    const sel = selectedTarget?.list === f.id ? selectedTarget.names : [];
    const canMoveIn = selectedSource.length > 0 && canAccept(f, selectedSource).length > 0;
    const moveOut = sel.length > 0;
    const invalid = error?.field === f.id;
    const fieldHints = hints.filter((h) => h.field === f.id);
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const names = JSON.parse(e.dataTransfer.getData('application/x-pspp-vars') || '[]') as string[];
      moveTo(f, names);
    };
    const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
      const idx = list.findIndex((n) => n === sel[sel.length - 1]);
      if ((e.key === 'Delete' || e.key === 'Backspace' || e.key === 'ArrowLeft') && sel.length) {
        e.preventDefault();
        removeFrom(f, sel);
        const rest = list.filter((n) => !sel.includes(n));
        if (rest.length) setSelectedTarget({ list: f.id, names: [rest[Math.min(Math.max(0, idx), rest.length - 1)]] });
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.max(0, Math.min(list.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
        if (list[next]) setSelectedTarget({ list: f.id, names: e.shiftKey ? [...new Set([...sel, list[next]])] : [list[next]] });
      } else if (e.key === 'a' && (e.ctrlKey || e.metaKey) && list.length) {
        e.preventDefault();
        setSelectedTarget({ list: f.id, names: [...list] });
      }
    };
    return (
      <div className={`dlg-target ${single ? 'single' : ''} ${activeList === f.id ? 'active' : ''}`} key={f.id}>
        <button
          type="button"
          className="dlg-move"
          tabIndex={-1}
          aria-label={moveOut ? t('dialogs.removeFrom', { list: L(f.label) }) : t('dialogs.moveTo', { list: L(f.label) })}
          data-tip={`${moveOut ? t('dialogs.remove') : t('dialogs.add')}${index < 9 ? ` (${formatShortcut(`Mod+${index + 1}`)})` : ''}`}
          disabled={!canMoveIn && !moveOut}
          onClick={() => (moveOut ? removeFrom(f, sel) : moveTo(f, selectedSource))}
        >
          <Icon name={moveOut ? 'arrow_back' : 'arrow_forward'} />
        </button>
        <div className="dlg-target-box">
          <div className="dlg-target-label" id={`lbl-${spec.id}-${f.id}`}>
            <span>
              {L(f.label)}
              {(f.min ?? 0) > 0 && <span className="req" aria-hidden="true"> *</span>}
            </span>
            {f.prefer && (
              <span className="dlg-prefer" title={t('dialogs.prefers')}>
                {f.prefer.map((m) => (
                  <MeasureIcon key={m} measure={m === 'unknown' ? 'scale' : m} size={14} />
                ))}
              </span>
            )}
          </div>
          <ul
            id={`list-${spec.id}-${f.id}`}
            className={`var-list ${single ? 'single' : ''}`}
            role="listbox"
            aria-labelledby={`lbl-${spec.id}-${f.id}`}
            aria-multiselectable={!single}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${spec.id}-error` : undefined}
            aria-activedescendant={sel.length ? `tgt-${spec.id}-${f.id}-${sel[sel.length - 1]}` : undefined}
            tabIndex={0}
            onFocus={() => {
              setActiveList(f.id);
              if (!sel.length && list.length) setSelectedTarget({ list: f.id, names: [list[0]] });
            }}
            onClick={() => setActiveList(f.id)}
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add('drop');
            }}
            onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
            onDrop={(e) => {
              e.currentTarget.classList.remove('drop');
              onDrop(e);
            }}
            onKeyDown={onKey}
          >
            {list.length === 0 && <li className="var-empty">{single ? t('dialogs.dropOne') : t('dialogs.dropHere')}</li>}
            {list.map((n) => {
              const v = variables.find((x) => x.name === n);
              const on = sel.includes(n);
              return (
                <li
                  key={n}
                  id={`tgt-${spec.id}-${f.id}-${n}`}
                  role="option"
                  aria-selected={on}
                  className={`${on ? 'on' : ''} ${v && !suits(f, v) ? 'unsuited' : ''}`}
                  title={v ? tip(v) : n}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('application/x-pspp-vars', JSON.stringify([n]))}
                  onClick={(e) => {
                    const names = e.ctrlKey || e.metaKey ? (on ? sel.filter((x) => x !== n) : [...sel, n]) : [n];
                    setSelectedTarget({ list: f.id, names });
                    setSelectedSource([]);
                  }}
                  onDoubleClick={() => removeFrom(f, [n])}
                >
                  {v && <MeasureIcon measure={displayMeasure(v)} size={16} />}
                  {display(v, n)}
                  {f.groups && v && distinct.has(n) && <span className="var-count">{t('dialogs.groupCount', { count: distinct.get(n) })}</span>}
                </li>
              );
            })}
          </ul>
          {fieldHints.map((h, i) => renderHint(h, i))}
        </div>
      </div>
    );
  };

  const renderHint = (h: Hint, i: number) => (
    <div className={`dlg-hint ${h.level}`} key={`h${i}-${h.text}`} role={h.level === 'warn' ? 'status' : undefined}>
      <Icon name={h.level === 'warn' ? 'warning' : 'lightbulb'} />
      <span>
        {L(h.text, {
          ...h.args,
          measure: h.args?.measure ? t(h.args.measure === 'string' ? 'varType.string' : `measure.${h.args.measure}`).toLowerCase() : undefined,
        })}
      </span>
      {h.action && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            if (h.action?.patch) set(h.action.patch);
            const sm = h.action?.setMeasure;
            if (sm) {
              const d = useData.getState();
              const idx = d.dataset?.variables.findIndex((x) => x.name === sm.variable) ?? -1;
              if (idx >= 0) d.updateVariable(idx, { measure: sm.measure }, t('dialogs.measureChanged', { name: sm.variable }));
            }
          }}
        >
          {L(h.action.label, h.action.args)}
        </button>
      )}
    </div>
  );

  const renderGroupValues = (f: GroupValuesField) => <GroupValues key={`gv-${f.ids.join('-')}`} f={f} spec={spec} values={values} set={set} variables={variables} ctx={ctx} invalid={!!error && f.ids.includes(error.field ?? '')} />;

  const renderRows = (f: RowsField) => {
    const blank = () => Object.fromEntries(f.columns.map((c) => [c.id, c.type === 'select' ? c.options?.[0]?.value ?? '' : '']));
    const list = ((values[f.id] as Record<string, string>[]) ?? []).length ? (values[f.id] as Record<string, string>[]) : [blank()];
    const update = (i: number, col: string, val: string) => set({ [f.id]: list.map((r, k) => (k === i ? { ...r, [col]: val } : r)) });
    const cols = `${f.columns.map((c) => c.width ?? 'minmax(0,1fr)').join(' ')} 36px`;
    return (
      <div className="field dlg-rows" key={f.id} id={`${spec.id}-${f.id}`} tabIndex={-1}>
        <span className="field-label">{L(f.label)}</span>
        <div className="rows-table" role="table" aria-label={L(f.label)}>
          <div className="rows-head" role="row" style={{ gridTemplateColumns: cols }}>
            {f.columns.map((c) => (
              <span key={c.id} role="columnheader">
                {L(c.label)}
              </span>
            ))}
            <span />
          </div>
          {list.map((r, i) => (
            <div className="rows-row" role="row" key={i} style={{ gridTemplateColumns: cols }}>
              {f.columns.map((c) => {
                const aria = `${L(c.label)} ${i + 1}`;
                if (c.type === 'variable')
                  return (
                    <select key={c.id} className="select" aria-label={aria} value={r[c.id] ?? ''} onChange={(e) => update(i, c.id, e.target.value)}>
                      <option value="">{t('dialogs.chooseVariable')}</option>
                      {variables
                        .filter((v) => matchesFilter(v, c.filter))
                        .map((v) => (
                          <option key={v.name} value={v.name}>
                            {listShows === 'label' && v.label ? v.label : v.label && listShows === 'both' ? `${v.name} – ${v.label}` : v.name}
                          </option>
                        ))}
                    </select>
                  );
                if (c.type === 'select')
                  return (
                    <select key={c.id} className="select" aria-label={aria} value={r[c.id] ?? ''} onChange={(e) => update(i, c.id, e.target.value)}>
                      {c.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.raw ? o.label : L(o.label)}
                        </option>
                      ))}
                    </select>
                  );
                return (
                  <input
                    key={c.id}
                    className="input"
                    aria-label={aria}
                    type={c.type === 'number' ? 'number' : 'text'}
                    placeholder={c.placeholder ? t('dialogs.example', { example: c.placeholder }) : undefined}
                    value={r[c.id] ?? ''}
                    onChange={(e) => update(i, c.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && i === list.length - 1) {
                        e.preventDefault();
                        set({ [f.id]: [...list, blank()] });
                      }
                    }}
                  />
                );
              })}
              <IconButton icon="delete" small label={t('dialogs.removeRow')} onClick={() => set({ [f.id]: list.filter((_, k) => k !== i) })} disabled={list.length <= 1 && (f.minRows ?? 0) > 0} />
            </div>
          ))}
        </div>
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ [f.id]: [...list, blank()] })}>
            <Icon name="add" />
            {t('dialogs.addRow')}
          </button>
        </div>
        {f.hint && <span className="field-hint">{L(f.hint)}</span>}
      </div>
    );
  };

  const fieldError = (id: string) => (error?.field === id ? { 'aria-invalid': true, 'aria-describedby': `${spec.id}-error` } : {});

  const renderField = (f: Field, key: string | number): ReactNode => {
    if (f.when && !f.when(values)) return null;
    switch (f.kind) {
      case 'varlist':
      case 'subdialog':
        return null;
      case 'groupvalues':
        return renderGroupValues(f);
      case 'checkbox':
        return (
          <label className="check" key={f.id}>
            <input id={`${spec.id}-${f.id}`} type="checkbox" checked={Boolean(values[f.id])} onChange={(e) => set({ [f.id]: e.target.checked })} />
            <span className="check-text">
              <span>{L(f.label)}</span>
            </span>
          </label>
        );
      case 'radio':
        return (
          <fieldset className={`dlg-fieldset ${f.inline ? 'inline' : ''}`} key={f.id}>
            <legend className="field-label">{L(f.label)}</legend>
            <div className="dlg-radios">
              {f.options.map((o) => (
                <label className="radio" key={o.value}>
                  <input type="radio" name={`${spec.id}-${f.id}`} value={o.value} checked={values[f.id] === o.value} onChange={() => set({ [f.id]: o.value })} />
                  <span className="check-text">
                    <span>{L(o.label)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      case 'select':
        return (
          <div className="field" key={f.id}>
            <label className="field-label" htmlFor={`${spec.id}-${f.id}`}>
              {L(f.label)}
            </label>
            <select id={`${spec.id}-${f.id}`} className="select" value={String(values[f.id] ?? '')} onChange={(e) => set({ [f.id]: e.target.value })}>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.raw ? o.label : L(o.label)}
                </option>
              ))}
            </select>
          </div>
        );
      case 'number':
        return (
          <div className="field num-field" key={f.id}>
            <label className="field-label" htmlFor={`${spec.id}-${f.id}`}>
              {L(f.label)}
            </label>
            <input
              id={`${spec.id}-${f.id}`}
              className="input"
              type="number"
              inputMode="decimal"
              min={f.min}
              max={f.max}
              step={f.step ?? 'any'}
              value={values[f.id] === null || values[f.id] === undefined ? '' : String(values[f.id])}
              onChange={(e) => set({ [f.id]: e.target.value === '' ? null : Number(e.target.value) })}
              {...fieldError(f.id)}
            />
            {f.hint && <span className="field-hint">{L(f.hint)}</span>}
          </div>
        );
      case 'text': {
        const common = {
          id: `${spec.id}-${f.id}`,
          className: `${f.multiline ? 'textarea' : 'input'} ${f.mono ? 'mono' : ''}`,
          placeholder: f.placeholder ? t('dialogs.example', { example: f.placeholder }) : undefined,
          value: String(values[f.id] ?? ''),
          spellCheck: false,
          'data-expression': f.expression ? f.id : undefined,
          onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            if (f.expression) lastExpr.current = { id: f.id, el: e.currentTarget };
          },
          onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set({ [f.id]: e.target.value }),
          ...fieldError(f.id),
        };
        return (
          <div className={`field ${f.expression ? 'dlg-expr' : ''}`} key={f.id}>
            <label className="field-label" htmlFor={common.id}>
              {L(f.label)}
            </label>
            {f.multiline ? <textarea {...common} rows={3} /> : <input {...common} />}
            {f.hint && <span className="field-hint">{L(f.hint)}</span>}
            {hints.filter((h) => h.field === f.id).map((h, i) => renderHint(h, i))}
          </div>
        );
      }
      case 'rows':
        return renderRows(f);
      case 'group': {
        const children = f.fields.map((c, i) => renderField(c, i)).filter(Boolean);
        if (!children.length) return null;
        return (
          <fieldset className={`dlg-group cols-${f.columns ?? 1} ${f.label ? '' : 'plain'}`} key={`g${key}`}>
            {f.label && <legend className="field-label">{L(f.label)}</legend>}
            <div className="dlg-group-body">{children}</div>
          </fieldset>
        );
      }
      case 'info':
        return (
          <p className="dlg-info" key={`i${key}`}>
            <Icon name="info" />
            {L(f.label)}
          </p>
        );
    }
  };

  const subdialogs = spec.fields.filter((f): f is Field & { kind: 'subdialog' } => f.kind === 'subdialog' && (!f.when || f.when(values)));
  const otherFields = spec.fields.filter((f) => f.kind !== 'varlist' && f.kind !== 'subdialog');
  const defaults = useMemo(() => defaultValues(spec), [spec]);
  const changed = (f: Field & { kind: 'subdialog' }) => {
    let c = false;
    walkFields(f.fields, (x) => {
      if ('id' in x && JSON.stringify(values[x.id]) !== JSON.stringify(defaults[x.id])) c = true;
    });
    return c;
  };

  const onSourceKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const idx = source.findIndex((v) => v.name === selectedSource[selectedSource.length - 1]);
    if ((e.key === 'Enter' || e.key === 'ArrowRight') && !e.ctrlKey && !e.metaKey && selectedSource.length) {
      e.preventDefault();
      onSourceActivate(selectedSource);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? source.length - 1 : Math.max(0, Math.min(source.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
      if (source[next]) {
        setSelectedSource(e.shiftKey ? [...new Set([...selectedSource, source[next].name])] : [source[next].name]);
        setSelectedTarget(null);
        anchor.current = next;
        (e.currentTarget.children[next] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSelectedSource(source.map((v) => v.name));
    } else if (/^[1-9]$/.test(e.key) && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      const f = varLists[Number(e.key) - 1];
      if (f && selectedSource.length) {
        e.preventDefault();
        moveTo(f, selectedSource);
      }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) {
      const now = Date.now();
      const ta = typeAhead.current;
      ta.text = now - ta.time < 700 ? ta.text + e.key.toLowerCase() : e.key.toLowerCase();
      ta.time = now;
      const hit = source.findIndex((v) => v.name.toLowerCase().startsWith(ta.text) || v.label.toLowerCase().startsWith(ta.text));
      if (hit >= 0) {
        setSelectedSource([source[hit].name]);
        anchor.current = hit;
        (e.currentTarget.children[hit] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
      }
    }
  };

  const onDialogKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      finish(e.shiftKey ? 'paste' : 'run');
    }
  };

  // scroll the keyboard selection into view after list changes
  useEffect(() => {
    const el = selectedSource.length ? document.getElementById(`src-${spec.id}-${selectedSource[selectedSource.length - 1]}`) : null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedSource, spec.id]);

  const errorText = error ? `${error.field && labels[error.field] ? `${L(labels[error.field])}: ` : ''}${L(error.key)}` : null;
  const runLabel = isTransform ? t('dialogs.apply') : t('dialogs.run');
  const generalHints = hints.filter((h) => !h.field || !varLists.some((f) => f.id === h.field));

  const mainTab = (
    <div className={`dlg-layout ${needsSource ? 'with-source' : ''}`}>
      {needsSource && (
        <div className="dlg-source">
          <div className="dlg-target-label" id={`src-${spec.id}`}>
            <span>{t('dialogs.variables')}</span>
            <span className="badge">{source.length}</span>
          </div>
          <div className="dlg-search">
            <Icon name="search" />
            <input className="input" placeholder={t('dialogs.filterVariables')} aria-label={t('dialogs.filterVariables')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <ul
            ref={sourceRef}
            className="var-list source"
            role="listbox"
            aria-labelledby={`src-${spec.id}`}
            aria-multiselectable="true"
            aria-describedby={`${spec.id}-srchint`}
            tabIndex={0}
            onKeyDown={onSourceKey}
            onFocus={() => {
              if (!selectedSource.length && source.length) setSelectedSource([source[0].name]);
            }}
            aria-activedescendant={selectedSource.length ? `src-${spec.id}-${selectedSource[selectedSource.length - 1]}` : undefined}
          >
            {variables.length === 0 && <li className="var-empty">{t('dialogs.noData')}</li>}
            {source.map((v, i) => {
              const on = selectedSource.includes(v.name);
              const ok = suitable.has(v.name);
              const firstUnsuited = !ok && (i === 0 || suitable.has(source[i - 1].name)) && suitable.size > 0;
              return (
                <li
                  key={v.name}
                  id={`src-${spec.id}-${v.name}`}
                  role="option"
                  aria-selected={on}
                  className={`${on ? 'on' : ''} ${ok ? '' : 'unsuited'} ${firstUnsuited ? 'sep' : ''}`}
                  title={tip(v)}
                  draggable
                  onDragStart={(e) => {
                    const names = on ? selectedSource : [v.name];
                    e.dataTransfer.setData('application/x-pspp-vars', JSON.stringify(names));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onMouseDown={(e) => {
                    if (lastExpr.current && document.activeElement === lastExpr.current.el) e.preventDefault();
                  }}
                  onClick={(e) => {
                    setSelectedTarget(null);
                    if (e.shiftKey && anchor.current >= 0) {
                      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
                      setSelectedSource(source.slice(a, b + 1).map((x) => x.name));
                    } else if (e.ctrlKey || e.metaKey) {
                      setSelectedSource(on ? selectedSource.filter((x) => x !== v.name) : [...selectedSource, v.name]);
                      anchor.current = i;
                    } else {
                      setSelectedSource([v.name]);
                      anchor.current = i;
                    }
                  }}
                  onDoubleClick={() => onSourceActivate([v.name])}
                >
                  <MeasureIcon measure={displayMeasure(v)} size={16} />
                  {display(v, v.name)}
                  {active?.groups && distinct.has(v.name) && <span className="var-count">{t('dialogs.groupCount', { count: distinct.get(v.name) })}</span>}
                </li>
              );
            })}
          </ul>
          <span className="field-hint" id={`${spec.id}-srchint`}>
            {hasVarlists ? t('dialogs.sourceKeys', { mod: formatShortcut('Mod') }) : t('dialogs.doubleClickInsert')}
          </span>
        </div>
      )}
      <div className="dlg-main">
        {hasVarlists && <div className="dlg-targets">{varLists.map((f, i) => renderVarList(f, i))}</div>}
        {otherFields.length > 0 && <div className="dlg-fields">{otherFields.map((f, i) => renderField(f, i))}</div>}
        {hasExpression && <ExpressionPalette onInsert={insertIntoExpression} />}
        {generalHints.length > 0 && <div className="dlg-hints">{generalHints.map((h, i) => renderHint(h, i))}</div>}
      </div>
    </div>
  );

  const tabsId = `dlg-${spec.id}`;
  return (
    <Dialog
      title={t(spec.title)}
      icon={spec.icon}
      size={spec.size ?? (needsSource ? 'wide' : 'normal')}
      onClose={close}
      closeOnScrim={false}
      className="analysis-dialog"
      initialFocus={needsSource ? '.var-list.source' : undefined}
      headerExtra={replaceEntryId ? <span className="dlg-editing">{t('dialogs.editingResult')}</span> : undefined}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => window.open(manualUrl(spec.command), '_blank', 'noopener')}>
            <Icon name="help" />
            <span className="hide-sm">{t('dialogs.help')}</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setValues(defaultValues(spec));
              setError(null);
              useDialogMemory.getState().remember(datasetKey(), spec.id, defaultValues(spec));
            }}
          >
            {t('dialogs.reset')}
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => finish('paste')} data-tip={`${t('dialogs.pasteHint')} (${formatShortcut('Mod+Shift+Enter')})`}>
            <Icon name="content_paste_go" />
            <span className="hide-sm">{t('dialogs.paste')}</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={() => finish('run')} disabled={!dataset && hasVarlists} data-tip={formatShortcut('Mod+Enter')}>
            <Icon name={isTransform ? 'check' : 'play_arrow'} />
            {runLabel}
          </button>
        </>
      }
    >
      <div className="dlg-root" onKeyDown={onDialogKey}>
        {subdialogs.length > 0 && (
          <Tabs
            id={tabsId}
            size="sm"
            className="dlg-tabs"
            aria-label={t('dialogs.sections')}
            value={tab}
            onChange={setTab}
            items={[{ id: MAIN_TAB, label: t('dialogs.mainTab'), icon: 'view_list' }, ...subdialogs.map((f) => ({ id: f.id, label: `${L(f.label).replace(/…$/, '')}${changed(f) ? ' •' : ''}`, icon: f.icon }))]}
          />
        )}
        <div className="dlg-tabpanel" role={subdialogs.length ? 'tabpanel' : undefined} aria-labelledby={subdialogs.length ? `${tabsId}-tab-${tab}` : undefined}>
          {tab === MAIN_TAB ? (
            mainTab
          ) : (
            <div className="dlg-fields dlg-sub">{subdialogs.find((f) => f.id === tab)?.fields.map((f, i) => renderField(f, i))}</div>
          )}
        </div>
        {errorText && (
          <div className="dlg-error" role="alert" id={`${spec.id}-error`}>
            <Icon name="error" />
            {errorText}
          </div>
        )}
        <div className="dlg-preview">
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showPreview} onClick={() => setSettings({ showSyntaxPreview: !showPreview })}>
            <Icon name={showPreview ? 'expand_less' : 'code'} />
            {t('dialogs.preview')}
          </button>
          {showPreview && (
            <div className="dlg-preview-box">
              <pre className="syntax-preview">{syntax || t('dialogs.previewIncomplete')}</pre>
              {syntax && <IconButton icon="content_copy" small label={t('dialogs.copySyntax')} onClick={() => void navigator.clipboard?.writeText(syntax).then(() => toast(t('output.copied')))} />}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------------------- */

/** Two values of a grouping variable picked from its labels and observed values (DLG-2). */
function GroupValues({
  f,
  spec,
  values,
  set,
  variables,
  ctx,
  invalid,
}: {
  f: GroupValuesField;
  spec: DialogSpec;
  values: Values;
  set: (p: Values) => void;
  variables: Variable[];
  ctx: DialogContext;
  invalid: boolean;
}) {
  const { t } = useTranslation();
  const L = useLabel();
  const name = ((values[f.source] as string[]) ?? [])[0];
  const v = variables.find((x) => x.name === name);
  const options = useMemo(() => (v ? distinctValues(v, ctx.column?.(v.name)) : []), [v, ctx]);
  const prevName = useRef<string | undefined>(name);
  const [custom, setCustom] = useState<Record<string, boolean>>({});

  // preselect the two most frequent values (or min/max) when the grouping variable changes
  useEffect(() => {
    if (!v || !options.length) return;
    const cur = f.ids.map((id) => String(values[id] ?? ''));
    const valid = cur.every((c) => options.some((o) => o.value === c));
    if (prevName.current === name && valid) return;
    prevName.current = name;
    let pick: string[];
    if (f.mode === 'range') pick = [options[0].value, options[options.length - 1].value];
    else pick = [...options].sort((a, b) => b.count - a.count).slice(0, 2).map((o) => o.value).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
    if (pick.length < f.ids.length) return;
    set(Object.fromEntries(f.ids.map((id, i) => [id, f.mode === 'range' ? Number(pick[i]) : pick[i]])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, options]);

  if (!name) return <p className="dlg-info subtle" key={f.ids.join()}>{t('dialogs.pickGroupFirst')}</p>;
  const tooMany = options.length > 60;
  return (
    <div className="dlg-groupvalues" role="group" aria-label={t('dialogs.groupsOf', { name })}>
      {f.ids.map((id, i) => {
        const val = String(values[id] ?? '');
        const isCustom = custom[id] || tooMany || (val !== '' && !options.some((o) => o.value === val));
        return (
          <div className="field" key={id}>
            <label className="field-label" htmlFor={`${spec.id}-${id}`}>
              {L(f.labels[i])}
            </label>
            {isCustom ? (
              <input
                id={`${spec.id}-${id}`}
                className="input"
                value={val}
                aria-invalid={invalid || undefined}
                onChange={(e) => set({ [id]: f.mode === 'range' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value })}
              />
            ) : (
              <select
                id={`${spec.id}-${id}`}
                className="select"
                value={val}
                aria-invalid={invalid || undefined}
                onChange={(e) => {
                  if (e.target.value === '__custom') setCustom({ ...custom, [id]: true });
                  else set({ [id]: f.mode === 'range' ? Number(e.target.value) : e.target.value });
                }}
              >
                <option value="">{t('dialogs.chooseValue')}</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label ? `${o.value} · ${o.label}` : o.value} ({o.count}×)
                  </option>
                ))}
                <option value="__custom">{t('dialogs.otherValue')}</option>
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Shared operator / function palette for expression fields (one per dialog, DLG-7). */
function ExpressionPalette({ onInsert }: { onInsert: (text: string) => boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'cs' ? 'cs' : 'en';
  return (
    <div className="dlg-exprpal" aria-label={t('dialogs.insertToken')} role="group">
      <div className="dlg-ops">
        {OPERATORS.map((tok) => (
          <button key={tok} type="button" className="dlg-op" onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert(tok)}>
            {tok}
          </button>
        ))}
      </div>
      <select
        className="select dlg-funcs"
        aria-label={t('dialogs.insertFunction')}
        value=""
        onChange={(e) => {
          if (e.target.value) onInsert(`${e.target.value}()`);
        }}
      >
        <option value="">{t('dialogs.insertFunction')}</option>
        {FUNCTIONS_BY_GROUP.map((g) => (
          <optgroup key={g.id} label={g.label[lang]}>
            {g.items.map((fn) => (
              <option key={fn.name} value={fn.name} title={fn.desc[lang]}>
                {fn.name} – {fn.desc[lang]}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
