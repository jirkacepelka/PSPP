/*
 * Variable list and slots. A variable goes into a slot by drag and drop, by selecting it and
 * clicking the slot, by double click (best slot), or with the slot's own drop-down (keyboard,
 * touch). A variable a slot cannot take says why.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useMemo, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon';
import { MeasureIcon } from '../components/Chip';
import type { Dataset, Variable } from '../engine/types';
import type { GraphDef } from '../charts/studioTypes';
import { displayMeasure } from '../features/dialogs/dialogData';
import { CATEGORY_CROWDED, MERGE_KINDS, distinctCapped, funcChoices, needsVariable, normalizeOptions, rejection, slotsOf, summaryValueSlot, type Rejection, type SlotDef } from './model';

const DRAG_TYPE = 'application/x-pspp-variable';

export function useDistinct(ds: Dataset | null): number[] {
  return useMemo(() => (ds ? ds.variables.map((_, i) => distinctCapped(ds.columns[i])) : []), [ds]);
}

/** Bind of DEF after putting NAME into SLOT (a variable lives in one slot only). */
export function assignVariable(def: GraphDef, slot: SlotDef, name: string): GraphDef {
  const bind: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(def.bind)) bind[k] = list.filter((n) => n !== name);
  const cur = bind[slot.id] ?? [];
  bind[slot.id] = slot.max === 1 ? [name] : [...cur, name].slice(-slot.max);
  const next = { ...def, bind, options: { ...def.options } };
  // a variable dropped on the value zone of a count chart turns the count into a summary of that variable
  if (slot.id === 'value' && !needsVariable(def.options.func)) {
    const f = funcChoices(def).find((c) => needsVariable(c.value));
    if (f) next.options.func = f.value;
  }
  return normalizeOptions(next);
}

/** Bind of DEF after taking NAME out of SLOT; an emptied summary value falls back to the count. */
export function unassignVariable(def: GraphDef, slot: SlotDef, name: string): GraphDef {
  const next = {
    ...def,
    bind: {
      ...def.bind,
      [slot.id]: (def.bind[slot.id] ?? []).filter((n) => n !== name),
    },
    options: { ...def.options },
  };
  if (slot.id === 'value' && next.bind.value.length === 0 && funcChoices(def).some((c) => c.value === 'count')) next.options.func = 'count';
  return normalizeOptions(next);
}

/** The slot a double-clicked variable goes to: first accepting required empty slot, then any empty one, then the first accepting. */
export function bestSlot(def: GraphDef, v: Variable, distinct: number): SlotDef | undefined {
  const ok = slotsOf(def).filter((s) => !rejection(s, v, distinct));
  const empty = (s: SlotDef) => (def.bind[s.id]?.length ?? 0) === 0;
  // a scale variable on a count chart is most likely meant to be summarised (the value zone of the canvas)
  const summary = displayMeasure(v) === 'scale' ? summaryValueSlot(def) : null;
  return (
    ok.find((s) => s.min > 0 && empty(s)) ??
    (summary && !rejection(summary, v, distinct) ? summary : undefined) ??
    ok.find((s) => s.max > 1 && (def.bind[s.id]?.length ?? 0) < s.max) ??
    ok.find(empty) ??
    ok.find((s) => s.max === 1) ??
    ok[0]
  );
}

export interface Picking {
  ds: Dataset;
  def: GraphDef;
  distinct: number[];
  selected: string | null;
  setSelected: (name: string | null) => void;
  dragging: string | null;
  setDragging: (name: string | null) => void;
  assign: (slot: SlotDef, name: string) => void;
  remove: (slot: SlotDef, name: string) => void;
  /** Last assignment, as a sentence for the aria-live region. */
  announcement: string;
  auto: (name: string) => void;
  onChange: (def: GraphDef) => void;
}

/** State shared by the variable list and the slots: selection, drag, assignment. */
export function usePicking(ds: Dataset, def: GraphDef, onChange: (def: GraphDef) => void): Picking {
  const distinct = useDistinct(ds);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const { t } = useTranslation();
  const [announcement, setAnnouncement] = useState('');
  const assign = (slot: SlotDef, name: string) => {
    onChange(assignVariable(def, slot, name));
    setAnnouncement(t('graphstudio.announce.assigned', { name, slot: t(slot.label) }));
  };
  const remove = (slot: SlotDef, name: string) => {
    onChange(unassignVariable(def, slot, name));
    setAnnouncement(t('graphstudio.announce.removed', { name, slot: t(slot.label) }));
  };
  const auto = (name: string) => {
    const i = ds.variables.findIndex((v) => v.name === name);
    const s = i >= 0 ? bestSlot(def, ds.variables[i], distinct[i]) : undefined;
    if (s) assign(s, name);
  };
  return {
    ds,
    def,
    distinct,
    selected,
    setSelected,
    dragging,
    setDragging,
    assign,
    remove,
    announcement,
    auto,
    onChange,
  };
}

