/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { ReactNode } from 'react';
import { Icon } from './Icon';

/** Explains why an area is empty and what to do next. Keep the title short and the description one sentence. */
export function EmptyState({ icon, title, description, actions, compact, className = '' }: { icon?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode; compact?: boolean; className?: string }) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''} ${className}`}>
      {icon && (
        <span className="empty-state-icon">
          <Icon name={icon} />
        </span>
      )}
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-desc">{description}</p>}
      {actions && <div className="empty-state-actions">{actions}</div>}
    </div>
  );
}
