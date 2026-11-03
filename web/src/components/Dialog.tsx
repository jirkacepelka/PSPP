/*
 * Dialog — modal with focus trap, Escape to close, focus restore, header/body/footer,
 * sizes small · normal · wide · xwide, and full-screen layout on phones (≤600px).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { getFocusable, trapTab } from './focus';

export type DialogSize = 'small' | 'normal' | 'wide' | 'xwide';

export interface DialogProps {
  title: string;
  /** one-line explanation under the title (linked via aria-describedby) */
  description?: ReactNode;
  icon?: string;
  onClose: () => void;
  children: ReactNode;
  /** actions; put the primary action last. Use <span className="spacer" /> to push items apart. */
  footer?: ReactNode;
  size?: DialogSize;
  className?: string;
  headerExtra?: ReactNode;
  /** CSS selector of the element to focus first */
  initialFocus?: string;
  bodyClassName?: string;
  /** close when the backdrop is clicked (default true) */
  closeOnScrim?: boolean;
  /** hide the × button (keep Escape working) */
  hideClose?: boolean;
}

export function Dialog({
  title,
  description,
  icon,
  onClose,
  children,
  footer,
  size = 'normal',
  className = '',
  headerExtra,
  initialFocus,
  bodyClassName = '',
  closeOnScrim = true,
  hideClose,
}: DialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    prevFocus.current = document.activeElement as HTMLElement;
    const el = ref.current;
    const target =
      (initialFocus && el?.querySelector<HTMLElement>(initialFocus)) ||
      el?.querySelector<HTMLElement>('[data-autofocus]') ||
      getFocusable(el?.querySelector<HTMLElement>('.dialog-body') ?? null)[0];
    (target ?? el)?.focus({ preventScroll: true });
    return () => {
      prevFocus.current?.focus?.({ preventScroll: true });
    };
  }, [initialFocus]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else trapTab(e, ref.current);
  };

  return createPortal(
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (closeOnScrim && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`dialog ${size} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="dialog-header">
          {icon && <Icon name={icon} className="dialog-icon" />}
          {description ? (
            <div className="dialog-heading">
              <h2 id={id}>{title}</h2>
              <p className="dialog-description" id={`${id}-desc`}>
                {description}
              </p>
            </div>
          ) : (
            <h2 id={id}>{title}</h2>
          )}
          {headerExtra}
          {!hideClose && <IconButton icon="close" label={t('common.close')} onClick={onClose} tip={false} />}
        </div>
        <div className={`dialog-body ${bodyClassName}`}>{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
