/*
 * Graph Studio canvas tests: every slot of every kind has a canvas place, horizontal charts swap
 * the axes, summary value zones and assigning/removing variables on them.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { assignVariable, unassignVariable } from './Slots';
import { defaultDef, GALLERY, KINDS, slotsOf, summaryValueSlot, withVariant } from './model';
import type { GraphKind } from '../charts/studioTypes';

const PLACES = ['x', 'y', 'y2', 'z', 'legend', 'size', 'panelCols', 'panelRows', 'detail'];
const place = (def: ReturnType<typeof defaultDef>, id: string) => slotsOf(def).find((s) => s.id === id)?.place;

describe('slot places', () => {
  it('gives every slot of every kind and variant a canvas place', () => {
    for (const g of GALLERY) {
      const def = defaultDef(g.kind, g.variant);
      for (const s of slotsOf(def)) expect(PLACES, `${g.id}/${s.id}`).toContain(s.place);
    }
  });

  it('puts the roles where they are drawn', () => {
    const bar = defaultDef('bar', 'simple');
    expect(place(bar, 'x')).toBe('x');
    expect(place(bar, 'group')).toBe('legend');
    expect(place(bar, 'panel')).toBe('panelCols');
    const sc = defaultDef('scatter', 'grouped');
    expect([place(sc, 'x'), place(sc, 'y'), place(sc, 'group')]).toEqual(['x', 'y', 'legend']);
    const s3 = defaultDef('scatter3d');
    expect(place(s3, 'z')).toBe('z');
    const box = defaultDef('boxplot', 'simple');
    expect([place(box, 'value'), place(box, 'x')]).toEqual(['y', 'x']);
    expect(place(defaultDef('scattermatrix'), 'vars')).toBe('detail');
    expect(place(defaultDef('dualaxis', 'barline'), 'right')).toBe('y2');
  });

  it('swaps x and y for horizontal charts and keeps the slot meaning', () => {
    const v = withVariant(defaultDef('bar', 'simple'), 'horizontal');
    expect(place(v, 'x')).toBe('y');
    expect(slotsOf(v).find((s) => s.id === 'x')?.label).toBe('graphstudio.slot.category');
    const o = defaultDef('bar', 'simple');
    o.options.horizontal = true;
    o.options.func = 'mean';
    expect([place(o, 'x'), place(o, 'value')]).toEqual(['y', 'x']);
    expect(place(o, 'group')).toBe('legend');
  });

  it('places every registered kind', () => {
    for (const kind of Object.keys(KINDS) as GraphKind[]) {
      for (const s of slotsOf(defaultDef(kind))) expect(s.place).toBeTruthy();
    }
  });
});

describe('summary value zone', () => {
  it('exists for a count chart and turns the count into a mean when a variable is dropped', () => {
    const def = defaultDef('bar', 'simple');
    const slot = summaryValueSlot(def)!;
    expect(slot.place).toBe('y');
    const next = assignVariable(def, slot, 'age');
    expect(next.options.func).toBe('mean');
    expect(next.bind.value).toEqual(['age']);
    expect(summaryValueSlot(next)).toBeNull();
    const back = unassignVariable(next, slotsOf(next).find((s) => s.id === 'value')!, 'age');
    expect(back.options.func).toBe('count');
    expect(back.bind.value).toEqual([]);
  });

  it('is on x for a horizontal bar and absent for kinds without a summary', () => {
    expect(summaryValueSlot(withVariant(defaultDef('bar', 'simple'), 'horizontal'))?.place).toBe('x');
    expect(summaryValueSlot(defaultDef('scatter'))).toBeNull();
    expect(summaryValueSlot(defaultDef('boxplot'))).toBeNull();
  });

  it('uses a sum for stacked bars', () => {
    const def = defaultDef('bar', 'stacked');
    const next = assignVariable(def, summaryValueSlot(def)!, 'age');
    expect(next.options.func).toBe('sum');
  });
});

describe('double click', () => {
  it('sends a scale variable to the value zone of a count chart once the category is set', async () => {
    const { bestSlot } = await import('./Slots');
    const def = defaultDef('bar', 'simple');
    def.bind.x = ['gender'];
    const v = { name: 'age', type: 'numeric', measure: 'scale' } as never;
    expect(bestSlot(def, v, 40)?.id).toBe('value');
  });
});
