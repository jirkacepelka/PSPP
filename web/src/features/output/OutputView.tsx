/*
 * Output viewer: a calm document of results with an outline (pinned results, run history by day,
 * search), result headers with Edit / Re-run / Pin / Copy / Delete (with undo), table copy as
 * table / APA / text, chart export, and plain-language interpretation cards.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { MenuButton } from '../../components/MenuButton';
import type { OutputItem } from '../../engine/types';
import { useOutput, type OutputEntry } from '../../store/output';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { useData } from '../../store/data';
import { exportOutputHtml, printOutput } from '../../app/files';
import { pasteSyntax, runSyntaxDetailed } from '../../app/engine';
import { openDialog } from '../../app/actions';
import { formatShortcut } from '../../app/actions';
import { chartToPngBlob, downloadPng, downloadSvg } from '../../charts';
import { formatTableHtml } from '../../lib/statfmt';
import { INTERPRETABLE, type TableInput } from '../../lib/interpret';
import { gotoSyntaxLine } from '../syntax/runCommands';
import { ChartView, isSimple } from './ChartView';
import { Interpretation } from './Interpretation';
import { copyChartImage, copyTable, dayLabel, entryTitle, singleCommand, visibleItems, type CopyMode } from './outputHelpers';
import './output-view.css';

function itemTitle(it: OutputItem, t: (k: string) => string): string {
  switch (it.kind) {
    case 'group':
    case 'table':
    case 'chart':
    case 'image':
      return it.title;
    case 'text':
      return it.text.split('\n')[0].slice(0, 60);
    case 'message':
      return t(`output.severity.${it.severity}`);
    default:
      return '';
  }
}

function itemIcon(it: OutputItem): string {
  switch (it.kind) {
    case 'group': return 'folder';
    case 'table': return 'table';
    case 'chart': return 'bar_chart';
    case 'image': return 'image';
    case 'text': return 'notes';
    case 'message': return it.severity === 'error' ? 'error' : it.severity === 'warning' ? 'warning' : 'info';
    default: return 'description';
  }
}

const tablesOf = (items: OutputItem[]): TableInput[] => items.filter((i): i is Extract<OutputItem, { kind: 'table' }> => i.kind === 'table').map((i) => ({ title: i.title, html: i.html }));

/** Global table number (for "Table 3" in APA copies). */
function tableNumber(entries: OutputEntry[], id: string): number {
  let n = 0;
  let found = 0;
  const walk = (items: OutputItem[]) => {
    for (const i of items) {
      if (found) return;
      if (i.kind === 'table') {
        n++;
        if (i.id === id) found = n;
      }
      if (i.kind === 'group') walk(i.children);
    }
  };
  entries.forEach((e) => walk(e.items));
  return found || 1;
}

function useRemoveWithUndo() {
  const { t } = useTranslation();
  const remove = useOutput((s) => s.remove);
  const toast = useUi((s) => s.toast);
  return (id: string, what: 'entry' | 'item') => {
    remove(id);
    toast(t(what === 'entry' ? 'output.entryDeleted' : 'output.itemDeleted'), { action: { label: t('output.undo'), run: () => useOutput.getState().undoRemove() } });
  };
}

