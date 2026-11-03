/*
 * Journal panel ("Deník", SY-5 / F10): every syntax run, newest first, with insert / copy /
 * download / open-as-syntax.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { useJournal } from '../../store/journal';
import { useSyntax } from '../../store/syntax';
import { useUi } from '../../store/ui';
import { SPECS_BY_ID } from '../dialogs/specs';

const ICON: Record<string, string> = { syntax: 'code', dialog: 'tune', menu: 'replay', data: 'table', system: 'settings' };

export function JournalPanel({ onClose, onInsert }: { onClose: () => void; onInsert: (text: string) => void }) {
  const { t } = useTranslation();
  const entries = useJournal((s) => s.entries);
  const toast = useUi((s) => s.toast);
  const all = () => useJournal.getState().toSyntax();
  const download = () => {
    const blob = new Blob([all()], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `journal-${new Date().toISOString().slice(0, 10)}.sps`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <aside className="syn-journal" aria-label={t('syntax.journal')}>
      <header>
        <Icon name="history_edu" />
        <h3>{t('syntax.journal')}</h3>
        <span className="spacer" />
        <IconButton icon="close" small label={t('common.close')} onClick={onClose} />
      </header>
      <p className="syn-journal-desc">{t('syntax.journalDesc')}</p>
      <div className="syn-journal-actions">
        <button type="button" className="btn btn-ghost btn-sm" disabled={!entries.length} onClick={() => useSyntax.getState().add(all(), t('syntax.journal'))}>
          <Icon name="open_in_new" />
          {t('syntax.journalOpen')}
        </button>
        <IconButton icon="content_copy" small label={t('syntax.journalCopy')} disabled={!entries.length} onClick={() => void navigator.clipboard?.writeText(all()).then(() => toast(t('syntax.journalCopied')))} />
        <IconButton icon="download" small label={t('syntax.journalDownload')} disabled={!entries.length} onClick={download} />
      </div>
      {entries.length === 0 ? (
        <p className="syn-journal-empty">{t('syntax.journalEmpty')}</p>
      ) : (
        <ol className="syn-journal-list">
          {[...entries].reverse().slice(0, 200).map((e, i) => (
            <li key={`${e.time}-${i}`} className={e.ok ? '' : 'error'}>
              <div className="syn-journal-meta">
                <Icon name={e.ok ? ICON[e.source] ?? 'code' : 'error'} size={14} />
                <span>{e.specId && SPECS_BY_ID[e.specId] ? t(SPECS_BY_ID[e.specId].title) : t(`syntax.source.${e.source}`)}</span>
                <time>{new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                <IconButton icon="input" small label={t('syntax.journalInsert')} onClick={() => onInsert(e.syntax)} />
              </div>
              <pre>{e.syntax}</pre>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
