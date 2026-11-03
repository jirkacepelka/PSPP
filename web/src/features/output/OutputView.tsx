/*
 * Output viewer: outline on the left, paper-like pages in the centre.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import type { OutputItem } from '../../engine/types';
import { useOutput, type OutputEntry } from '../../store/output';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { exportOutputHtml, printOutput } from '../../app/files';
import { pasteSyntax } from '../../app/engine';
import { ChartView } from './ChartView';

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

function tableToTsv(table: HTMLTableElement): string {
  return Array.from(table.rows)
    .map((r) => Array.from(r.cells).map((c) => c.innerText.replace(/\s+/g, ' ').trim()).join('\t'))
    .join('\n');
}

async function copyTable(el: HTMLElement | null, toast: (m: string) => void, t: (k: string) => string) {
  const table = el?.querySelector('table');
  if (!table) return;
  const html = table.outerHTML;
  const text = tableToTsv(table);
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    } else await navigator.clipboard.writeText(text);
    toast(t('output.copied'));
  } catch {
    toast(t('output.copyFailed'));
  }
}

function Item({ item, depth }: { item: OutputItem; depth: number }) {
  const { t } = useTranslation();
  const remove = useOutput((s) => s.remove);
  const toast = useUi((s) => s.toast);
  const selectedId = useOutput((s) => s.selectedId);
  const ref = useRef<HTMLDivElement>(null);
  if ((item as { hidden?: boolean }).hidden) return null;
  if ((item as { kind: string }).kind === 'page-break') return <hr className="page-break" />;
  const selected = selectedId === item.id;
  const actions = (copy: boolean) => (
    <div className="item-actions">
      {copy && <IconButton icon="content_copy" small label={t('output.copyTable')} onClick={() => void copyTable(ref.current, (m) => toast(m), t)} />}
      <IconButton icon="delete" small label={t('output.deleteItem')} onClick={() => remove(item.id)} />
    </div>
  );
  switch (item.kind) {
    case 'group':
      return (
        <section className={`output-group depth-${depth}`} id={`out-${item.id}`}>
          {depth > 0 && <h3 className="output-subgroup-title">{item.title}</h3>}
          {item.children.map((c) => (
            <Item key={c.id} item={c} depth={depth + 1} />
          ))}
        </section>
      );
    case 'table':
      return (
        <div className={`output-item has-actions ${selected ? 'selected' : ''}`} id={`out-${item.id}`} ref={ref}>
          {actions(true)}
          <div className="table-wrap" dangerouslySetInnerHTML={{ __html: item.html }} />
        </div>
      );
    case 'text':
      if (item.subtype === 'title') return <h1 className="output-text-title" id={`out-${item.id}`}>{item.text}</h1>;
      if (item.subtype === 'subtitle' || item.subtype === 'page-title') return <h2 className="output-text-subtitle" id={`out-${item.id}`}>{item.text}</h2>;
      return (
        <pre className="output-text-log" id={`out-${item.id}`}>
          {item.text}
        </pre>
      );
    case 'message':
      return (
        <div className={`callout ${item.severity}`} id={`out-${item.id}`} role={item.severity === 'error' ? 'alert' : undefined}>
          <Icon name={itemIcon(item)} filled />
          <span>
            <strong>{t(`output.severity.${item.severity}`)}:</strong> {item.text}
          </span>
          {item.line && <span className="callout-line">{t('output.line', { line: item.line })}</span>}
        </div>
      );
    case 'chart':
      return (
        <figure className={`output-item has-actions chart-item ${selected ? 'selected' : ''}`} id={`out-${item.id}`} data-chart-id={item.id}>
          {actions(false)}
          <figcaption className="item-title">{item.title}</figcaption>
          <ChartView chart={item.chart} title={item.title} />
        </figure>
      );
    case 'image':
      return (
        <figure className="output-item has-actions" id={`out-${item.id}`}>
          {actions(false)}
          <img src={item.src} alt={item.title} style={{ maxWidth: '100%' }} />
          <figcaption className="item-title">{item.title}</figcaption>
        </figure>
      );
    default:
      return null;
  }
}

function OutlineNode({ item, onPick, depth }: { item: OutputItem; onPick: (id: string) => void; depth: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const selectedId = useOutput((s) => s.selectedId);
  if ((item as { hidden?: boolean }).hidden || (item as { kind: string }).kind === 'page-break') return null;
  const isGroup = item.kind === 'group';
  return (
    <li role="treeitem" aria-expanded={isGroup ? open : undefined} aria-selected={selectedId === item.id}>
      <div className={`outline-row ${selectedId === item.id ? 'on' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
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
  const [open, setOpen] = useState(true);
  const selectedId = useOutput((s) => s.selectedId);
  const { t } = useTranslation();
  return (
    <li role="treeitem" aria-expanded={open} aria-selected={selectedId === entry.id}>
      <div className={`outline-row entry ${selectedId === entry.id ? 'on' : ''}`}>
        <button type="button" className="outline-toggle" aria-label={open ? t('output.collapse') : t('output.expand')} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'expand_more' : 'chevron_right'} size={18} />
        </button>
        <button type="button" className="outline-label" onClick={() => onPick(entry.id)}>
          <Icon name="article" size={16} />
          <span>{entry.title}</span>
        </button>
      </div>
      {open && (
        <ul role="group">
          {entry.items.map((it) => (
            <OutlineNode key={it.id} item={it} onPick={onPick} depth={1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OutputView() {
  const { t } = useTranslation();
  const entries = useOutput((s) => s.entries);
  const select = useOutput((s) => s.select);
  const clear = useOutput((s) => s.clear);
  const removeEntry = useOutput((s) => s.remove);
  const tableStyle = useSettings((s) => s.tableStyle);
  const openModal = useUi((s) => s.openModal);
  const zoom = useUi((s) => s.zoom);
  const [outlineOpen, setOutlineOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth > 900);
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

  return (
    <div className="output-view">
      <div className="output-bar" role="toolbar" aria-label={t('output.toolbar')}>
        <IconButton icon={outlineOpen ? 'left_panel_close' : 'left_panel_open'} small label={t('output.toggleOutline')} pressed={outlineOpen} onClick={() => setOutlineOpen(!outlineOpen)} />
        <span className="output-bar-title">{t('views.output')}</span>
        <span className="spacer" />
        <button type="button" className="btn btn-text btn-sm" onClick={exportOutputHtml} disabled={!entries.length}>
          <Icon name="download" />
          <span className="hide-sm">{t('output.exportHtml')}</span>
        </button>
        <button type="button" className="btn btn-text btn-sm" onClick={printOutput} disabled={!entries.length}>
          <Icon name="print" />
          <span className="hide-sm">{t('output.print')}</span>
        </button>
        <button
          type="button"
          className="btn btn-text btn-sm"
          disabled={!entries.length}
          onClick={() => openModal({ kind: 'confirm', titleKey: 'output.clearTitle', messageKey: 'output.clearMessage', confirmKey: 'output.clearConfirm', danger: true, onConfirm: clear })}
        >
          <Icon name="delete_sweep" />
          <span className="hide-sm">{t('output.clearAll')}</span>
        </button>
      </div>
      <div className="output-body">
        {outlineOpen && (
          <aside className="output-outline" aria-label={t('output.outline')}>
            {entries.length === 0 ? (
              <p className="outline-empty">{t('output.outlineEmpty')}</p>
            ) : (
              <ul role="tree" aria-label={t('output.outline')}>
                {entries.map((e) => (
                  <EntryOutline key={e.id} entry={e} onPick={pick} />
                ))}
              </ul>
            )}
          </aside>
        )}
        <div className="output-scroll" ref={scroller}>
          {entries.length === 0 ? (
            <div className="empty-hint output-empty">
              <Icon name="article" />
              <h2>{t('output.emptyTitle')}</h2>
              <p>{t('output.emptyText')}</p>
              <div className="empty-actions">
                <button type="button" className="btn btn-tonal" onClick={() => openModal({ kind: 'analysis', specId: 'frequencies' })}>
                  <Icon name="bar_chart" />
                  {t('dlg.frequencies.title')}
                </button>
                <button type="button" className="btn btn-tonal" onClick={() => openModal({ kind: 'analysis', specId: 'descriptives' })}>
                  <Icon name="functions" />
                  {t('dlg.descriptives.title')}
                </button>
              </div>
            </div>
          ) : (
            <div className={`output-doc ts-${tableStyle}`} style={{ zoom: zoom !== 1 ? zoom : undefined }}>
              {entries.map((e) => (
                <article key={e.id} className="paper" id={`out-${e.id}`}>
                  <header className="paper-head">
                    <h2 className="output-group-title">{e.title}</h2>
                    <time className="paper-time" dateTime={new Date(e.time).toISOString()}>
                      {new Date(e.time).toLocaleTimeString()}
                    </time>
                    <div className="paper-actions">
                      {e.syntax && <IconButton icon="content_paste_go" small label={t('output.pasteSyntax')} onClick={() => pasteSyntax(e.syntax)} />}
                      <IconButton icon="delete" small label={t('output.deleteEntry')} onClick={() => removeEntry(e.id)} />
                    </div>
                  </header>
                  {e.syntax && (
                    <details className="paper-syntax">
                      <summary>{t('output.showSyntax')}</summary>
                      <pre className="output-syntax">{e.syntax}</pre>
                    </details>
                  )}
                  {e.items.length === 0 && <p className="paper-note">{t('output.noItems')}</p>}
                  {e.items.map((it) => (
                    <Item key={it.id} item={it} depth={0} />
                  ))}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
