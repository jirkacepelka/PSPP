/*
 * Header: logo · (editable title + autosave status / menu bar) · engine status · profile ·
 * search/command field. The title text and the first menu item's text share one left edge;
 * the search field's right edge is the workspace gutter.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { Spinner } from '../../components/Button';
import { useData } from '../../store/data';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { formatShortcut, openPalette } from '../../app/actions';
import { MenuBar } from './MenuBar';
import { ProfileButton } from './ProfileMenu';
import { LogoMark } from './Logo';

function SaveStatus() {
  const { t } = useTranslation();
  const dirty = useData((s) => s.dirty);
  const hasData = useData((s) => !!s.dataset);
  const autosave = useSettings((s) => s.autosave);
  const [saved, setSaved] = useState<number | null>(null);
  useEffect(() => {
    const on = (e: Event) => setSaved((e as CustomEvent<number>).detail);
    window.addEventListener('pspp-autosaved', on);
    return () => window.removeEventListener('pspp-autosaved', on);
  }, []);
  if (!hasData) return null;
  let icon = 'devices';
  let text = t('appbar.savedInBrowser');
  let tone = '';
  if (!autosave && dirty) {
    icon = 'edit';
    text = t('appbar.unsaved');
    tone = 'warn';
  } else if (autosave && dirty && !saved) {
    icon = 'sync';
    text = t('appbar.saving');
  }
  const tip = `${saved ? t('appbar.lastSaved', { time: new Date(saved).toLocaleTimeString() }) : text}. ${t('shell.saveHint', { key: formatShortcut('Mod+S') })}`;
  return (
    <span className={`sh-save ${tone}`} title={tip} role="status">
      <Icon name={icon} size={14} />
      <span className="sh-save-text">{text}</span>
    </span>
  );
}

function TitleInput() {
  const { t } = useTranslation();
  const title = useData((s) => s.title);
  const hasData = useData((s) => !!s.dataset);
  const setTitle = useData((s) => s.setTitle);
  const [draft, setDraft] = useState(title);
  const ref = useRef<HTMLInputElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [w, setW] = useState<number | undefined>();
  useEffect(() => setDraft(title), [title]);
  useEffect(() => {
    if (measure.current) setW(Math.ceil(measure.current.getBoundingClientRect().width) + 2);
  }, [draft, hasData]);
  const commit = () => {
    const v = draft.trim();
    if (v && v !== title) setTitle(v);
    else setDraft(title);
  };
  if (!hasData) return <span className="sh-title static">PSPP Studio</span>;
  return (
    <span className="sh-title-wrap">
      <span ref={measure} className="sh-title sh-title-measure" aria-hidden="true">
        {draft || ' '}
      </span>
      <input
        ref={ref}
        className="sh-title"
        value={draft}
        style={w ? { width: w } : undefined}
        aria-label={t('appbar.documentTitle')}
        title={t('shell.renameHint')}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            ref.current?.blur();
          } else if (e.key === 'Escape') {
            setDraft(title);
            setTimeout(() => ref.current?.blur(), 0);
          }
        }}
      />
    </span>
  );
}

/** Compact engine indicator: what the PSPP engine is doing right now (SH-7/SH-11). */
export function EngineStatus() {
  const { t } = useTranslation();
  const status = useUi((s) => s.engineStatus);
  const kind = useUi((s) => s.engineKind);
  const version = useUi((s) => s.engineVersion);
  const tip = `${t(`engine.${status}`)}${version ? ` · ${version}` : ''}`;
  return (
    <span className={`sh-engine is-${status}`} title={tip} role="status" aria-live="polite">
      {status === 'running' || status === 'loading' ? <Spinner /> : <span className="sh-engine-dot" aria-hidden="true" />}
      <span className="sh-engine-text">{t(`shell.engine.${status}`)}</span>
      {kind === 'mock' && status !== 'loading' && <span className="sh-engine-demo">{t('engine.demo')}</span>}
    </span>
  );
}

export function SearchField() {
  const { t } = useTranslation();
  return (
    <button type="button" className="sh-search" onClick={() => openPalette()} aria-label={`${t('appbar.search')} (${formatShortcut('Mod+K')})`} aria-keyshortcuts="Control+K">
      <Icon name="search" size={18} />
      <span className="sh-search-text">{t('shell.searchPlaceholder')}</span>
      <kbd className="kbd sh-search-kbd">{formatShortcut('Mod+K')}</kbd>
    </button>
  );
}

export function AppBar() {
  const { t } = useTranslation();
  const setMobileMenu = useUi((s) => s.setMobileMenu);
  const setShowStart = useUi((s) => s.setShowStart);
  return (
    <header className="sh-header">
      <IconButton icon="menu" className="sh-hamburger" label={t('appbar.openMenu')} onClick={() => setMobileMenu(true)} tip={false} />
      <button type="button" className="sh-logo" onClick={() => setShowStart(true)} aria-label={t('appbar.home')} data-tip={t('appbar.home')}>
        <LogoMark size={32} />
      </button>
      <div className="sh-doc">
        <div className="sh-title-row">
          <TitleInput />
          <SaveStatus />
        </div>
        <MenuBar />
      </div>
      <div className="sh-tools">
        <EngineStatus />
        <ProfileButton />
        <SearchField />
        <IconButton icon="search" className="sh-search-icon" label={t('appbar.search')} onClick={() => openPalette()} tip={false} />
      </div>
    </header>
  );
}
