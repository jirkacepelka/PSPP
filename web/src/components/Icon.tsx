/* SPDX-License-Identifier: GPL-3.0-or-later */
export function Icon({ name, filled, className = '', size }: { name: string; filled?: boolean; className?: string; size?: number }) {
  return (
    <span className={`icon ${filled ? 'filled' : ''} ${className}`} aria-hidden="true" style={size ? { fontSize: size } : undefined}>
      {name}
    </span>
  );
}
