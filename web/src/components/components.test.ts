// @vitest-environment jsdom
/* SPDX-License-Identifier: GPL-3.0-or-later */
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { Dialog } from './Dialog';
import { Menu, type MenuEntry } from './Menu';
import { Chip, FilterChip, MeasureChip, StatusChip, ValueLabelChip } from './Chip';
import { Segmented } from './Segmented';
import { Tabs } from './Tabs';
import { NumberField, parseNumber } from './Field';
import { Panel } from './Panel';
import { Toolbar } from './Toolbar';
import { Counter } from './Badge';
import { Kbd } from './Kbd';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

function render(el: ReturnType<typeof h>) {
  act(() => root.render(el));
}

function key(target: Element | null, k: string, opts: KeyboardEventInit = {}) {
  act(() => {
    target!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  });
}

// createElement with children passed positionally (keeps the tests free of JSX in a .ts file)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hc = (type: any, props: any, ...children: any[]) => h(type, props, ...children);

const active = () => document.activeElement as HTMLElement;

describe('Dialog', () => {
  it('focuses the first body control, traps Tab, closes on Escape and restores focus', () => {
    const opener = document.createElement('button');
    opener.textContent = 'open';
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    render(
      hc(
        Dialog,
        { title: 'Frequencies', onClose, footer: h('button', { id: 'ok' }, 'OK') },
        h('input', { id: 'first', 'aria-label': 'Filter' }),
        h('button', { id: 'mid' }, 'Statistics'),
      ),
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(document.querySelector('.dialog-header h2')!.id);
    expect(active().id).toBe('first');

    // Tab from the last control wraps to the first focusable (the close button in the header)
    document.getElementById('ok')!.focus();
    key(active(), 'Tab');
    expect(active().getAttribute('aria-label')).toBe('Close');
    // Shift+Tab from the first wraps to the last
    key(active(), 'Tab', { shiftKey: true });
    expect(active().id).toBe('ok');

    key(active(), 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => root.render(h('div')));
    expect(active()).toBe(opener);
  });

  it('links the description and can ignore backdrop clicks', () => {
    const onClose = vi.fn();
    render(hc(Dialog, { title: 'Delete variable', description: 'This cannot be undone.', onClose, closeOnScrim: false }, h('p', null, 'x')));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent).toBe('This cannot be undone.');
    act(() => {
      document.querySelector('.scrim')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Menu keyboard navigation', () => {
  const run = vi.fn();
  const items: MenuEntry[] = [
    { type: 'item', id: 'open', label: 'Open…', icon: 'folder_open', shortcut: 'Ctrl+O', onSelect: run },
    { type: 'item', id: 'save', label: 'Save', disabled: true, onSelect: run },
    { type: 'sep' },
    { type: 'item', id: 'export', label: 'Export', onSelect: run },
    { type: 'item', id: 'print', label: 'Print', onSelect: run },
  ];

  it('moves with arrows, skips disabled items, wraps, supports Home/End and type-ahead', () => {
    const onClose = vi.fn();
    render(h(Menu, { items, anchor: { x: 0, y: 0 }, onClose, label: 'File' }));
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu.getAttribute('aria-label')).toBe('File');
    expect(active().textContent).toContain('Open…');
    key(active(), 'ArrowDown');
    expect(active().textContent).toContain('Export'); // "Save" is disabled
    key(active(), 'ArrowDown');
    expect(active().textContent).toContain('Print');
    key(active(), 'ArrowDown');
    expect(active().textContent).toContain('Open…'); // wraps
    key(active(), 'ArrowUp');
    expect(active().textContent).toContain('Print');
    key(active(), 'Home');
    expect(active().textContent).toContain('Open…');
    key(active(), 'End');
    expect(active().textContent).toContain('Print');
    key(active(), 'e');
    expect(active().textContent).toContain('Export');
    key(active(), 'Escape');
    expect(onClose).toHaveBeenCalledWith('escape');
  });

  it('selecting an item closes the menu and runs it', () => {
    const onClose = vi.fn();
    run.mockClear();
    render(h(Menu, { items, anchor: { x: 0, y: 0 }, onClose }));
    act(() => (document.querySelectorAll('[role="menuitem"]')[2] as HTMLElement).click());
    expect(onClose).toHaveBeenCalledWith('select');
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('Chips', () => {
  it('renders a value-label chip with code and label', () => {
    render(h(ValueLabelChip, { value: '1', label: 'Male' }));
    const chip = host.querySelector('.chip-value')!;
    expect(chip.querySelector('.chip-code')!.textContent).toBe('1');
    expect(chip.querySelector('.chip-text')!.textContent).toBe('Male');
    render(h(ValueLabelChip, { value: '9', label: 'No answer', missing: true }));
    expect(host.querySelector('.chip-value')!.classList.contains('missing')).toBe(true);
  });

  it('renders status tones and measure chips', () => {
    render(h('div', null, hc(StatusChip, { tone: 'success' }, 'Engine ready'), h(MeasureChip, { measure: 'ordinal', label: 'Ordinal' }), h(MeasureChip, { measure: 'scale', label: 'Scale', iconOnly: true })));
    expect(host.querySelector('.chip-status')!.className).toContain('tone-success');
    const [ord, scale] = Array.from(host.querySelectorAll('.chip-measure'));
    expect(ord.getAttribute('data-measure')).toBe('ordinal');
    expect(ord.querySelector('.icon')!.textContent).toBe('signal_cellular_alt');
    expect(ord.textContent).toContain('Ordinal');
    expect(scale.getAttribute('role')).toBe('img');
    expect(scale.getAttribute('aria-label')).toBe('Scale');
    expect(scale.querySelector('.chip-text')).toBeNull();
  });

  it('toggles a filter chip and removes a removable chip', () => {
    const onRemove = vi.fn();
    function Demo() {
      const [on, setOn] = useState(false);
      return h('div', null, hc(FilterChip, { selected: on, onToggle: setOn }, 'Weighted'), hc(Chip, { onRemove, removeLabel: 'Remove gender' }, 'gender'));
    }
    render(h(Demo));
    const toggle = host.querySelector<HTMLButtonElement>('.chip-filter')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.querySelector('.icon')!.textContent).toBe('check');
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Remove gender"]')!.click());
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('Segmented and Tabs', () => {
  it('Segmented is a radiogroup with roving focus', () => {
    function Demo() {
      const [v, setV] = useState<'a' | 'b' | 'c'>('a');
      return h(Segmented<'a' | 'b' | 'c'>, {
        'aria-label': 'Alignment',
        value: v,
        onChange: setV,
        options: [
          { value: 'a', label: 'Left' },
          { value: 'b', label: 'Center', disabled: true },
          { value: 'c', label: 'Right' },
        ],
      });
    }
    render(h(Demo));
    const radios = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    radios[0].focus();
    key(radios[0], 'ArrowRight');
    expect(radios[2].getAttribute('aria-checked')).toBe('true');
    expect(active()).toBe(radios[2]);
    key(radios[2], 'ArrowRight');
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
  });

  it('Tabs activate with arrows and link panels', () => {
    function Demo() {
      const [v, setV] = useState('data');
      return h(Tabs<string>, {
        'aria-label': 'Views',
        id: 'views',
        value: v,
        onChange: setV,
        items: [
          { id: 'data', label: 'Data' },
          { id: 'vars', label: 'Variables', count: 12 },
          { id: 'out', label: 'Output' },
        ],
      });
    }
    render(h(Demo));
    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs[0].getAttribute('aria-controls')).toBe('views-panel-data');
    tabs[0].focus();
    key(tabs[0], 'ArrowLeft');
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(active()).toBe(tabs[2]);
    key(tabs[2], 'Home');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].querySelector('.counter')!.textContent).toBe('12');
  });
});

describe('Fields and misc', () => {
  it('parses numbers with either decimal separator', () => {
    expect(parseNumber('2,5')).toBe(2.5);
    expect(parseNumber(' 1 000.25 ')).toBe(1000.25);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });

  it('NumberField steps with arrow keys and clamps', () => {
    const changes: (number | null)[] = [];
    function Demo() {
      const [v, setV] = useState<number | null>(0.5);
      return h(NumberField, {
        label: 'Confidence',
        value: v,
        min: 0,
        max: 1,
        step: 0.25,
        decimalSeparator: ',',
        onValueChange: (n: number | null) => {
          changes.push(n);
          setV(n);
        },
      });
    }
    render(h(Demo));
    const input = host.querySelector<HTMLInputElement>('input')!;
    expect(input.value).toBe('0,5');
    expect(host.querySelector('label')!.htmlFor).toBe(input.id);
    key(input, 'ArrowUp');
    key(input, 'ArrowUp');
    key(input, 'ArrowUp');
    expect(changes).toEqual([0.75, 1]);
    expect(input.value).toBe('1');
  });

  it('Panel collapses with aria-expanded', () => {
    render(hc(Panel, { title: 'Statistics', collapsible: true }, h('p', null, 'body')));
    const btn = host.querySelector<HTMLButtonElement>('.panel-toggle')!;
    const body = host.querySelector<HTMLElement>('.panel-body')!;
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-controls')).toBe(body.id);
    act(() => btn.click());
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
  });

  it('Toolbar keeps a single tab stop and moves with arrows', () => {
    render(hc(Toolbar, { 'aria-label': 'Data' }, h('button', null, 'A'), h('button', null, 'B'), h('button', { disabled: true }, 'C'), h('button', null, 'D')));
    const [a, b, , d] = Array.from(host.querySelectorAll('button'));
    expect([a.tabIndex, b.tabIndex, d.tabIndex]).toEqual([0, -1, -1]);
    a.focus();
    key(a, 'ArrowRight');
    expect(active()).toBe(b);
    key(b, 'ArrowRight');
    expect(active()).toBe(d);
    key(d, 'ArrowRight');
    expect(active()).toBe(a);
  });

  it('Counter caps and Kbd splits keys', () => {
    render(h('div', null, h(Counter, { count: 150 }), h(Kbd, { keys: 'Ctrl+Shift+P' })));
    expect(host.querySelector('.counter')!.textContent).toBe('99+');
    expect(Array.from(host.querySelectorAll('kbd')).map((k) => k.textContent)).toEqual(['Ctrl', 'Shift', 'P']);
  });
});