function Item({ item, entry, depth }: { item: OutputItem; entry: OutputEntry; depth: number }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const selectedId = useOutput((s) => s.selectedId);
  const leadingZero = useSettings((s) => s.leadingZero);
  const apaLocale = useSettings((s) => s.apaLocale);
  const removeWithUndo = useRemoveWithUndo();
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => (item.kind === 'table' ? formatTableHtml(item.html, leadingZero) : ''), [item, leadingZero]);
  if ((item as { hidden?: boolean }).hidden) return null;
  if ((item as { kind: string }).kind === 'page-break') return <hr className="page-break" />;
  const selected = selectedId === item.id;

  switch (item.kind) {
    case 'group': {
      const tables = tablesOf(item.children);
      const cmd = item.command?.toUpperCase();
      return (
        <section className={`output-group depth-${depth}`} id={`out-${item.id}`}>
          <h3 className="output-subgroup-title">{item.title}</h3>
          {item.children.map((c) => (
            <Item key={c.id} item={c} entry={entry} depth={depth + 1} />
          ))}
          {cmd && INTERPRETABLE.includes(cmd) && tables.length > 0 && <Interpretation command={cmd} tables={tables} />}
        </section>
      );
    }
    case 'table': {
      const copy = (mode: CopyMode) =>
        void copyTable(ref.current, item.html, mode, { locale: apaLocale, number: tableNumber(useOutput.getState().entries, item.id) }).then((ok) =>
          toast(ok ? t(mode === 'apa' ? 'output.copiedApa' : 'output.copied') : t('output.copyFailed')),
        );
      return (
        <div className={`output-item out-table ${selected ? 'selected' : ''}`} id={`out-${item.id}`} ref={ref}>
          <div className="out-item-head">
            <h4 className="out-item-title">{item.title}</h4>
            <div className="item-actions">
              <IconButton icon="content_copy" small label={t('output.copyTable')} onClick={() => copy('table')} />
              <MenuButton
                iconOnly
                icon="more_horiz"
                variant="ghost"
                size="sm"
                label={t('output.moreCopy')}
                items={[
                  { type: 'item', id: 'table', label: t('output.copyAsTable'), icon: 'table', onSelect: () => copy('table') },
                  { type: 'item', id: 'apa', label: t('output.copyAsApa'), icon: 'school', onSelect: () => copy('apa') },
                  { type: 'item', id: 'text', label: t('output.copyAsText'), icon: 'notes', onSelect: () => copy('text') },
                  { type: 'sep' },
                  { type: 'item', id: 'del', label: t('output.deleteItem'), icon: 'delete', danger: true, onSelect: () => removeWithUndo(item.id, 'item') },
                ]}
              />
            </div>
          </div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={item.title} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      );
    }
    case 'text':
      if (item.subtype === 'title') return <h1 className="output-text-title" id={`out-${item.id}`}>{item.text}</h1>;
      if (item.subtype === 'subtitle' || item.subtype === 'page-title') return <h2 className="output-text-subtitle" id={`out-${item.id}`}>{item.text}</h2>;
      return (
        <pre className="output-text-log" id={`out-${item.id}`}>
          {item.text}
        </pre>
      );
    case 'message': {
      const goto = () => {
        if (item.line && entry.tabId && gotoSyntaxLine(entry.tabId, item.line)) return;
        if (entry.source) openDialog(entry.source.specId, entry.source.values, entry.id);
        else if (item.line) pasteSyntax(entry.syntax);
      };
      return (
        <div className={`callout ${item.severity}`} id={`out-${item.id}`} role={item.severity === 'error' ? 'alert' : undefined}>
          <Icon name={itemIcon(item)} filled />
          <span>
            <strong>{t(`output.severity.${item.severity}`)}:</strong> {item.text}
          </span>
          {(item.line || entry.source) && item.severity !== 'note' && (
            <button type="button" className="callout-line" onClick={goto}>
              {entry.source && !entry.tabId ? t('output.fixInDialog') : t('output.line', { line: item.line })}
            </button>
          )}
        </div>
      );
    }
    case 'chart': {
      const svg = () => ref.current?.querySelector('svg');
      const name = item.title || 'chart';
      return (
        <figure className={`output-item out-chart ${selected ? 'selected' : ''}`} id={`out-${item.id}`} data-chart-id={item.id} ref={ref as unknown as React.RefObject<HTMLElement>}>
          <div className="item-actions floating">
            <IconButton
              icon="content_copy"
              small
              label={t('output.copyImage')}
              onClick={() => {
                const el = svg();
                if (el) void copyChartImage(el, (x) => chartToPngBlob(x)).then((ok) => toast(ok ? t('output.copiedImage') : t('output.copyFailed')));
              }}
            />
            <MenuButton
              iconOnly
              icon="download"
              variant="ghost"
              size="sm"
              label={t('output.downloadChart')}
              items={[
                { type: 'item', id: 'png', label: 'PNG', icon: 'image', onSelect: () => { const el = svg(); if (el) void downloadPng(el, name); } },
                { type: 'item', id: 'svg', label: 'SVG', icon: 'draw', onSelect: () => { const el = svg(); if (el) downloadSvg(el, name); } },
              ]}
            />
            <IconButton icon="delete" small label={t('output.deleteItem')} onClick={() => removeWithUndo(item.id, 'item')} />
          </div>
          {isSimple(item.chart) && <figcaption className="item-title">{item.title}</figcaption>}
          <ChartView chart={item.chart} title={item.title} />
        </figure>
      );
    }
    case 'image':
      return (
        <figure className="output-item" id={`out-${item.id}`}>
          <img src={item.src} alt={item.title} style={{ maxWidth: '100%' }} />
          <figcaption className="item-title">{item.title}</figcaption>
        </figure>
      );
    default:
      return null;
  }
}

