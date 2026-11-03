/*
 * Tabs — underline style, automatic activation, roving tabindex (←/→/Home/End).
 * Pair with <TabPanel tabsId={...} value={...}> for the content.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Counter } from './Badge';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: string;
  count?: number;
  disabled?: boolean;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  'aria-label': string;
  /** base id linking tabs and panels; pass the same to <TabPanel tabsId> */
  id?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export const tabId = (base: string, id: string) => `${base}-tab-${id}`;
export const panelId = (base: string, id: string) => `${base}-panel-${id}`;

export function Tabs<T extends string>({ items, value, onChange, id, size = 'md', className = '', ...aria }: TabsProps<T>) {
  const auto = useId();
  const base = id ?? auto;
  const ref = useRef<HTMLDivElement>(null);
  const enabled = items.filter((t) => !t.disabled);

  const onKeyDown = (e: KeyboardEvent) => {
    const idx = enabled.findIndex((t) => t.id === value);
    let next: TabItem<T> | undefined;
    if (e.key === 'ArrowRight') next = enabled[(idx + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') next = enabled[(idx - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.id);
    document.getElementById(tabId(base, next.id))?.focus();
  };

  return (
    <div ref={ref} role="tablist" aria-label={aria['aria-label']} className={`tabs ${size === 'sm' ? 'sm' : ''} ${className}`} onKeyDown={onKeyDown}>
      {items.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            id={tabId(base, t.id)}
            type="button"
            role="tab"
            className="tab"
            aria-selected={selected}
            aria-controls={panelId(base, t.id)}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
          >
            {t.icon && <Icon name={t.icon} />}
            {t.label}
            {t.count != null && <Counter count={t.count} />}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ tabsId, value, active, children, className = '' }: { tabsId: string; value: string; active: boolean; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={panelId(tabsId, value)} aria-labelledby={tabId(tabsId, value)} hidden={!active} tabIndex={0} className={`tab-panel ${className}`}>
      {active && children}
    </div>
  );
}
