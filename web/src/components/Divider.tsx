/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { ReactNode } from 'react';

/** Hairline separator. With `label`, renders "—— label ——". */
export function Divider({ orientation = 'horizontal', label, className = '' }: { orientation?: 'horizontal' | 'vertical'; label?: ReactNode; className?: string }) {
  if (label) {
    return (
      <div className={`divider-labeled ${className}`} role="separator">
        {label}
      </div>
    );
  }
  return <div className={`divider ${orientation === 'vertical' ? 'vertical' : ''} ${className}`} role="separator" aria-orientation={orientation} />;
}
