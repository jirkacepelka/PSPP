/*
 * Start screen as an on-ramp (audit ST-1, ST-2, F16): open a file first, start blank or with
 * syntax, try a sample through guided questions, restore the last session, reopen recent files.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { Kbd } from '../../components/Kbd';
import { formatShortcut } from '../../app/actions';
import { clearAutosave, getAutosave, getRecent, newDataset, newSyntax, openFileDialog, openRecent, openSample, removeRecent, restoreAutosave, type AutosaveState, type RecentFile, type SampleId } from '../../app/files';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { SPECS_BY_ID } from '../dialogs/specs';
import { GUIDED_TASKS, runGuidedTask } from './guidedTasks';
import './start.css';

const SAMPLES: { id: SampleId; icon: string; n: number; vars: number }[] = [
  { id: 'students', icon: 'school', n: 120, vars: 12 },
  { id: 'employees', icon: 'badge', n: 200, vars: 11 },
  { id: 'trial', icon: 'monitor_heart', n: 60, vars: 9 },
];

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
  const title = useData((s) => s.title);
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
  const showResume = autosave && (autosave.dataset || autosave.tabs?.some((x) => x.text.trim())) && !hasData;

  return (
    <div className="st">
      <div className="st-inner">
        <header className="st-hero">
          <div>
            <h2 className="st-title">{name ? t('start.greeting', { name: name.split(' ')[0] }) : t('start.greetingAnon')}</h2>
            <p className="st-sub">{t('start.subtitle')}</p>
          </div>
          {hasData && (
            <Button variant="primary" iconStart="arrow_back" onClick={() => setShowStart(false)} className="st-back">
              {t('shell.start.backTo', { name: title })}
            </Button>
          )}
        </header>

        {showResume && (
          <div className="st-resume" role="region" aria-label={t('start.resume')}>
            <Icon name="history" />
            <div className="st-resume-text">
              <strong>{t('start.resumeTitle', { name: autosave!.title || t('files.untitled') })}</strong>
              <span>{t('start.resumeText', { time: fmtTime(autosave!.time) })}</span>
            </div>
            <Button variant="primary" onClick={() => restoreAutosave(autosave!)}>
              {t('start.resume')}
            </Button>
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

        <section className="st-section" aria-labelledby="st-begin">
          <h3 id="st-begin" className="st-h">
            {t('shell.start.begin')}
          </h3>
          <div className="st-begin">
            <button type="button" className="st-open" onClick={() => void openFileDialog()}>
              <span className="st-open-icon">
                <Icon name="upload_file" size={28} />
              </span>
              <span className="st-open-text">
                <span className="st-tile-title">{t('start.open')}</span>
                <span className="st-tile-desc">{t('shell.start.openDesc')}</span>
                <span className="st-formats">.sav · .zsav · .por · .csv · .ods · .sps</span>
              </span>
              <span className="st-open-kbd">
                <Kbd keys={formatShortcut('Mod+O').split('+')} />
              </span>
            </button>
            <button type="button" className="st-tile" onClick={newDataset}>
              <Icon name="table" />
              <span className="st-tile-title">{t('start.blank')}</span>
              <span className="st-tile-desc">{t('start.blankDesc')}</span>
            </button>
            <button type="button" className="st-tile" onClick={newSyntax}>
              <Icon name="code" />
              <span className="st-tile-title">{t('shell.start.syntax')}</span>
              <span className="st-tile-desc">{t('start.syntaxDesc')}</span>
            </button>
          </div>
        </section>

        <div className="st-columns">
          <section className="st-section st-samples" aria-labelledby="st-try">
            <h3 id="st-try" className="st-h">
              {t('shell.start.try')}
            </h3>
            <p className="st-hint">{t('shell.start.tryHint')}</p>
            <div className="st-sample-list">
              {SAMPLES.map((s) => (
                <article key={s.id} className="st-sample" aria-labelledby={`st-s-${s.id}`}>
                  <div className="st-sample-head">
                    <span className="st-sample-icon">
                      <Icon name={s.icon} />
                    </span>
                    <div className="st-sample-text">
                      <h4 id={`st-s-${s.id}`} className="st-sample-title">
                        {t(`samples.${s.id}.title`)}
                      </h4>
                      <span className="st-sample-desc">{t(`samples.${s.id}.desc`)}</span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => void openSample(s.id)}>
                      {t('shell.start.openSample')}
                    </Button>
                  </div>
                  <ul className="st-tasks">
                    {GUIDED_TASKS.filter((g) => g.sample === s.id).map((g) => (
                      <li key={g.id}>
                        <button type="button" className="st-task" onClick={() => runGuidedTask(g)}>
                          <Icon name={g.icon} size={18} />
                          <span className="st-task-q">{t(`${g.key}.q`)}</span>
                          <Badge className="st-task-method">{SPECS_BY_ID[g.specId] ? t(SPECS_BY_ID[g.specId].title).replace(/…$/, '') : t(`${g.key}.method`)}</Badge>
                          <Icon name="arrow_forward" size={16} className="st-task-go" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section className="st-section st-recent" aria-labelledby="st-recent">
            <h3 id="st-recent" className="st-h">
              {t('start.recent')}
            </h3>
            {recent.length === 0 ? (
              <EmptyState compact icon="folder_open" title={t('shell.start.recentEmptyTitle')} description={t('shell.start.recentEmptyDesc')} />
            ) : (
              <ul className="st-recent-list">
                {recent.map((r) => (
                  <li key={r.id} className="st-recent-row">
                    <button type="button" className="st-recent-item" onClick={() => void openRecent(r)} disabled={!r.stored} title={r.stored ? r.name : t('files.recentMissing', { name: r.name })}>
                      <Icon name={r.kind === 'syntax' ? 'code' : 'table'} />
                      <span className="st-recent-name">{r.name}</span>
                      <span className="st-recent-meta">
                        {sizeText(r.size)} · {fmtTime(r.time)}
                      </span>
                    </button>
                    <IconButton icon="close" small label={t('shell.start.removeRecent', { name: r.name })} onClick={() => void removeRecent(r.id)} />
                  </li>
                ))}
              </ul>
            )}
            <p className="st-privacy">
              <Icon name="lock" size={16} />
              {t('shell.start.privacy')}
            </p>
            <p className="st-tip">
              <Icon name="keyboard" size={16} />
              <span>
                {t('shell.start.tipSearch')} <Kbd keys={formatShortcut('Mod+K').split('+')} />
              </span>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