function EntryArticle({ e }: { e: OutputEntry }) {
  const { t } = useTranslation();
  const select = useOutput((s) => s.select);
  const selectedId = useOutput((s) => s.selectedId);
  const togglePin = useOutput((s) => s.togglePin);
  const rerunReplaces = useSettings((s) => s.rerunReplaces);
  const hasData = useData((s) => !!s.dataset);
  const removeWithUndo = useRemoveWithUndo();
  const items = visibleItems(e);
  const cmd = singleCommand(e)?.toUpperCase();
  const flattened = items !== e.items;
  const tables = flattened ? tablesOf(items) : [];
  const title = entryTitle(e, t);
  const selected = selectedId === e.id;
  const rerun = () => void runSyntaxDetailed(e.syntax, { source: e.source, replaceEntryId: rerunReplaces ? e.id : undefined, origin: 'menu', tabId: e.tabId });

  return (
    <article className={`paper ${selected ? 'selected' : ''} ${e.status === 'error' ? 'has-error' : ''}`} id={`out-${e.id}`} aria-labelledby={`out-title-${e.id}`} onMouseDown={() => selectedId !== e.id && select(e.id)}>
      <header className="paper-head">
        <div className="paper-title">
          {e.status === 'error' && <Icon name="error" className="paper-status" />}
          {e.pinned && <Icon name="push_pin" className="paper-pin" filled />}
          <h2 className="output-group-title" id={`out-title-${e.id}`}>
            {title}
          </h2>
          <time className="paper-time" dateTime={new Date(e.time).toISOString()}>
            {new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
        </div>
        <div className="paper-actions" role="toolbar" aria-label={t('output.resultActions')}>
          {e.source && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog(e.source!.specId, e.source!.values, rerunReplaces ? e.id : undefined)} data-tip={formatShortcut('Mod+E')}>
              <Icon name="tune" />
              <span className="hide-sm">{t('output.edit')}</span>
            </button>
          )}
          {e.syntax && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={!hasData} onClick={rerun} data-tip={formatShortcut('Mod+R')}>
              <Icon name="replay" />
              <span className="hide-sm">{t('output.rerun')}</span>
            </button>
          )}
          <IconButton icon="push_pin" small pressed={!!e.pinned} label={e.pinned ? t('output.unpin') : t('output.pin')} onClick={() => togglePin(e.id)} />
          <MenuButton
            iconOnly
            icon="more_vert"
            variant="ghost"
            size="sm"
            label={t('output.more')}
            items={[
              { type: 'item', id: 'paste', label: t('output.pasteSyntax'), icon: 'content_paste_go', disabled: !e.syntax, onSelect: () => pasteSyntax(e.syntax) },
              { type: 'sep' },
              { type: 'item', id: 'del', label: t('output.deleteEntry'), icon: 'delete', danger: true, onSelect: () => removeWithUndo(e.id, 'entry') },
            ]}
          />
        </div>
      </header>
      {e.syntax && (
        <details className="paper-syntax">
          <summary>{t('output.showSyntax')}</summary>
          <pre className="output-syntax">{e.syntax}</pre>
        </details>
      )}
      {items.length === 0 && <p className="paper-note">{t('output.noItems')}</p>}
      {items.map((it) => (
        <Item key={it.id} item={it} entry={e} depth={flattened ? 1 : 0} />
      ))}
      {flattened && cmd && INTERPRETABLE.includes(cmd) && tables.length > 0 && <Interpretation command={cmd} tables={tables} />}
    </article>
  );
}

