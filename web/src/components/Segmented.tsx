/*
 * Segmented control — single choice among 2–5 short options (radiogroup semantics,
 * roving tabindex, arrow keys move and select).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useRef, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
  /** hide the text and use it as aria-label/tooltip */
  iconOnly?: boolean;
  disabled?: boolean;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  size?: 'sm' | 'md';
  block?: boolean;
  className?: string;
}

export function Segmented<T extends string>({ options, value, onChange, size = 'md', block, className = '', ...aria }: SegmentedProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const enabled = options.filter((o) => !o.disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next: SegmentedOption<T> | undefined;
    const idx = enabled.findIndex((o) => o.value === value);
    if (e.key in keys) next = enabled[(idx + keys[e.key] + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    const target = next.value;
    Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []).find((b) => b.dataset.value === target)?.focus();
  };

  const hasSelected = options.some((o) => o.value === value && !o.disabled);
  return (
    <div ref={ref} role="radiogroup" aria-label={aria['aria-label']} className={`segmented ${size === 'sm' ? 'sm' : ''} ${block ? 'block' : ''} ${className}`} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const checked = o.value === value;
        const tabbable = checked || (!hasSelected && i === options.indexOf(enabled[0]));
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.iconOnly ? o.label : undefined}
            data-tip={o.iconOnly ? o.label : undefined}
            data-value={o.value}
            tabIndex={tabbable ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
          >
            {o.icon && <Icon name={o.icon} />}
            {!o.iconOnly && o.label}
          </button>
        );
      })}
    </div>
  );
}
