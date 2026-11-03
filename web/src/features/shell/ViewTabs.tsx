/*
 * Bottom tab strip (like spreadsheet sheet tabs): Data, Variables, Output and syntax tabs.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { useOutput } from '../../store/output';
import { useSyntax } from '../../store/syntax';
import { useUi, type View } from '../../store/ui';

export function ViewTabs() {
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
  const [editing, setEditing] = useState<string | null>(null);

  const fixed: { v: View; icon: string; label: string }[] = [
    { v: 'data', icon: 'table', label: t('views.data') },
    { v: 'variables', icon: 'view_list', label: t('views.variables') },
    { v: 'output', icon: 'article', label: t('views.output') },
  ];

  return (
    <div className="view-tabs" role="tablist" aria-label={t('views.label')}>
      <IconButton
        icon="add"
        small
        label={t('views.addSyntax')}
        onClick={() => {
          addTab();
          setView('syntax');
        }}
      />
      <div className="view-tabs-scroll">
        {fixed.map((f) => (
          <button
            key={f.v}
            type="button"
            role="tab"
            aria-selected={!showStart && view === f.v}
            className="view-tab"
            onClick={() => setView(f.v)}
          >
            <Icon name={f.icon} />
            <span>{f.label}</span>
            {f.v === 'output' && outCount > 0 && <span className="badge">{outCount}</span>}
          </button>
        ))}
        {tabs.map((tab) => {
          const on = !showStart && view === 'syntax' && activeId === tab.id;
          const errs = tab.diagnostics.filter((d) => d.severity === 'error').length;
          return (
            <div key={tab.id} className={`view-tab syntax-tab ${on ? 'on' : ''}`} role="presentation">
              {editing === tab.id ? (
                <input
                  className="tab-rename"
                  autoFocus
                  defaultValue={tab.title}
                  aria-label={t('views.renameSyntax')}
                  onBlur={(e) => {
                    if (e.target.value.trim()) rename(tab.id, e.target.value.trim());
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className="syntax-tab-btn"
                  onClick={() => {
                    setActive(tab.id);
                    setView('syntax');
                  }}
                  onDoubleClick={() => setEditing(tab.id)}
                  title={t('views.renameHint')}
                >
                  <Icon name="code" />
                  <span>{tab.title}</span>
                  {errs > 0 && <span className="badge err" aria-label={t('views.errors', { count: errs })}>{errs}</span>}
                </button>
              )}
              <button type="button" className="tab-close" aria-label={t('views.closeSyntax', { name: tab.title })} onClick={() => closeTab(tab.id)}>
                <Icon name="close" size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
