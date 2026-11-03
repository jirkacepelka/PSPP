/*
 * Top app bar: logo, editable document title, save status, menu bar and global actions.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { useData } from '../../store/data';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { formatShortcut } from '../../app/actions';
import { resolvedDark } from '../../app/theme';
import { kvGet, kvSet } from '../../lib/storage';
import { MenuBar } from './MenuBar';
import { ProfileButton } from './ProfileMenu';

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
  let icon = 'cloud_done';
  let text = t('appbar.savedInBrowser');
  if (!autosave && dirty) {
    icon = 'edit';
    text = t('appbar.unsaved');
  } else if (autosave && dirty && !saved) {
    icon = 'sync';
    text = t('appbar.saving');
  }
  return (
    <span className="save-status" title={saved ? t('appbar.lastSaved', { time: new Date(saved).toLocaleTimeString() }) : text} role="status">
      <Icon name={icon} />
      <span className="save-status-text">{text}</span>
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
  useEffect(() => setDraft(title), [title]);
  const commit = () => {
    const v = draft.trim();
    if (v && v !== title) setTitle(v);
    else setDraft(title);
  };
  if (!hasData) return <span className="doc-title static">PSPP Studio</span>;
  return (
    <input
      ref={ref}
      className="doc-title"
      value={draft}
      aria-label={t('appbar.documentTitle')}
      size={Math.max(8, Math.min(40, draft.length + 1))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          ref.current?.blur();
        } else if (e.key === 'Escape') {
          setDraft(title);
          ref.current?.blur();
        }
      }}
    />
  );
}

function StarButton() {
  const { t } = useTranslation();
  const title = useData((s) => s.title);
  const hasData = useData((s) => !!s.dataset);
  const [starred, setStarred] = useState<string[]>([]);
  useEffect(() => {
    void kvGet<string[]>('starred').then((s) => Array.isArray(s) && setStarred(s));
  }, []);
  if (!hasData) return null;
  const on = starred.includes(title);
  return (
    <IconButton
      icon="star"
      small
      pressed={on}
      className="star-btn"
      label={on ? t('appbar.unstar') : t('appbar.star')}
      onClick={() => {
        const next = on ? starred.filter((s) => s !== title) : [...starred, title];
        setStarred(next);
        void kvSet('starred', next);
      }}
    />
  );
}

export function AppBar() {
  const { t } = useTranslation();
  const setPalette = useUi((s) => s.setPalette);
  const setMobileMenu = useUi((s) => s.setMobileMenu);
  const setShowStart = useUi((s) => s.setShowStart);
  const theme = useSettings((s) => s.theme);
  const setSettings = useSettings((s) => s.set);
  const dark = resolvedDark({ theme });
  return (
    <header className="appbar">
      <IconButton icon="menu" className="hamburger" label={t('appbar.openMenu')} onClick={() => setMobileMenu(true)} tip={false} />
      <button type="button" className="app-logo" onClick={() => setShowStart(true)} aria-label={t('appbar.home')} data-tip={t('appbar.home')}>
        <img src="/favicon.svg" alt="" width={36} height={36} />
      </button>
      <div className="appbar-main">
        <div className="title-row">
          <TitleInput />
          <StarButton />
          <SaveStatus />
        </div>
        <MenuBar />
      </div>
      <div className="appbar-actions">
        <button type="button" className="search-pill" onClick={() => setPalette(true)} aria-label={t('appbar.search')}>
          <Icon name="search" />
          <span className="search-pill-text">{t('appbar.searchPlaceholder')}</span>
          <kbd className="kbd">{formatShortcut('Mod+K')}</kbd>
        </button>
        <IconButton icon="search" className="search-icon-only" label={t('appbar.search')} onClick={() => setPalette(true)} />
        <IconButton
          icon={dark ? 'light_mode' : 'dark_mode'}
          label={dark ? t('appbar.lightTheme') : t('appbar.darkTheme')}
          onClick={() => setSettings({ theme: dark ? 'light' : 'dark' })}
        />
        <ProfileButton />
      </div>
    </header>
  );
}
