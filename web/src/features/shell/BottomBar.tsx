/*
 * Bottom row: view tabs (Data, Proměnné, Výstup), syntax document tabs, the journal toggle and
 * the status facts (cases, variables, zoom) merged into one 32px row (audit SH-5/SH-9).
 * Tabs follow the WAI-ARIA tabs pattern: roving tabindex, ←/→/Home/End, Delete closes a
 * syntax tab. On phones the row becomes a 4-item bottom navigation.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { formatShortcut, runAction } from '../../app/actions';
import { caseCount } from '../../lib/variables';
import { useData } from '../../store/data';
import { useOutput } from '../../store/output';
import { useSettings } from '../../store/settings';
import { useSyntax } from '../../store/syntax';
import { useUi, type View } from '../../store/ui';
import { useLayout } from './layout';

export const tabDomId = (key: string) => `sh-tab-${key}`;

/** Id of the tab that labels the main panel. */
export function activeTabKey(view: View, syntaxId: string): string {
  return view === 'syntax' ? `syn-${syntaxId}` : view;
}

function onTabKeys(e: KeyboardEvent<HTMLElement>) {
  const list = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')).filter((el) => el.offsetParent !== null);
  const i = list.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  let next = -1;
  if (e.key === 'ArrowRight') next = (i + 1) % list.length;
  else if (e.key === 'ArrowLeft') next = (i - 1 + list.length) % list.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = list.length - 1;
  if (next < 0) return;
  e.preventDefault();
  list[next].focus();
  list[next].click();
}

function StatusFacts() {
  const { t } = useTranslation();
  const ds = useData((s) => s.dataset);
  const zoom = useUi((s) => s.zoom);
  const showStatus = useSettings((s) => s.showStatusBar);
  if (!showStatus) return null;
  const n = caseCount(ds);
  return (
    <div className="sh-status" aria-label={t('shell.statusLabel')} role="group">
      {ds ? (
        <>
          <span className="sh-fact" title={t('shell.caseHint')}>
            {t('status.cases', { count: n })}
          </span>
          <span className="sh-fact sh-fact-vars">{t('status.variables', { count: ds.variables.length })}</span>
        </>
      ) : (
        <span className="sh-fact">{t('status.noData')}</span>
      )}
      <span className="sh-zoom" role="group" aria-label={t('toolbar.zoom')}>
        <IconButton icon="remove" small label={t('actions.zoomOut')} shortcut={formatShortcut('Mod+-')} tipPlacement="top" onClick={() => runAction('view.zoomOut')} />
        <button type="button" className="sh-zoom-value" onClick={() => runAction('view.zoomReset')} title={`${t('actions.zoomReset')} (${formatShortcut('Mod+0')})`}>
          {Math.round(zoom * 100)} %
        </button>
        <IconButton icon="add" small label={t('actions.zoomIn')} shortcut={formatShortcut('Mod+=')} tipPlacement="top" onClick={() => runAction('view.zoomIn')} />
      </span>
    </div>
  );
}