function OutlineNode({ item, onPick, depth }: { item: OutputItem; onPick: (id: string) => void; depth: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const selectedId = useOutput((s) => s.selectedId);
  if ((item as { hidden?: boolean }).hidden || (item as { kind: string }).kind === 'page-break') return null;
  const isGroup = item.kind === 'group';
  return (
    <li role="treeitem" aria-expanded={isGroup ? open : undefined} aria-selected={selectedId === item.id}>
      <div className={`outline-row ${selectedId === item.id ? 'on' : ''}`} style={{ paddingLeft: 4 + depth * 14 }}>
        {isGroup ? (
          <button type="button" className="outline-toggle" aria-label={open ? t('output.collapse') : t('output.expand')} onClick={() => setOpen(!open)}>
            <Icon name={open ? 'expand_more' : 'chevron_right'} size={18} />
          </button>
        ) : (
          <span className="outline-toggle" />
        )}
        <button type="button" className="outline-label" onClick={() => onPick(item.id)}>
          <Icon name={itemIcon(item)} size={16} />
          <span>{itemTitle(item, t)}</span>
        </button>
      </div>
      {isGroup && open && item.children.length > 0 && (
        <ul role="group">
          {item.children.map((c) => (
            <OutlineNode key={c.id} item={c} onPick={onPick} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function EntryOutline({ entry, onPick }: { entry: OutputEntry; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const selectedId = useOutput((s) => s.selectedId);
  const { t } = useTranslation();
  const items = visibleItems(entry);
  return (
    <li role="treeitem" aria-expanded={open} aria-selected={selectedId === entry.id}>
      <div className={`outline-row entry ${selectedId === entry.id ? 'on' : ''}`}>
        <button type="button" className="outline-toggle" aria-label={open ? t('output.collapse') : t('output.expand')} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'expand_more' : 'chevron_right'} size={18} />
        </button>
        <button type="button" className="outline-label" onClick={() => onPick(entry.id)} title={entryTitle(entry, t)}>
          {entry.status === 'error' ? <span className="status-dot error" aria-label={t('output.severity.error')} /> : entry.pinned ? <Icon name="push_pin" size={14} filled /> : null}
          <span>{entryTitle(entry, t)}</span>
        </button>
        <time className="outline-time">{new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
      </div>
      {open && (
        <ul role="group">
          {items.map((it) => (
            <OutlineNode key={it.id} item={it} onPick={onPick} depth={1} />
          ))}
        </ul>
      )}
    </li>
  );
}

const GOAL_CARDS = [
  { goal: 'describe', icon: 'bar_chart' },
  { goal: 'compare', icon: 'compare_arrows' },
  { goal: 'relate', icon: 'scatter_plot' },
  { goal: 'reliability', icon: 'verified' },
];

export function OutputView() {
  const { t, i18n } = useTranslation();
  const entries = useOutput((s) => s.entries);
  const select = useOutput((s) => s.select);
  const clear = useOutput((s) => s.clear);
  const tableStyle = useSettings((s) => s.tableStyle);
  const openModal = useUi((s) => s.openModal);
  const toast = useUi((s) => s.toast);
  const zoom = useUi((s) => s.zoom);
  const hasData = useData((s) => !!s.dataset);
  const [outlineOpen, setOutlineOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth > 900);
  const [query, setQuery] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const lastCount = useRef(entries.length);

  // scroll to the newest entry
  useEffect(() => {
    if (entries.length > lastCount.current) {
      const last = entries[entries.length - 1];
      requestAnimationFrame(() => document.getElementById(`out-${last.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    lastCount.current = entries.length;
  }, [entries]);

  const pick = (id: string) => {
    select(id);
    document.getElementById(`out-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (window.innerWidth <= 900) setOutlineOpen(false);
  };

  const q = query.trim().toLowerCase();
  const matching = q ? entries.filter((e) => `${entryTitle(e, t)} ${e.title} ${e.syntax}`.toLowerCase().includes(q)) : entries;
  const pinned = matching.filter((e) => e.pinned);
  const byDay: { label: string; items: OutputEntry[] }[] = [];
  for (const e of [...matching].reverse()) {
    const label = dayLabel(e.time, t, i18n.language);
    const last = byDay[byDay.length - 1];
    if (last?.label === label) last.items.push(e);
    else byDay.push({ label, items: [e] });
  }

  return (
    <div className="output-view">
      <div className="output-bar" role="toolbar" aria-label={t('output.toolbar')}>
        <IconButton icon={outlineOpen ? 'left_panel_close' : 'left_panel_open'} small label={t('output.toggleOutline')} pressed={outlineOpen} onClick={() => setOutlineOpen(!outlineOpen)} />
        <span className="output-bar-title">{t('views.output')}</span>
        {entries.length > 0 && <span className="output-bar-count">{t('output.results', { count: entries.length })}</span>}
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openModal({ kind: 'assistant' })} disabled={!hasData}>
          <Icon name="explore" />
          <span className="hide-sm">{t('output.analyze')}</span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={exportOutputHtml} disabled={!entries.length}>
          <Icon name="download" />
          <span className="hide-sm">{t('output.exportHtml')}</span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={printOutput} disabled={!entries.length}>
          <Icon name="print" />
          <span className="hide-sm">{t('output.print')}</span>
        </button>
        <IconButton
          icon="delete_sweep"
          small
          label={t('output.clearAll')}
          disabled={!entries.length}
          onClick={() => {
            clear();
            toast(t('output.cleared'), { action: { label: t('output.undo'), run: () => useOutput.getState().undoRemove() } });
          }}
        />
      </div>
      <div className="output-body">
        {outlineOpen && (
          <aside className="output-outline" aria-label={t('output.outline')}>
            {entries.length === 0 ? (
              <p className="outline-empty">{t('output.outlineEmpty')}</p>
            ) : (
              <>
                <div className="outline-search">
                  <Icon name="search" />
                  <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('output.search')} aria-label={t('output.search')} />
                </div>
                {pinned.length > 0 && (
                  <>
                    <h3 className="outline-heading">
                      <Icon name="push_pin" size={14} />
                      {t('output.pinned')}
                    </h3>
                    <ul role="tree" aria-label={t('output.pinned')}>
                      {pinned.map((e) => (
                        <EntryOutline key={`p-${e.id}`} entry={e} onPick={pick} />
                      ))}
                    </ul>
                  </>
                )}
                {byDay.map((d) => (
                  <div key={d.label}>
                    <h3 className="outline-heading">{d.label}</h3>
                    <ul role="tree" aria-label={d.label}>
                      {d.items.map((e) => (
                        <EntryOutline key={e.id} entry={e} onPick={pick} />
                      ))}
                    </ul>
                  </div>
                ))}
                {q && !matching.length && <p className="outline-empty">{t('output.noMatch')}</p>}
              </>
            )}
          </aside>
        )}
        <div className="output-scroll" ref={scroller}>
          {entries.length === 0 ? (
            <div className="out-empty">
              <Icon name="article" />
              <h2>{t('output.emptyAsk')}</h2>
              <p>{t('output.emptyText')}</p>
              <div className="out-empty-goals">
                {GOAL_CARDS.map((g) => (
                  <button key={g.goal} type="button" className="out-empty-goal" disabled={!hasData} onClick={() => openModal({ kind: 'assistant' })}>
                    <Icon name={g.icon} />
                    {t(`assistant.goal.${g.goal}.title`)}
                  </button>
                ))}
              </div>
              <p className="out-empty-hint">{hasData ? t('output.emptyOrMenu') : t('assistant.noData')}</p>
            </div>
          ) : (
            <div className={`output-doc ts-${tableStyle}`} style={{ zoom: zoom !== 1 ? zoom : undefined }}>
              {entries.map((e) => (
                <EntryArticle key={e.id} e={e} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
