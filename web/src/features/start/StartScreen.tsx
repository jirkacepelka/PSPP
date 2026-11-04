/*
 * Home. A place of its own, not a document: a greeting, a gallery of ways to start (open, blank,
 * syntax, samples), "Your work" – every document autosaved in this browser with a live preview –
 * a few guided questions and the recently opened files.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { Kbd } from '../../components/Kbd';
import { MenuButton } from '../../components/MenuButton';
import { formatShortcut, openPalette } from '../../app/actions';
import {
  deleteDocument,
  duplicateDocument,
  getCurrentDocId,
  getRecent,
  listDocuments,
  newDataset,
  newSyntax,
  openDocument,
  openFileDialog,
  openRecent,
  openSample,
  removeRecent,
  renameDocument,
  type DocMeta,
  type RecentFile,
  type SampleId,
} from '../../app/files';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { SPECS_BY_ID } from '../dialogs/specs';
import { GUIDED_TASKS, runGuidedTask } from './guidedTasks';
import './start.css';

const SAMPLES: { id: SampleId; icon: string; tone: string }[] = [
  { id: 'students', icon: 'school', tone: 'scale' },
  { id: 'employees', icon: 'badge', tone: 'ordinal' },
  { id: 'trial', icon: 'monitor_heart', tone: 'nominal' },
];

/** One guided question per sample is shown first; the rest expand on demand. */
const FIRST_TASKS = ['st-gpa', 'em-jobcat', 'tr-drop'];