export function BottomBar() {
  const { t } = useTranslation();
  const view = useUi((s) => s.view);
  const showStart = useUi((s) => s.showStart);
  const setView = useUi((s) => s.setView);
  const tabs = useSyntax((s) => s.tabs);
  const activeId = useSyntax((s) => s.activeId);
  const setActive = useSyntax((s) => s.setActive);
  const addTab = useSyntax((s) => s.add);
  const closeTab = useSyntax((s) => s.close);
  const rename = useSyntax((s) => s.rename);
  const outCount = useOutput((s) => s.entries.length);
  const journalOpen = useLayout((s) => s.journalOpen);
  const [editing, setEditing] = useState<string | null>(null);
  const tablist = useRef<HTMLDivElement>(null);

  const fixed: { v: View; icon: string; label: string; mobileOnly?: boolean }[] = [
    { v: 'data', icon: 'table', label: t('views.data') },
    { v: 'variables', icon: 'view_list', label: t('views.variables') },
    { v: 'output', icon: 'article', label: t('views.output') },
    { v: 'syntax', icon: 'code', label: t('views.syntax'), mobileOnly: true },
  ];
  const activeKey = showStart ? '' : activeTabKey(view, activeId);

  return (
    <div className={`sh-bottom ${showStart ? 'on-start' : ''}`}>
      {!showStart && (
        <nav className="sh-tabs-nav" aria-label={t('views.label')}>
          <div className="sh-tabs" role="tablist" aria-label={t('views.label')} ref={tablist} onKeyDown={onTabKeys}>
            {fixed.map((f, i) => {
              const key = f.v;
              const on = f.mobileOnly ? view === 'syntax' : activeKey === key;
              return (
                <button
                  key={key}
                  id={f.mobileOnly ? undefined : tabDomId(key)}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls={f.mobileOnly ? undefined : 'sh-panel'}
                  aria-keyshortcuts={`Alt+${i + 1}`}
                  tabIndex={on && !f.mobileOnly ? 0 : -1}
                  className={`sh-tab ${f.mobileOnly ? 'sh-tab-mobile' : ''}`}
                  title={`${f.label} (${formatShortcut(`Alt+${i + 1}`)})`}
                  onClick={() => setView(f.v)}
                >
                  <Icon name={f.icon} filled={on} />
                  <span className="sh-tab-label">{f.label}</span>
                  {f.v === 'output' && outCount > 0 && (
                    <span className="sh-count" aria-label={t('shell.results', { count: outCount })}>
                      {outCount}
                    </span>
                  )}
                </button>
              );
            })}
            <span className="sh-tabs-sep" role="presentation" />
            {tabs.map((tab) => {
              const key = `syn-${tab.id}`;
              const on = activeKey === key;
              const errs = tab.diagnostics.filter((d) => d.severity === 'error').length;
              return (
                <span key={tab.id} className={`sh-tab sh-syntax-tab ${on ? 'on' : ''}`} role="presentation">
                  {editing === tab.id ? (
                    <input
                      className="sh-tab-rename"
                      autoFocus
                      defaultValue={tab.title}
                      aria-label={t('views.renameSyntax')}
                      onBlur={(e) => {
                        if (e.target.value.trim()) rename(tab.id, e.target.value.trim());
                        setEditing(null);
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      role="tab"
                      id={tabDomId(key)}
                      aria-selected={on}
                      aria-controls="sh-panel"
                      tabIndex={on ? 0 : -1}
                      className="sh-tab-btn"
                      onClick={() => {
                        setActive(tab.id);
                        setView('syntax');
                      }}
                      onDoubleClick={() => setEditing(tab.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Delete') closeTab(tab.id);
                        if (e.key === 'F2') setEditing(tab.id);
                      }}
                      title={t('shell.syntaxTabHint')}
                    >
                      <Icon name="code" />
                      <span className="sh-tab-label">{tab.title}</span>
                      {errs > 0 && (
                        <span className="sh-count danger" aria-label={t('views.errors', { count: errs })}>
                          <Icon name="error" size={12} />
                          {errs}
                        </span>
                      )}
                    </button>
                  )}
                  <button type="button" className="sh-tab-close" tabIndex={-1} aria-label={t('views.closeSyntax', { name: tab.title })} onClick={() => closeTab(tab.id)}>
                    <Icon name="close" size={14} />
                  </button>
                </span>
              );
            })}
          </div>
          <IconButton
            icon="add"
            small
            className="sh-tab-add"
            label={t('views.addSyntax')}
            tipPlacement="top"
            onClick={() => {
              addTab();
              setView('syntax');
            }}
          />
          <button type="button" className={`sh-journal-toggle ${journalOpen ? 'on' : ''}`} aria-pressed={journalOpen} onClick={() => runAction('view.journal')} title={`${t('shell.actions.journal')} (${formatShortcut('Mod+Shift+J')})`}>
            <Icon name="history_edu" />
            <span>{t('shell.journal.tab')}</span>
          </button>
        </nav>
      )}
      <span className="spacer" />
      <StatusFacts />
    </div>
  );
}
