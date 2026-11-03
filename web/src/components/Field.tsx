/*
 * Form fields: Field (label/help/error wrapper), TextField, NumberField, Select, TextArea.
 * Labels sit above controls; help and error text are linked with aria-describedby.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { forwardRef, useEffect, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';

interface FieldChrome {
  label?: ReactNode;
  help?: ReactNode;
  /** error message; sets aria-invalid on the control */
  error?: ReactNode;
  required?: boolean;
  className?: string;
}

interface FieldProps extends FieldChrome {
  /** id of the control the label points to */
  htmlFor?: string;
  helpId?: string;
  errorId?: string;
  children: ReactNode;
}

export function Field({ label, help, error, required, htmlFor, helpId, errorId, className = '', children }: FieldProps) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required && (
            <span className="req" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <span className="field-error" id={errorId}>
          <Icon name="error" />
          {error}
        </span>
      ) : (
        help && (
          <span className="field-hint" id={helpId}>
            {help}
          </span>
        )
      )}
    </div>
  );
}

function useFieldIds(id: string | undefined, help: ReactNode, error: ReactNode) {
  const auto = useId();
  const base = id ?? auto;
  const helpId = `${base}-help`;
  const errorId = `${base}-err`;
  const describedBy = error ? errorId : help ? helpId : undefined;
  return { id: base, helpId, errorId, describedBy };
}

export interface TextFieldProps extends FieldChrome, Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  iconStart?: string;
  /** short trailing text or icon name, e.g. "%" or 'search' */
  suffix?: ReactNode;
  size?: 'sm' | 'md';
  mono?: boolean;
  inputClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, help, error, required, className, iconStart, suffix, size = 'md', mono, id, inputClassName = '', ...rest },
  ref,
) {
  const ids = useFieldIds(id, help, error);
  const input = (
    <input
      ref={ref}
      id={ids.id}
      className={`input ${size === 'sm' ? 'input-sm' : ''} ${mono ? 'mono' : ''} ${inputClassName}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={ids.describedBy}
      required={required}
      {...rest}
    />
  );
  return (
    <Field label={label} help={help} error={error} required={required} htmlFor={ids.id} helpId={ids.helpId} errorId={ids.errorId} className={className}>
      {iconStart || suffix ? (
        <div className={`input-wrap ${iconStart ? 'has-start' : ''} ${suffix ? 'has-end' : ''}`}>
          {iconStart && (
            <span className="adorn start">
              <Icon name={iconStart} />
            </span>
          )}
          {input}
          {suffix && <span className="adorn end">{suffix}</span>}
        </div>
      ) : (
        input
      )}
    </Field>
  );
});

export interface NumberFieldProps extends FieldChrome, Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size' | 'min' | 'max' | 'step' | 'type'> {
  value: number | null;
  onValueChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** decimal separator for display and parsing (default '.') */
  decimalSeparator?: '.' | ',';
  /** show ▲▼ stepper buttons (default true) */
  steppers?: boolean;
  size?: 'sm' | 'md';
  incrementLabel?: string;
  decrementLabel?: string;
}

function fmt(v: number | null, sep: string) {
  return v == null ? '' : String(v).replace('.', sep);
}

export function parseNumber(text: string): number | null {
  const t = text.trim().replace(/\s/g, '').replace(',', '.');
  if (t === '' || t === '-' || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  { label, help, error, required, className, value, onValueChange, min, max, step = 1, decimalSeparator = '.', steppers = true, size = 'md', id, disabled, incrementLabel = 'Increase', decrementLabel = 'Decrease', onBlur, onKeyDown, ...rest },
  ref,
) {
  const ids = useFieldIds(id, help, error);
  const [text, setText] = useState(fmt(value, decimalSeparator));
  useEffect(() => setText(fmt(value, decimalSeparator)), [value, decimalSeparator]);

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const commit = (n: number | null) => {
    const v = n == null ? null : clamp(n);
    setText(fmt(v, decimalSeparator));
    if (v !== value) onValueChange(v);
  };
  const bump = (dir: 1 | -1) => {
    const decimals = (String(step).split('.')[1] ?? '').length;
    const next = Number(((value ?? parseNumber(text) ?? 0) + dir * step).toFixed(decimals));
    commit(next);
  };

  return (
    <Field label={label} help={help} error={error} required={required} htmlFor={ids.id} helpId={ids.helpId} errorId={ids.errorId} className={className}>
      <div className={`input-wrap number-field ${steppers ? 'has-steppers' : ''}`}>
        <input
          ref={ref}
          id={ids.id}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          aria-valuenow={value ?? undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          className={`input num ${size === 'sm' ? 'input-sm' : ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          required={required}
          disabled={disabled}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => {
            commit(parseNumber(text));
            onBlur?.(e);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              bump(e.key === 'ArrowUp' ? 1 : -1);
            } else if (e.key === 'Enter') commit(parseNumber(text));
            onKeyDown?.(e);
          }}
          {...rest}
        />
        {steppers && (
          <span className="steppers">
            <button type="button" tabIndex={-1} aria-label={incrementLabel} disabled={disabled || (max != null && (value ?? -Infinity) >= max)} onClick={() => bump(1)}>
              <Icon name="keyboard_arrow_up" />
            </button>
            <button type="button" tabIndex={-1} aria-label={decrementLabel} disabled={disabled || (min != null && (value ?? Infinity) <= min)} onClick={() => bump(-1)}>
              <Icon name="keyboard_arrow_down" />
            </button>
          </span>
        )}
      </div>
    </Field>
  );
});

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends FieldChrome, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  options?: SelectOption[];
  size?: 'sm' | 'md';
}

/** Native <select> (best keyboard + screen-reader support), styled. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, help, error, required, className, options, size = 'md', id, children, ...rest }, ref) {
  const ids = useFieldIds(id, help, error);
  return (
    <Field label={label} help={help} error={error} required={required} htmlFor={ids.id} helpId={ids.helpId} errorId={ids.errorId} className={className}>
      <select ref={ref} id={ids.id} className={`select ${size === 'sm' ? 'input-sm' : ''}`} aria-invalid={error ? true : undefined} aria-describedby={ids.describedBy} required={required} {...rest}>
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
    </Field>
  );
});

export interface TextAreaProps extends FieldChrome, TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ label, help, error, required, className, mono, id, ...rest }, ref) {
  const ids = useFieldIds(id, help, error);
  return (
    <Field label={label} help={help} error={error} required={required} htmlFor={ids.id} helpId={ids.helpId} errorId={ids.errorId} className={className}>
      <textarea ref={ref} id={ids.id} className={`textarea ${mono ? 'mono' : ''}`} aria-invalid={error ? true : undefined} aria-describedby={ids.describedBy} required={required} {...rest} />
    </Field>
  );
});