function useRelTime() {
  const { i18n } = useTranslation();
  return (ms: number) => {
    const diff = (ms - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
    const a = Math.abs(diff);
    if (a < 45) return rtf.format(0, 'second');
    if (a < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    if (a < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
    return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(ms);
  };
}

function eyebrowKey() {
  const h = new Date().getHours();
  return h < 10 ? 'home.eyebrowMorning' : h < 18 ? 'home.eyebrowDay' : 'home.eyebrowEvening';
}

/** Schematic sheet used as a thumbnail for blank data and samples. */
function SheetThumb({ tone, empty }: { tone?: string; empty?: boolean }) {
  return (
    <span className={`hm-sheet ${empty ? 'empty' : ''}`} data-tone={tone} aria-hidden="true">
      <span className="hm-sheet-head" />
      {Array.from({ length: 6 }, (_, r) => (
        <span key={r} className="hm-sheet-row">
          <span />
          <span />
          <span />
        </span>
      ))}
    </span>
  );
}

function DocPreview({ doc }: { doc: DocMeta }) {
  if ('cols' in doc.preview) {
    const { cols, rows } = doc.preview;
    return (
      <table className="hm-prev-table" aria-hidden="true">
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <pre className="hm-prev-code" aria-hidden="true">
      {doc.preview.lines.join('\n') || ' '}
    </pre>
  );
}

function DocCard({ doc, index, current }: { doc: DocMeta; index: number; current: boolean }) {
  const { t } = useTranslation();
  const rel = useRelTime();
  const [renaming, setRenaming] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);
  const meta =
    doc.kind === 'data'
      ? [t('home.cases', { count: doc.cases }), t('home.vars', { count: doc.vars })]
      : [t('home.syntaxDoc')];
  if (doc.outputs) meta.push(t('home.outputs', { count: doc.outputs }));
  const commit = (v: string) => {
    setRenaming(false);
    const s = v.trim();
    if (s && s !== doc.title) void renameDocument(doc.id, s);
  };
  return (
    <li className={`hm-doc ${current ? 'is-current' : ''}`} style={{ '--i': index } as CSSProperties}>
      <button type="button" className="hm-doc-open" onClick={() => void openDocument(doc.id)} aria-label={doc.title}>
        <span className="hm-doc-prev">
          <DocPreview doc={doc} />
          <span className="hm-doc-kind">
            <Icon name={doc.kind === 'data' ? 'table' : 'code'} size={16} />
          </span>
          {current && <span className="hm-doc-badge">{t('home.current')}</span>}
        </span>
      </button>
      <div className="hm-doc-foot">
        <div className="hm-doc-text">
          {renaming ? (
            <input
              ref={input}
              className="hm-doc-rename"
              defaultValue={doc.title}
              aria-label={t('home.renamePrompt')}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <span className="hm-doc-title" title={doc.title}>
              {doc.title}
            </span>
          )}
          <span className="hm-doc-meta">
            {t('home.edited', { time: rel(doc.time) })} · {meta.join(' · ')}
          </span>
        </div>
        <MenuButton
          iconOnly
          icon="more_vert"
          variant="ghost"
          size="sm"
          label={t('home.actions', { name: doc.title })}
          className="hm-doc-more"
          items={[
            { type: 'item', id: 'rename', label: t('home.rename'), icon: 'edit', onSelect: () => setRenaming(true) },
            { type: 'item', id: 'dup', label: t('home.duplicate'), icon: 'content_copy', onSelect: () => void duplicateDocument(doc.id) },
            { type: 'sep' },
            {
              type: 'item',
              id: 'del',
              label: t('home.delete'),
              icon: 'delete',
              danger: true,
              onSelect: () =>
                useUi.getState().openModal({
                  kind: 'confirm',
                  titleKey: 'home.deleteTitle',
                  messageKey: 'home.deleteMessage',
                  messageArgs: { name: doc.title },
                  confirmKey: 'home.delete',
                  danger: true,
                  onConfirm: () => void deleteDocument(doc.id),
                }),
            },
          ]}
        />
      </div>
    </li>
  );
}

export function StartScreen() {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [moreTasks, setMoreTasks] = useState(false);
  const [allDocs, setAllDocs] = useState(false);
  const hasData = useData((s) => !!s.dataset);
  const setShowStart = useUi((s) => s.setShowStart);
  const name = useSettings((s) => s.profile.name);
  const currentId = getCurrentDocId();

  useEffect(() => {
    const loadDocs = () => void listDocuments().then(setDocs);
    const loadRecent = () => void getRecent().then(setRecent);
    loadDocs();
    loadRecent();
    window.addEventListener('pspp-docs-changed', loadDocs);
    window.addEventListener('pspp-recent-changed', loadRecent);
    return () => {
      window.removeEventListener('pspp-docs-changed', loadDocs);
      window.removeEventListener('pspp-recent-changed', loadRecent);
    };
  }, []);

  const tasks = moreTasks ? GUIDED_TASKS : GUIDED_TASKS.filter((g) => FIRST_TASKS.includes(g.id));
  const DOC_LIMIT = 8;
  const shownDocs = docs && !allDocs ? docs.slice(0, DOC_LIMIT) : docs;
  const canResume = hasData || (currentId && docs?.some((d) => d.id === currentId));

  return (
    <div className="hm">
      <div className="hm-inner">
        <header className="hm-hero hm-in" style={{ '--i': 0 } as CSSProperties}>
          <div>
            <p className="hm-eyebrow">{t(eyebrowKey())}</p>
            <h2 className="hm-title">{name ? t('start.greeting', { name: name.split(' ')[0] }) : t('start.greetingAnon')}</h2>
            <p className="hm-sub">{t('start.subtitle')}</p>
          </div>
          {canResume && (
            <Button variant="primary" iconStart="arrow_forward" onClick={() => setShowStart(false)} className="hm-back">
              {t('home.back')}
            </Button>
          )}
        </header>

        <section className="hm-section hm-in" style={{ '--i': 1 } as CSSProperties} aria-labelledby="hm-start">
          <h3 id="hm-start" className="hm-h">
            {t('home.start')}
          </h3>
          <ul className="hm-gallery">
            <li className="hm-card-wrap" style={{ '--i': 0 } as CSSProperties}>
              <button type="button" className="hm-card hm-card-open" onClick={() => void openFileDialog()}>
                <span className="hm-thumb hm-thumb-open">
                  <Icon name="upload_file" size={36} />
                  <span className="hm-formats">.sav · .zsav · .por · .csv · .ods · .sps</span>
                  <span className="hm-kbd">
                    <Kbd keys={formatShortcut('Mod+O').split('+')} />
                  </span>
                </span>
                <span className="hm-card-title">{t('home.openTitle')}</span>
                <span className="hm-card-desc">{t('home.openDesc')}</span>
              </button>
            </li>
            <li className="hm-card-wrap" style={{ '--i': 1 } as CSSProperties}>
              <button type="button" className="hm-card" onClick={newDataset}>
                <span className="hm-thumb">
                  <SheetThumb empty />
                  <span className="hm-plus">
                    <Icon name="add" size={28} />
                  </span>
                </span>
                <span className="hm-card-title">{t('home.blankTitle')}</span>
                <span className="hm-card-desc">{t('home.blankDesc')}</span>
              </button>
            </li>
            <li className="hm-card-wrap" style={{ '--i': 2 } as CSSProperties}>
              <button type="button" className="hm-card" onClick={() => void newSyntax()}>
                <span className="hm-thumb hm-thumb-code" aria-hidden="true">
                  <code>
                    <b>FREQUENCIES</b>
                    {'\n  /VARIABLES=…\n'}
                    <b>DESCRIPTIVES</b>
                    {'\n  /VARIABLES=…'}
                  </code>
                </span>
                <span className="hm-card-title">{t('home.syntaxTitle')}</span>
                <span className="hm-card-desc">{t('home.syntaxDesc')}</span>
              </button>
            </li>
            {SAMPLES.map((s, i) => (
              <li key={s.id} className="hm-card-wrap" style={{ '--i': 3 + i } as CSSProperties}>
                <button type="button" className="hm-card" onClick={() => void openSample(s.id)}>
                  <span className="hm-thumb">
                    <SheetThumb tone={s.tone} />
                    <span className="hm-sample-icon" data-tone={s.tone}>
                      <Icon name={s.icon} size={18} />
                    </span>
                  </span>
                  <span className="hm-card-title">{t(`samples.${s.id}.title`)}</span>
                  <span className="hm-card-desc">{t(`samples.${s.id}.desc`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="hm-section hm-in" style={{ '--i': 2 } as CSSProperties} aria-labelledby="hm-work">
          <div className="hm-h-row">
            <h3 id="hm-work" className="hm-h">
              {t('home.work')}
            </h3>
            <span className="hm-h-hint">
              <Icon name="cloud_done" size={16} />
              {t('home.workHint')}
            </span>
          </div>
          {docs && docs.length === 0 ? (
            <div className="hm-empty">
              <Icon name="auto_awesome_motion" size={28} />
              <div>
                <strong>{t('home.workEmptyTitle')}</strong>
                <p>{t('home.workEmptyDesc')}</p>
              </div>
            </div>
          ) : (
            <>
              <ul className="hm-docs">
                {shownDocs?.map((d, i) => (
                  <DocCard key={d.id} doc={d} index={i} current={d.id === currentId} />
                ))}
              </ul>
              {docs && docs.length > DOC_LIMIT && (
                <Button variant="ghost" size="sm" className="hm-more" iconEnd={allDocs ? 'expand_less' : 'expand_more'} onClick={() => setAllDocs(!allDocs)}>
                  {allDocs ? t('home.showLess') : t('home.showAll', { count: docs.length })}
                </Button>
              )}
            </>
          )}
        </section>

        <div className="hm-columns hm-in" style={{ '--i': 3 } as CSSProperties}>
          <section className="hm-section" aria-labelledby="hm-q">
            <h3 id="hm-q" className="hm-h">
              {t('home.questions')}
            </h3>
            <p className="hm-hint">{t('home.questionsHint')}</p>
            <ul className="hm-tasks">
              {tasks.map((g) => (
                <li key={g.id}>
                  <button type="button" className="hm-task" onClick={() => runGuidedTask(g)}>
                    <span className="hm-task-icon">
                      <Icon name={g.icon} size={18} />
                    </span>
                    <span className="hm-task-text">
                      <span className="hm-task-q">{t(`${g.key}.q`)}</span>
                      <span className="hm-task-m">
                        {SPECS_BY_ID[g.specId] ? t(SPECS_BY_ID[g.specId].title).replace(/…$/, '') : t(`${g.key}.method`)} · {t(`samples.${g.sample}.title`)}
                      </span>
                    </span>
                    <Icon name="arrow_forward" size={18} className="hm-task-go" />
                  </button>
                </li>
              ))}
            </ul>
            <Button variant="ghost" size="sm" className="hm-more" iconEnd={moreTasks ? 'expand_less' : 'expand_more'} onClick={() => setMoreTasks(!moreTasks)}>
              {moreTasks ? t('home.fewerQuestions') : t('home.moreQuestions')}
            </Button>
          </section>

          <section className="hm-section" aria-labelledby="hm-recent">
            <h3 id="hm-recent" className="hm-h">
              {t('home.recentFiles')}
            </h3>
            {recent.length === 0 ? (
              <p className="hm-hint">{t('shell.start.recentEmptyDesc')}</p>
            ) : (
              <ul className="hm-recent">
                {recent.slice(0, 6).map((r) => (
                  <li key={r.id} className="hm-recent-row">
                    <button type="button" className="hm-recent-item" onClick={() => void openRecent(r)} disabled={!r.stored} title={r.stored ? r.name : t('files.recentMissing', { name: r.name })}>
                      <Icon name={r.kind === 'syntax' ? 'code' : 'description'} size={18} />
                      <span className="hm-recent-name">{r.name}</span>
                    </button>
                    <IconButton icon="close" small label={t('shell.start.removeRecent', { name: r.name })} onClick={() => void removeRecent(r.id)} />
                  </li>
                ))}
              </ul>
            )}
            <div className="hm-notes">
              <p>
                <Icon name="lock" size={16} />
                {t('home.privacy')}
              </p>
              <button type="button" className="hm-note-btn" onClick={() => openPalette()}>
                <Icon name="search" size={16} />
                {t('home.search')} <Kbd keys={formatShortcut('Mod+K').split('+')} />
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
