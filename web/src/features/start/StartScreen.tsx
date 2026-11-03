/*
 * Start screen (template gallery): blank dataset, samples, open file, recent files.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { clearAutosave, getAutosave, getRecent, newDataset, newSyntax, openFileDialog, openRecent, openSample, restoreAutosave, type AutosaveState, type RecentFile, type SampleId } from '../../app/files';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { useSettings } from '../../store/settings';

const SAMPLES: { id: SampleId; icon: string; tone: string }[] = [
  { id: 'students', icon: 'school', tone: 'blue' },
  { id: 'employees', icon: 'badge', tone: 'green' },
  { id: 'trial', icon: 'monitor_heart', tone: 'purple' },
];

function Thumb({ tone, icon }: { tone: string; icon: string }) {
  return (
    <div className={`tpl-thumb tone-${tone}`} aria-hidden="true">
      <div className="tpl-sheet">
        <div className="tpl-head" />
        {[0, 1, 2, 3, 4].map((r) => (
          <div key={r} className="tpl-row">
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
      <span className="tpl-badge">
        <Icon name={icon} />
      </span>
    </div>
  );
}

function sizeText(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function StartScreen() {
  const { t, i18n } = useTranslation();
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [autosave, setAutosave] = useState<AutosaveState | undefined>();
  const hasData = useData((s) => !!s.dataset);
  const setShowStart = useUi((s) => s.setShowStart);
  const name = useSettings((s) => s.profile.name);

  useEffect(() => {
    const load = () => void getRecent().then(setRecent);
    load();
    void getAutosave().then(setAutosave);
    window.addEventListener('pspp-recent-changed', load);
    return () => window.removeEventListener('pspp-recent-changed', load);
  }, []);

  const fmtTime = (ms: number) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);

  return (
    <div className="start">
      <section className="start-gallery">
        <div className="start-inner">
          <div className="start-head">
            <div>
              <h1>{t('start.greeting', { name: name.split(' ')[0] })}</h1>
              <p>{t('start.subtitle')}</p>
            </div>
            {hasData && (
              <button type="button" className="btn btn-tonal" onClick={() => setShowStart(false)}>
                <Icon name="arrow_back" />
                {t('start.backToData')}
              </button>
            )}
          </div>
          <h2 className="start-section-title">{t('start.newTitle')}</h2>
          <div className="tpl-grid">
            <button type="button" className="tpl" onClick={newDataset}>
              <div className="tpl-thumb blank" aria-hidden="true">
                <Icon name="add" size={56} />
              </div>
              <span className="tpl-name">{t('start.blank')}</span>
              <span className="tpl-desc">{t('start.blankDesc')}</span>
            </button>
            {SAMPLES.map((s) => (
              <button key={s.id} type="button" className="tpl" onClick={() => void openSample(s.id)}>
                <Thumb tone={s.tone} icon={s.icon} />
                <span className="tpl-name">{t(`samples.${s.id}.title`)}</span>
                <span className="tpl-desc">{t(`samples.${s.id}.desc`)}</span>
              </button>
            ))}
            <button type="button" className="tpl" onClick={() => void openFileDialog()}>
              <div className="tpl-thumb open" aria-hidden="true">
                <Icon name="upload_file" size={48} />
              </div>
              <span className="tpl-name">{t('start.open')}</span>
              <span className="tpl-desc">{t('start.openDesc')}</span>
            </button>
            <button type="button" className="tpl" onClick={newSyntax}>
              <div className="tpl-thumb code" aria-hidden="true">
                <code>
                  FREQUENCIES
                  <br />
                  &nbsp;&nbsp;/VARIABLES=…
                </code>
              </div>
              <span className="tpl-name">{t('start.syntax')}</span>
              <span className="tpl-desc">{t('start.syntaxDesc')}</span>
            </button>
          </div>
        </div>
      </section>
      <section className="start-recent">
        <div className="start-inner">
          {autosave && (autosave.dataset || autosave.tabs?.some((x) => x.text.trim())) && !hasData && (
            <div className="resume-card">
              <Icon name="history" />
              <div className="resume-text">
                <strong>{t('start.resumeTitle', { name: autosave.title || t('files.untitled') })}</strong>
                <span>{t('start.resumeText', { time: fmtTime(autosave.time) })}</span>
              </div>
              <button type="button" className="btn btn-filled" onClick={() => restoreAutosave(autosave)}>
                {t('start.resume')}
              </button>
              <IconButton
                icon="close"
                small
                label={t('start.discardAutosave')}
                onClick={() => {
                  void clearAutosave();
                  setAutosave(undefined);
                }}
              />
            </div>
          )}
          <div className="recent-head">
            <h2 className="start-section-title">{t('start.recent')}</h2>
          </div>
          {recent.length === 0 ? (
            <div className="recent-empty">
              <Icon name="folder_open" />
              <p>{t('start.recentEmpty')}</p>
              <p className="drop-hint">{t('start.dropHint')}</p>
            </div>
          ) : (
            <ul className="recent-list">
              {recent.map((r) => (
                <li key={r.id}>
                  <button type="button" className="recent-item" onClick={() => void openRecent(r)} disabled={!r.stored}>
                    <Icon name={r.kind === 'syntax' ? 'code' : 'table'} className={`recent-icon ${r.kind}`} />
                    <span className="recent-name">{r.name}</span>
                    <span className="recent-meta">{sizeText(r.size)}</span>
                    <span className="recent-meta">{fmtTime(r.time)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
