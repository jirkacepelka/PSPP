/*
 * Accessible modal dialog with focus trap.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { useTranslation } from 'react-i18next';

interface DialogProps {
  title: string;
  icon?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'small' | 'normal' | 'wide' | 'xwide';
  className?: string;
  headerExtra?: ReactNode;
  initialFocus?: string;
  bodyClassName?: string;
}

export function Dialog({ title, icon, onClose, children, footer, size = 'normal', className = '', headerExtra, initialFocus, bodyClassName = '' }: DialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    prevFocus.current = document.activeElement as HTMLElement;
    const el = ref.current;
    const target = (initialFocus && el?.querySelector<HTMLElement>(initialFocus)) || el?.querySelector<HTMLElement>('[data-autofocus]') || el?.querySelector<HTMLElement>('.dialog-body input, .dialog-body select, .dialog-body textarea, .dialog-body button, .dialog-body [tabindex="0"]');
    (target ?? el)?.focus({ preventScroll: true });
    return () => {
      prevFocus.current?.focus?.({ preventScroll: true });
    };
  }, [initialFocus]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      const nodes = Array.from(
        ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [],
      ).filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return createPortal(
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`dialog ${size} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="dialog-header">
          {icon && <Icon name={icon} className="dialog-icon" />}
          <h2 id={id}>{title}</h2>
          {headerExtra}
          <IconButton icon="close" label={t('common.close')} onClick={onClose} tip={false} />
        </div>
        <div className={`dialog-body ${bodyClassName}`}>{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
