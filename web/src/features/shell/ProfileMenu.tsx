/*
 * Profile avatar and popover (local profile stored in this browser).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { useSettings, type Profile } from '../../store/settings';
import { useUi } from '../../store/ui';

export function Avatar({ profile, large }: { profile: Profile; large?: boolean }) {
  return (
    <span
      className={`avatar ${large ? 'lg' : ''}`}
      style={{ backgroundColor: profile.avatar ? 'transparent' : profile.color, backgroundImage: profile.avatar ? `url(${profile.avatar})` : undefined }}
      aria-hidden="true"
    >
      {profile.avatar ? '' : profile.initials || <span className="icon filled" style={{ fontSize: large ? 44 : 22 }}>person</span>}
    </span>
  );
}

export function ProfileButton() {
  const { t } = useTranslation();
  const profile = useSettings((s) => s.profile);
  const language = useSettings((s) => s.language);
  const theme = useSettings((s) => s.theme);
  const set = useSettings((s) => s.set);
  const openModal = useUi((s) => s.openModal);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector<HTMLElement>('button')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const r = btn.current?.getBoundingClientRect();
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="avatar-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('profile.open', { name: profile.name || t('profile.defaultName') })}
        data-tip={profile.name || t('profile.defaultName')}
        onClick={() => setOpen(!open)}
      >
        <Avatar profile={profile} />
      </button>
      {open &&
        r &&
        createPortal(
          <div
            ref={pop}
            className="profile-pop"
            role="dialog"
            aria-label={t('profile.title')}
            style={{ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setOpen(false);
                btn.current?.focus();
              }
            }}
          >
            <div className="profile-head">
              <Avatar profile={profile} large />
              <div className="profile-name">{profile.name ? t('profile.greeting', { name: profile.name.split(' ')[0] }) : t('profile.greetingAnon')}</div>
              <div className="profile-sub">
                <Icon name="lock" size={16} />
                {t('profile.localOnly')}
              </div>
              <button
                type="button"
                className="btn btn-outlined"
                onClick={() => {
                  setOpen(false);
                  openModal({ kind: 'settings', section: 'profile' });
                }}
              >
                {t('profile.manage')}
              </button>
            </div>
            <div className="profile-rows">
              <div className="profile-row">
                <Icon name="translate" />
                <span>{t('settings.language')}</span>
                <div className="segmented">
                  {(['cs', 'en'] as const).map((l) => (
                    <button key={l} type="button" aria-pressed={language === l} onClick={() => set({ language: l })}>
                      {l === 'cs' ? 'Čeština' : 'English'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="profile-row">
                <Icon name="contrast" />
                <span>{t('settings.theme')}</span>
                <div className="segmented">
                  {(['light', 'dark', 'system'] as const).map((m) => (
                    <button key={m} type="button" aria-pressed={theme === m} aria-label={t(`settings.theme${m[0].toUpperCase()}${m.slice(1)}`)} title={t(`settings.theme${m[0].toUpperCase()}${m.slice(1)}`)} onClick={() => set({ theme: m })}>
                      <Icon name={m === 'light' ? 'light_mode' : m === 'dark' ? 'dark_mode' : 'brightness_auto'} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="profile-foot">
              <button
                type="button"
                className="btn btn-text"
                onClick={() => {
                  setOpen(false);
                  openModal({ kind: 'settings' });
                }}
              >
                <Icon name="settings" />
                {t('actions.settings')}
              </button>
              <button
                type="button"
                className="btn btn-text"
                onClick={() => {
                  setOpen(false);
                  openModal({ kind: 'about' });
                }}
              >
                <Icon name="info" />
                {t('actions.about')}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
