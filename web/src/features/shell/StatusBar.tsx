/* SPDX-License-Identifier: GPL-3.0-or-later */
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { caseCount } from '../../lib/variables';

export function StatusBar() {
  const { t } = useTranslation();
  const ds = useData((s) => s.dataset);
  const status = useUi((s) => s.engineStatus);
  const kind = useUi((s) => s.engineKind);
  const version = useUi((s) => s.engineVersion);
  const n = caseCount(ds);
  return (
    <footer className="statusbar" role="contentinfo">
      {ds ? (
        <>
          <span>{t('status.cases', { count: n })}</span>
          <span className="status-vars">{t('status.variables', { count: ds.variables.length })}</span>
          {ds.filter && (
            <span className="status-flag">
              <Icon name="filter_alt" size={14} />
              {t('status.filterOn', { var: ds.filter })}
            </span>
          )}
          {ds.weight && (
            <span className="status-flag">
              <Icon name="scale" size={14} />
              {t('status.weightOn', { var: ds.weight })}
            </span>
          )}
          {!!ds.split?.length && (
            <span className="status-flag">
              <Icon name="call_split" size={14} />
              {t('status.splitOn', { vars: ds.split.join(', ') })}
            </span>
          )}
        </>
      ) : (
        <span>{t('status.noData')}</span>
      )}
      <span className="spacer" />
      <span className={`engine-status ${status}`} title={version} role="status" aria-live="polite">
        <span className="dot" aria-hidden="true" />
        {t(`engine.${status}`)}
        {kind === 'mock' && status !== 'loading' && <span className="badge">{t('engine.demo')}</span>}
      </span>
    </footer>
  );
}
