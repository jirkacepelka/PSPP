/*
 * Button — primary / secondary / ghost / danger, three sizes, icon slots, loading state.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Material Symbols name or a custom node shown before the label */
  iconStart?: string | ReactNode;
  /** shown after the label (e.g. 'expand_more' for a menu trigger) */
  iconEnd?: string | ReactNode;
  /** shows a spinner, sets aria-busy and blocks clicks */
  loading?: boolean;
  /** full-width */
  block?: boolean;
}

function slot(x: string | ReactNode) {
  return typeof x === 'string' ? <Icon name={x} /> : x;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', iconStart, iconEnd, loading, block, className = '', children, disabled, onClick, type = 'button', ...rest },
  ref,
) {
  const cls = ['btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', !children && 'btn-icon-only', className].filter(Boolean).join(' ');
  return (
    <button
      ref={ref}
      type={type}
      className={cls}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {loading ? <Spinner /> : iconStart != null && slot(iconStart)}
      {children != null && <span className="btn-label">{children}</span>}
      {iconEnd != null && slot(iconEnd)}
    </button>
  );
});

/** Indeterminate progress ring; inherits currentColor. */
export function Spinner({ size = 'md', label }: { size?: 'md' | 'lg'; label?: string }) {
  return <span className={`loader ${size === 'lg' ? 'lg' : ''}`} role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
