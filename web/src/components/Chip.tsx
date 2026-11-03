/*
 * Chips — compact 4px-radius tags.
 *   <Chip>            generic tag (optionally clickable or removable)
 *   <ValueLabelChip>  value + label pair, e.g. 1 │ Male
 *   <StatusChip>      tinted state with a dot (success / warning / danger / info / accent)
 *   <FilterChip>      toggle (aria-pressed), optionally removable
 *   <MeasureChip>     measurement level icon + label (nominal / ordinal / scale / string)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { MouseEvent, ReactNode } from 'react';
import { Icon } from './Icon';
import type { Tone } from './Badge';

function RemoveButton({ label, onRemove }: { label: string; onRemove: (e: MouseEvent) => void }) {
  return (
    <button type="button" className="chip-remove" aria-label={label} onClick={onRemove}>
      <Icon name="close" />
    </button>
  );
}

export interface ChipProps {
  icon?: string;
  children: ReactNode;
  onClick?: () => void;
  onRemove?: () => void;
  /** accessible name of the remove button, e.g. "Remove filter gender" */
  removeLabel?: string;
  title?: string;
  className?: string;
}

export function Chip({ icon, children, onClick, onRemove, removeLabel = 'Remove', title, className = '' }: ChipProps) {
  const body = (
    <>
      {icon && <Icon name={icon} />}
      <span className="chip-text">{children}</span>
    </>
  );
  if (onClick && !onRemove) {
    return (
      <button type="button" className={`chip ${className}`} onClick={onClick} title={title}>
        {body}
      </button>
    );
  }
  return (
    <span className={`chip ${className}`} title={title}>
      {body}
      {onRemove && <RemoveButton label={removeLabel} onRemove={onRemove} />}
    </span>
  );
}

export function ValueLabelChip({ value, label, missing, title, className = '' }: { value: ReactNode; label?: ReactNode; missing?: boolean; title?: string; className?: string }) {
  return (
    <span className={`chip chip-value ${missing ? 'missing' : ''} ${className}`} title={title}>
      <span className="chip-code">{value}</span>
      {label != null && label !== '' && <span className="chip-text">{label}</span>}
    </span>
  );
}

export function StatusChip({ tone = 'neutral', icon, dot = true, children, className = '' }: { tone?: Tone; icon?: string; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={`chip chip-status ${tone !== 'neutral' ? `tone-${tone}` : ''} ${dot && !icon ? '' : 'no-dot'} ${className}`}>
      {icon && <Icon name={icon} />}
      <span className="chip-text">{children}</span>
    </span>
  );
}

export interface FilterChipProps {
  selected: boolean;
  onToggle?: (next: boolean) => void;
  onRemove?: () => void;
  removeLabel?: string;
  icon?: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function FilterChip({ selected, onToggle, onRemove, removeLabel = 'Remove', icon, children, disabled, className = '' }: FilterChipProps) {
  const lead = selected ? <Icon name="check" /> : icon ? <Icon name={icon} /> : null;
  if (!onRemove) {
    return (
      <button type="button" className={`chip chip-filter ${selected ? 'on' : ''} ${className}`} aria-pressed={selected} disabled={disabled} onClick={() => onToggle?.(!selected)}>
        {lead}
        <span className="chip-text">{children}</span>
      </button>
    );
  }
  return (
    <span className={`chip chip-filter ${selected ? 'on' : ''} ${className}`}>
      {onToggle ? (
        <button type="button" className="chip-main" aria-pressed={selected} disabled={disabled} onClick={() => onToggle(!selected)}>
          {lead}
          <span className="chip-text">{children}</span>
        </button>
      ) : (
        <>
          {lead}
          <span className="chip-text">{children}</span>
        </>
      )}
      <RemoveButton label={removeLabel} onRemove={onRemove} />
    </span>
  );
}

export type Measure = 'nominal' | 'ordinal' | 'scale' | 'string';

/** Icon names per measurement level (same glyphs as app/varIcons.ts). */
export const MEASURE_ICONS: Record<Measure, string> = {
  nominal: 'category',
  ordinal: 'signal_cellular_alt',
  scale: 'straighten',
  string: 'text_fields',
};

/** Measurement level marker. `label` is the visible text (or the tooltip/aria-label when iconOnly). */
export function MeasureChip({ measure, label, iconOnly, className = '' }: { measure: Measure; label: string; iconOnly?: boolean; className?: string }) {
  return (
    <span
      className={`chip chip-measure ${iconOnly ? 'icon-only' : ''} ${className}`}
      data-measure={measure}
      title={iconOnly ? label : undefined}
      role={iconOnly ? 'img' : undefined}
      aria-label={iconOnly ? label : undefined}
    >
      <Icon name={MEASURE_ICONS[measure]} />
      {!iconOnly && <span className="chip-text">{label}</span>}
    </span>
  );
}

/** Bare coloured measure glyph for dense lists (variable pickers, grid headers). */
export function MeasureIcon({ measure, size }: { measure: Measure; size?: number }) {
  return (
    <span className="measure-icon" data-measure={measure}>
      <Icon name={MEASURE_ICONS[measure]} size={size} />
    </span>
  );
}
