/* SPDX-License-Identifier: GPL-3.0-or-later */
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { useUi } from '../../store/ui';
import { GPL_URL, PSPP_URL, SOURCE_URL } from '../../app/help';
import { Button } from '../../components/Button';
import { LogoMark } from '../shell/Logo';
import './misc.css';

export function AboutContent() {
  const { t } = useTranslation();
  const version = useUi((s) => s.engineVersion);
  const kind = useUi((s) => s.engineKind);
  return (
    <div className="about">
      <div className="about-head">
        <LogoMark size={64} />
        <div>
          <div className="about-name">PSPP Studio</div>
          <div className="set-row-desc">{t('about.tagline')}</div>
        </div>
      </div>
      <p>{t('about.basedOn')}</p>
      <p>{t('about.license')}</p>
      <ul className="about-links">
        <li>
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="code" /> {t('about.source')}
          </a>
        </li>
        <li>
          <a href={PSPP_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="public" /> {t('about.pspp')}
          </a>
        </li>
        <li>
          <a href={GPL_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="gavel" /> {t('about.gpl')}
          </a>
        </li>
      </ul>
      <dl className="about-meta">
        <dt>{t('about.engine')}</dt>
        <dd>
          {version || '—'} {kind === 'mock' && <span className="badge">{t('engine.demo')}</span>}
        </dd>
        <dt>{t('about.privacy')}</dt>
        <dd>{t('about.privacyText')}</dd>
      </dl>
      <p className="about-small">{t('about.trademarks')}</p>
    </div>
  );
}

export function AboutDialog() {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  return (
    <Dialog title={t('actions.about')} icon="info" onClose={close} footer={<Button variant="primary" onClick={close}>{t('common.close')}</Button>}>
      <AboutContent />
    </Dialog>
  );
}
