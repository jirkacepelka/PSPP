/*
 * Badge (small status label) and Counter (numeric count).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { ReactNode } from 'react';
import { Icon } from './Icon';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export function Badge({ tone = 'neutral', icon, children, className = '' }: { tone?: Tone; icon?: string; children: ReactNode; className?: string }) {
  return (
    <span className={`badge ${tone !== 'neutral' ? `tone-${tone}` : ''} ${className}`}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}

export function Counter({ count, max = 99, tone = 'neutral', label, className = '' }: { count: number; max?: number; tone?: 'neutral' | 'accent' | 'danger'; label?: string; className?: string }) {
  const text = count > max ? `${max}+` : String(count);
  return (
    <span className={`counter ${tone !== 'neutral' ? tone : ''} ${className}`} aria-label={label ? `${label}: ${count}` : undefined}>
      {text}
    </span>
  );
}
