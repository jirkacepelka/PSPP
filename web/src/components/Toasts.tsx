/* SPDX-License-Identifier: GPL-3.0-or-later */
import { useTranslation } from 'react-i18next';
import { useUi } from '../store/ui';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const { t } = useTranslation();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.kind ?? ''}`}>
          {x.kind === 'error' && <Icon name="error" className="lead" />}
          {x.kind === 'success' && <Icon name="check_circle" className="lead" />}
          <span className="toast-msg">{x.message}</span>
          {x.action && (
            <button
              type="button"
              className="btn btn-text"
              onClick={() => {
                x.action!.run();
                dismiss(x.id);
              }}
            >
              {x.action.label}
            </button>
          )}
          <IconButton icon="close" label={t('common.close')} small tip={false} onClick={() => dismiss(x.id)} />
        </div>
      ))}
    </div>
  );
}
