/*
 * Checkbox, Switch and RadioGroup — native inputs, custom-drawn, fully keyboard accessible.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, type InputHTMLAttributes, type ReactNode } from 'react';

interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
}

export interface CheckboxProps extends ChoiceProps {
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, description, indeterminate, className = '', id, ...rest }, ref) {
  const inner = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLInputElement);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  const auto = useId();
  const descId = description ? `${id ?? auto}-desc` : undefined;
  return (
    <label className={`check ${className}`}>
      <input ref={inner} type="checkbox" id={id} aria-describedby={descId} aria-checked={indeterminate ? 'mixed' : undefined} {...rest} />
      <span className="check-text">
        <span>{label}</span>
        {description && (
          <small id={descId} className="check-desc">
            {description}
          </small>
        )}
      </span>
    </label>
  );
});

export interface SwitchProps extends ChoiceProps {
  /** label left of the track (settings rows) — default; `inline` puts the track first */
  inline?: boolean;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch({ label, description, inline, className = '', id, ...rest }, ref) {
  const auto = useId();
  const descId = description ? `${id ?? auto}-desc` : undefined;
  const input = <input ref={ref} type="checkbox" role="switch" id={id} aria-describedby={descId} {...rest} />;
  const text = (
    <span className="switch-text">
      <span>{label}</span>
      {description && <small id={descId}>{description}</small>}
    </span>
  );
  return (
    <label className={`switch ${inline ? 'inline' : ''} ${className}`}>
      {inline ? (
        <>
          {input}
          {text}
        </>
      ) : (
        <>
          {text}
          {input}
        </>
      )}
    </label>
  );
});

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

interface RadioGroupProps<T extends string> {
  legend: ReactNode;
  /** visually hide the legend (it stays available to screen readers) */
  hideLegend?: boolean;
  name?: string;
  options: RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}

export function RadioGroup<T extends string>({ legend, hideLegend, name, options, value, onChange, orientation = 'vertical', className = '' }: RadioGroupProps<T>) {
  const auto = useId();
  const groupName = name ?? auto;
  return (
    <fieldset className={`radio-group ${orientation} ${className}`}>
      <legend className={hideLegend ? 'sr-only' : undefined}>{legend}</legend>
      <div className="radio-options">
        {options.map((o) => (
          <label key={o.value} className="radio">
            <input type="radio" name={groupName} value={o.value} checked={o.value === value} disabled={o.disabled} onChange={() => onChange(o.value)} />
            <span className="check-text">
              <span>{o.label}</span>
              {o.description && <small className="check-desc">{o.description}</small>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
