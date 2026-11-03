/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi } from '../store/ui';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

const LEAD: Partial<Record<ToastKind, string>> = { error: 'error', success: 'check_circle', warning: 'warning' };

/** One toast (presentational). The live stack is <Toasts/>, fed by useUi().toast(). */
export function Toast({ kind, message, action, onClose, closeLabel, static: isStatic }: { kind?: ToastKind; message: ReactNode; action?: { label: string; run: () => void }; onClose?: () => void; closeLabel: string; static?: boolean }) {
  const lead = kind ? LEAD[kind] : undefined;
  return (
    <div className={`toast ${kind ?? ''} ${isStatic ? 'static' : ''}`}>
      {lead && <Icon name={lead} className="lead" />}
      <span className="toast-msg">{message}</span>
      {action && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={action.run}>
          {action.label}
        </button>
      )}
      {onClose && <IconButton icon="close" label={closeLabel} small tip={false} onClick={onClose} />}
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const { t } = useTranslation();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <Toast
          key={x.id}
          kind={x.kind as ToastKind | undefined}
          message={x.message}
          closeLabel={t('common.close')}
          onClose={() => dismiss(x.id)}
          action={
            x.action
              ? {
                  label: x.action.label,
                  run: () => {
                    x.action!.run();
                    dismiss(x.id);
                  },
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}
