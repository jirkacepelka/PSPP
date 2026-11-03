/*
 * Toast region (audit A-7): wraps the design-system <Toast> so toasts pause while hovered or
 * focused, errors are announced assertively, and the region is reachable with F6.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useTranslation } from 'react-i18next';
import { Toast, type ToastKind } from '../../components/Toasts';
import { useUi, type Toast as ToastData } from '../../store/ui';

function ToastItem({ x }: { x: ToastData }) {
  const { t } = useTranslation();
  const dismiss = useUi((s) => s.dismissToast);
  const hold = useUi((s) => s.holdToast);
  const close = () => {
    hold(x.id, false);
    dismiss(x.id);
  };
  return (
    <div className="sh-toast-hold" onMouseEnter={() => hold(x.id, true)} onMouseLeave={() => hold(x.id, false)} onFocus={() => hold(x.id, true)} onBlur={() => hold(x.id, false)}>
      <Toast
        kind={x.kind as ToastKind | undefined}
        message={x.message}
        closeLabel={t('common.close')}
        onClose={close}
        action={
          x.action
            ? {
                label: x.action.label,
                run: () => {
                  x.action!.run();
                  close();
                },
              }
            : undefined
        }
      />
    </div>
  );
}

export function ShellToasts() {
  const toasts = useUi((s) => s.toasts);
  const { t } = useTranslation();
  return (
    <section className="toasts sh-toasts" aria-label={t('shell.notifications')} tabIndex={-1} data-f6-region>
      <div role="status" aria-live="polite" className="sh-toast-stack">
        {toasts
          .filter((x) => x.kind !== 'error')
          .map((x) => (
            <ToastItem key={x.id} x={x} />
          ))}
      </div>
      <div role="alert" className="sh-toast-stack">
        {toasts
          .filter((x) => x.kind === 'error')
          .map((x) => (
            <ToastItem key={x.id} x={x} />
          ))}
      </div>
    </section>
  );
}