export function VariableList({ p }: { p: Picking }) {
  const { t } = useTranslation();
  const { ds, def, selected, setSelected, setDragging, auto } = p;
  const [query, setQuery] = useState('');
  const used = new Set(Object.values(def.bind).flat());
  const q = query.trim().toLowerCase();
  const list = ds.variables.filter((v) => !q || v.name.toLowerCase().includes(q) || (v.label ?? '').toLowerCase().includes(q));
  return (
    <section className="gs-vars" aria-label={t('graphstudio.variables')}>
      <h3 className="gs-title">{t('graphstudio.variables')}</h3>
      <div className="gs-search input-wrap has-start">
        <span className="adorn start">
          <Icon name="search" />
        </span>
        <input className="input input-sm" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('graphstudio.searchVariables')} aria-label={t('graphstudio.searchVariables')} />
      </div>
      <ul className="gs-var-list" aria-label={t('graphstudio.variables')}>
        {list.map((v) => (
          <li key={v.name}>
            <button
              type="button"
              className={`gs-var ${selected === v.name ? 'on' : ''} ${used.has(v.name) ? 'used' : ''}`}
              aria-pressed={selected === v.name}
              draggable
              title={v.label || v.name}
              onClick={() => setSelected(selected === v.name ? null : v.name)}
              onDoubleClick={() => auto(v.name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && selected === v.name) {
                  e.preventDefault();
                  auto(v.name);
                }
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, v.name);
                e.dataTransfer.setData('text/plain', v.name);
                e.dataTransfer.effectAllowed = 'copy';
                setDragging(v.name);
              }}
              onDragEnd={() => setDragging(null)}
            >
              <MeasureIcon measure={displayMeasure(v)} size={18} />
              <span className="gs-var-name">{v.name}</span>
              {v.label && <span className="gs-var-label">{v.label}</span>}
            </button>
          </li>
        ))}
      </ul>
      <p className="gs-muted gs-var-hint">{t('graphstudio.variablesHint')}</p>
    </section>
  );
}

export function SlotsPanel({ p }: { p: Picking }) {
  const { t } = useTranslation();
  const { ds, def, distinct, selected, dragging, setDragging, assign, remove } = p;
  const slots = slotsOf(def);
  const active = dragging ?? selected;
  const activeVar = active ? ds.variables.findIndex((v) => v.name === active) : -1;
  const reasonFor = (slot: SlotDef): Rejection | null => (activeVar >= 0 ? rejection(slot, ds.variables[activeVar], distinct[activeVar]) : null);
  const onDrop = (slot: SlotDef) => (e: DragEvent) => {
    e.preventDefault();
    const name = e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData('text/plain');
    setDragging(null);
    const i = ds.variables.findIndex((v) => v.name === name);
    if (i >= 0 && !rejection(slot, ds.variables[i], distinct[i])) assign(slot, name);
  };
  return (
    <section className="gs-slots" aria-label={t('graphstudio.slots')}>
      {slots.map((slot) => {
        const bound = def.bind[slot.id] ?? [];
        const reason = reasonFor(slot);
        const ready = activeVar >= 0 && !reason;
        const options = ds.variables.map((v, i) => ({ v, rej: rejection(slot, v, distinct[i]) })).filter((o) => !bound.includes(o.v.name));
        return (
          <div
            key={slot.id}
            className={`gs-slot ${ready ? 'ready' : ''} ${reason ? 'blocked' : ''} ${bound.length === 0 && slot.min > 0 ? 'need' : ''}`}
            onDragOver={(e) => {
              if (dragging && !reason) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={onDrop(slot)}
            onClick={(e) => {
              if (selected && !reason && !(e.target as HTMLElement).closest('select, button')) assign(slot, selected);
            }}
          >
            <div className="gs-slot-head">
              <Icon name={slot.icon} />
              <span className="gs-slot-label" id={`gs-slot-${slot.id}`}>
                {t(slot.label)}
              </span>
              <span className="gs-slot-req">{slot.min > 0 ? t('graphstudio.required') : t('graphstudio.optional')}</span>
            </div>
            <div className="gs-slot-body">
              {bound.map((name) => {
                const i = ds.variables.findIndex((x) => x.name === name);
                return (
                  <span key={name} className="chip gs-chip" title={ds.variables[i]?.label || name}>
                    {i >= 0 && <MeasureIcon measure={displayMeasure(ds.variables[i])} size={16} />}
                    <span className="chip-text">{name}</span>
                    <button type="button" className="chip-remove" aria-label={t('graphstudio.removeVariable', { name })} onClick={() => remove(slot, name)}>
                      <Icon name="close" />
                    </button>
                  </span>
                );
              })}
              {bound.length === 0 && <span className="gs-slot-empty">{t(slot.hint ?? 'graphstudio.slotHint.default')}</span>}
            </div>
            {(() => {
              // a category variable with a huge number of values: still drawn in full, but say it is crowded
              const i = slot.id === 'x' && MERGE_KINDS.includes(def.kind) && (def.options.mergeMode ?? 'none') === 'none' ? ds.variables.findIndex((x) => x.name === bound[0]) : -1;
              return i >= 0 && distinct[i] > CATEGORY_CROWDED ? (
                <p
                  className="gs-slot-why gs-slot-warn"
                  role="status"
                  title={t('graphstudio.slotCrowded', {
                    name: bound[0],
                    max: CATEGORY_CROWDED,
                  })}
                >
                  <Icon name="priority_high" />
                  {t('graphstudio.slotCrowded', {
                    name: bound[0],
                    max: CATEGORY_CROWDED,
                  })}
                </p>
              ) : null;
            })()}
            {reason && (
              <p className="gs-slot-why" role="status">
                <Icon name="block" />
                {t(reason.key, reason.args)}
              </p>
            )}
            {ready && <p className="gs-slot-go">{t('graphstudio.clickToAdd', { name: active })}</p>}
            {(slot.max > 1 || bound.length === 0) && (
              <select className="select input-sm gs-slot-select" aria-labelledby={`gs-slot-${slot.id}`} value="" onChange={(e) => e.target.value && assign(slot, e.target.value)}>
                <option value="">{t('graphstudio.addVariable')}</option>
                {options.map(({ v, rej }) => (
                  <option key={v.name} value={v.name} disabled={!!rej}>
                    {rej ? `${v.name} (${t(rej.key, rej.args)})` : v.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </section>
  );
}
