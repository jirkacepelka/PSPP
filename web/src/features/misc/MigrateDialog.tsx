/*
 * Shown once after signing in: choose which documents and settings from this browser move to the
 * account. Documents that are not chosen simply stay in this browser.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, RadioGroup } from '../../components';
import { Dialog } from '../../components/Dialog';
import { Spinner } from '../../components/Button';
import { runMigration, type MigrationPlan, type SettingsChoice } from '../../app/cloud';
import { useUi } from '../../store/ui';
import './misc.css';

export function MigrateDialog({ plan }: { plan: MigrationPlan }) {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(plan.docs.map((d) => d.id)));
  const showSettings = plan.cloudHasSettings || plan.localSettings;
  const [settings, setSettings] = useState<SettingsChoice>(plan.cloudHasSettings ? 'download' : plan.localSettings ? 'upload' : 'none');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOn = picked.size === plan.docs.length;

  const go = async () => {
    setProgress({ done: 0, total: picked.size });
    await runMigration([...picked], settings, (done, total) => setProgress({ done, total }));
    close();
  };
  const skip = async () => {
    await runMigration([], 'none');
    close();
  };
  const busy = !!progress;

  const settingsOptions: { value: SettingsChoice; label: string; description?: string }[] = plan.cloudHasSettings
    ? [
        { value: 'download', label: t('migrate.useAccountSettings'), description: t('migrate.useAccountSettingsHelp') },
        { value: 'upload', label: t('migrate.replaceAccountSettings'), description: t('migrate.replaceAccountSettingsHelp') },
        { value: 'none', label: t('migrate.keepSeparate') },
      ]
    : [
        { value: 'upload', label: t('migrate.saveSettings'), description: t('migrate.saveSettingsHelp') },
        { value: 'none', label: t('migrate.keepSeparate') },
      ];

  return (
    <Dialog
      title={t('migrate.title')}
      description={t('migrate.intro')}
      icon="cloud_upload"
      size="normal"
      onClose={busy ? () => undefined : close}
      hideClose={busy}
      footer={
        <>
          {busy && (
            <span className="mig-progress" role="status">
              <Spinner /> {t('migrate.progress', { done: progress!.done, total: progress!.total })}
            </span>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => void skip()} disabled={busy}>{t('migrate.skip')}</button>
          <button type="button" className="btn btn-primary" onClick={() => void go()} disabled={busy}>{t('migrate.go')}</button>
        </>
      }
    >
      {plan.docs.length > 0 && (
        <section className="mig-section" aria-labelledby="mig-docs">
          <div className="mig-head">
            <h3 id="mig-docs">{t('migrate.docs', { count: plan.docs.length })}</h3>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setPicked(allOn ? new Set() : new Set(plan.docs.map((d) => d.id)))}>
              {allOn ? t('migrate.selectNone') : t('migrate.selectAll')}
            </button>
          </div>
          <ul className="mig-list">
            {plan.docs.map((d) => (
              <li key={d.id}>
                <Checkbox
                  checked={picked.has(d.id)}
                  disabled={busy}
                  onChange={() => toggle(d.id)}
                  label={d.title}
                  description={t('migrate.docInfo', { cases: d.cases, vars: d.vars, date: new Date(d.time).toLocaleDateString() })}
                />
              </li>
            ))}
          </ul>
          <p className="acc-note">{t('migrate.docsHelp')}</p>
        </section>
      )}
      {showSettings && (
        <section className="mig-section" aria-labelledby="mig-settings">
          <div className="mig-head">
            <h3 id="mig-settings">{t('migrate.settings')}</h3>
          </div>
          <RadioGroup legend={t('migrate.settings')} hideLegend name="mig-settings" value={settings} onChange={setSettings} options={settingsOptions} />
        </section>
      )}
    </Dialog>
  );
}
