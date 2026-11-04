/*
 * Home. A place of its own, not a document:
 *   top band  – time-of-day greeting with the name, "Create" (open a file, blank data, syntax)
 *               and the sample datasets;
 *   main      – "Your work": every document autosaved in this browser, searchable, as tiles
 *               with a live preview or as a list;
 *   side      – guided questions, collapsible.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { MenuButton } from '../../components/MenuButton';
import { Kbd } from '../../components/Kbd';
import { CreateDialog } from './CreateDialog';
import { Segmented } from '../../components/Segmented';
import { formatShortcut } from '../../app/actions';
import {
  deleteDocument,
  duplicateDocument,
  getCurrentDocId,
  listDocuments,
  openDocument,
  openSample,
  renameDocument,
  type DocMeta,
  type SampleId,
} from '../../app/files';
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

type ViewMode = 'grid' | 'list';
const LS_VIEW = 'home.view';
const LS_SIDE = 'home.questionsHidden';
const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

/** Case- and diacritics-insensitive text for search. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

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

function greetingKey(named: boolean) {
  const h = new Date().getHours();
  const base = h < 10 ? 'home.greetMorning' : h < 18 ? 'home.greetDay' : 'home.greetEvening';
  return named ? base : `${base}Anon`;
}

/** Schematic sheet used as a thumbnail for the samples. */
function SheetThumb({ tone }: { tone?: string }) {
  return (
    <span className="hm-sheet" data-tone={tone} aria-hidden="true">
      <span className="hm-sheet-head" />
      {Array.from({ length: 6 }, (_, r) => (
        <span key={r} className="hm-sheet-row" style={{ '--r': r } as CSSProperties}>
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

/** Shared bits of a document entry: meta text, rename field, actions menu. */
function useDocEntry(doc: DocMeta) {
  const { t } = useTranslation();
  const rel = useRelTime();
  const [renaming, setRenaming] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);
  const content = doc.kind === 'data' ? [t('home.cases', { count: doc.cases }), t('home.vars', { count: doc.vars })] : [t('home.syntaxDoc')];
  if (doc.outputs) content.push(t('home.outputs', { count: doc.outputs }));
  const commit = (v: string) => {
    setRenaming(false);
    const s = v.trim();
    if (s && s !== doc.title) void renameDocument(doc.id, s);
  };
  const title = renaming ? (
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
  );
  const menu = (
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
  );
  return { title, menu, content: content.join(' · '), edited: rel(doc.time) };
}

function DocCard({ doc, index, current }: { doc: DocMeta; index: number; current: boolean }) {
  const { t } = useTranslation();
  const e = useDocEntry(doc);
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
          {e.title}
          <span className="hm-doc-meta">
            {t('home.edited', { time: e.edited })} · {e.content}
          </span>
        </div>
        {e.menu}
      </div>
    </li>
  );
}

function DocRow({ doc, index, current }: { doc: DocMeta; index: number; current: boolean }) {
  const { t } = useTranslation();
  const e = useDocEntry(doc);
  return (
    <li className={`hm-row ${current ? 'is-current' : ''}`} style={{ '--i': index } as CSSProperties}>
      <button type="button" className="hm-row-open" onClick={() => void openDocument(doc.id)} aria-label={doc.title}>
        <span className="hm-row-icon">
          <Icon name={doc.kind === 'data' ? 'table' : 'code'} size={18} />
        </span>
      </button>
      <div className="hm-row-name" onDoubleClick={() => void openDocument(doc.id)}>
        {e.title}
        {current && <span className="hm-doc-badge inline">{t('home.current')}</span>}
      </div>
      <span className="hm-row-content">{e.content}</span>
      <span className="hm-row-edited">{e.edited}</span>
      {e.menu}
    </li>
  );
}

export function StartScreen() {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [moreTasks, setMoreTasks] = useState(false);
  const [allDocs, setAllDocs] = useState(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>(() => (lsGet(LS_VIEW) === 'list' ? 'list' : 'grid'));
  const [sideHidden, setSideHidden] = useState(() => lsGet(LS_SIDE) === '1');
  const name = useSettings((s) => s.profile.name);
  const currentId = getCurrentDocId();

  useEffect(() => {
    const loadDocs = () => void listDocuments().then(setDocs);
    loadDocs();
    window.addEventListener('pspp-docs-changed', loadDocs);
    return () => window.removeEventListener('pspp-docs-changed', loadDocs);
  }, []);

  const changeView = (v: ViewMode) => {
    setView(v);
    lsSet(LS_VIEW, v);
  };
  const toggleSide = (hidden: boolean) => {
    setSideHidden(hidden);
    lsSet(LS_SIDE, hidden ? '1' : '0');
  };

  const matches = useMemo(() => {
    if (!docs) return null;
    const q = fold(query.trim());
    return q ? docs.filter((d) => fold(d.title).includes(q) || fold(d.fileName ?? '').includes(q)) : docs;
  }, [docs, query]);

  const tasks = moreTasks ? GUIDED_TASKS : GUIDED_TASKS.filter((g) => FIRST_TASKS.includes(g.id));
  const DOC_LIMIT = view === 'grid' ? 8 : 12;
  const shown = matches && !allDocs && !query ? matches.slice(0, DOC_LIMIT) : matches;
  const first = name.trim().split(/\s+/)[0];
  const [creating, setCreating] = useState(false);
  const rel = useRelTime();
  const { i18n } = useTranslation();
  const today = new Intl.DateTimeFormat(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const last = docs?.[0];

  return (
    <div className="hm">
      <section className="hm-band" aria-labelledby="hm-greet">
        <div className="hm-band-inner">
          <header className="hm-hero hm-in" style={{ '--i': 0 } as CSSProperties}>
            <p className="hm-eyebrow">
              {t(greetingKey(false))} · <span className="hm-date">{today}</span>
            </p>
            <h2 id="hm-greet" className="hm-title">
              {first ? t('home.hi', { name: first }) : t('home.hiAnon')}
            </h2>
            <p className="hm-summary">
              {last ? (
                <>
                  {t('home.summaryDocs', { count: docs?.length ?? 0 })} {t('home.summaryLast')}{' '}
                  <button type="button" className="hm-link" onClick={() => void openDocument(last.id)}>
                    {last.title}
                  </button>{' '}
                  <span className="hm-summary-time">({rel(last.time)})</span>.
                </>
              ) : (
                t('home.summaryEmpty')
              )}
            </p>
            <div className="hm-hero-actions">
              <Button variant="primary" iconStart="add" className="hm-create" onClick={() => setCreating(true)}>
                {t('home.create')}
              </Button>
              <span className="hm-tip">
                {t('home.tipSearch')} <Kbd keys={formatShortcut('Mod+K').split('+')} />
              </span>
            </div>
          </header>

          <div className="hm-samples hm-in" style={{ '--i': 1 } as CSSProperties}>
            <h3 className="hm-h">{t('home.samplesTitle')}</h3>
            <ul className="hm-gallery">
              {SAMPLES.map((s, i) => (
                <li key={s.id} className="hm-card-wrap" style={{ '--i': i } as CSSProperties}>
                  <button type="button" className="hm-card" onClick={() => void openSample(s.id)}>
                    <span className="hm-thumb">
                      <SheetThumb tone={s.tone} />
                      <span className="hm-sample-icon" data-tone={s.tone}>
                        <Icon name={s.icon} size={18} />
                      </span>
                    </span>
                    <span className="hm-card-text">
                      <span className="hm-card-title">{t(`samples.${s.id}.title`)}</span>
                      <span className="hm-card-desc">{t(`samples.${s.id}.desc`)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className={`hm-body ${sideHidden ? 'side-hidden' : ''}`}>
        <section className="hm-section hm-work hm-in" style={{ '--i': 2 } as CSSProperties} aria-labelledby="hm-work">
          <div className="hm-work-head">
            <div className="hm-h-row">
              <h3 id="hm-work" className="hm-h">
                {t('home.work')}
              </h3>
              <span className="hm-h-hint">
                <Icon name="cloud_done" size={16} />
                {t('home.workHint')}
              </span>
            </div>
            <div className="hm-work-tools">
              <label className="hm-search">
                <Icon name="search" size={18} />
                <input type="search" value={query} placeholder={t('home.searchWork')} aria-label={t('home.searchWork')} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
                {query && <IconButton icon="close" small label={t('home.clearSearch')} onClick={() => setQuery('')} />}
              </label>
              <Segmented<ViewMode>
                aria-label={t('home.viewMode')}
                size="sm"
                value={view}
                onChange={changeView}
                options={[
                  { value: 'grid', label: t('home.viewGrid'), icon: 'grid_view', iconOnly: true },
                  { value: 'list', label: t('home.viewList'), icon: 'view_list', iconOnly: true },
                ]}
              />
              {sideHidden && (
                <Button variant="ghost" size="sm" iconStart="lightbulb" className="hm-side-show" onClick={() => toggleSide(false)}>
                  {t('home.showQuestions')}
                </Button>
              )}
            </div>
          </div>

          {docs && docs.length === 0 ? (
            <div className="hm-empty">
              <Icon name="auto_awesome_motion" size={28} />
              <div>
                <strong>{t('home.workEmptyTitle')}</strong>
                <p>{t('home.workEmptyDesc')}</p>
              </div>
            </div>
          ) : matches && matches.length === 0 ? (
            <p className="hm-nomatch">{t('home.noMatch', { q: query.trim() })}</p>
          ) : view === 'grid' ? (
            <ul className="hm-docs">
              {shown?.map((d, i) => (
                <DocCard key={d.id} doc={d} index={i} current={d.id === currentId} />
              ))}
            </ul>
          ) : (
            <div className="hm-list" role="region" aria-label={t('home.work')}>
              <div className="hm-row hm-row-head" aria-hidden="true">
                <span />
                <span>{t('home.colName')}</span>
                <span className="hm-row-content">{t('home.colContent')}</span>
                <span className="hm-row-edited">{t('home.colEdited')}</span>
                <span />
              </div>
              <ul>
                {shown?.map((d, i) => (
                  <DocRow key={d.id} doc={d} index={i} current={d.id === currentId} />
                ))}
              </ul>
            </div>
          )}
          {!query && matches && matches.length > DOC_LIMIT && (
            <Button variant="ghost" size="sm" className="hm-more" iconEnd={allDocs ? 'expand_less' : 'expand_more'} onClick={() => setAllDocs(!allDocs)}>
              {allDocs ? t('home.showLess') : t('home.showAll', { count: matches.length })}
            </Button>
          )}
        </section>

        {!sideHidden && (
          <aside className="hm-side hm-in" style={{ '--i': 3 } as CSSProperties} aria-labelledby="hm-q">
            <div className="hm-side-head">
              <h3 id="hm-q" className="hm-h">
                {t('home.questions')}
              </h3>
              <IconButton icon="close" small label={t('home.hideQuestions')} onClick={() => toggleSide(true)} />
            </div>
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
                      <span className="hm-task-m">{SPECS_BY_ID[g.specId] ? t(SPECS_BY_ID[g.specId].title).replace(/…$/, '') : t(`${g.key}.method`)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Button variant="ghost" size="sm" className="hm-more" iconEnd={moreTasks ? 'expand_less' : 'expand_more'} onClick={() => setMoreTasks(!moreTasks)}>
              {moreTasks ? t('home.fewerQuestions') : t('home.moreQuestions')}
            </Button>
          </aside>
        )}
      </div>
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
