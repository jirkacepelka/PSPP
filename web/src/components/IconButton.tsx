/* SPDX-License-Identifier: GPL-3.0-or-later */
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  label: string;
  pressed?: boolean;
  small?: boolean;
  filled?: boolean;
  tip?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { icon, label, pressed, small, filled, tip = true, className = '', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`icon-btn ${small ? 'sm' : ''} ${className}`}
      aria-label={label}
      aria-pressed={pressed}
      data-tip={tip ? label : undefined}
      {...rest}
    >
      <Icon name={icon} filled={filled ?? pressed} />
    </button>
  );
});
