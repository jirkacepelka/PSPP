/*
 * IconButton — square icon-only button. `label` is required: it becomes aria-label and the tooltip.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  /** accessible name and tooltip text (required) */
  label: string;
  /** toggle state → aria-pressed */
  pressed?: boolean;
  small?: boolean;
  filled?: boolean;
  /** show the CSS tooltip (default true) */
  tip?: boolean;
  /** shortcut appended to the tooltip, e.g. "Ctrl+S" */
  shortcut?: string;
  tipPlacement?: 'bottom' | 'top';
  variant?: 'ghost' | 'secondary' | 'primary';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, pressed, small, filled, tip = true, shortcut, tipPlacement, variant = 'ghost', className = '', ...rest },
  ref,
) {
  const cls = ['icon-btn', small && 'sm', variant !== 'ghost' && variant, className].filter(Boolean).join(' ');
  return (
    <button
      ref={ref}
      type="button"
      className={cls}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut || undefined}
      data-tip={tip ? (shortcut ? `${label} (${shortcut})` : label) : undefined}
      data-tip-placement={tip && tipPlacement === 'top' ? 'top' : undefined}
      {...rest}
    >
      <Icon name={icon} filled={filled ?? pressed} />
    </button>
  );
});
