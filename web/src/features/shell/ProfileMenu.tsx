/*
 * Profile avatar with a small popover: language and theme quick switches, Settings, About.
 * Uses the design-system Popover (focus moves in, Escape/outside click close, focus returns).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Popover } from '../../components/Popover';
import { Segmented } from '../../components/Segmented';
import { useSettings, type Profile } from '../../store/settings';
import { useUi } from '../../store/ui';

export function Avatar({ profile, large }: { profile: Profile; large?: boolean }) {
  return (
    <span
      className={`avatar sh-avatar ${large ? 'lg' : ''}`}
      style={{ backgroundColor: profile.avatar ? 'transparent' : profile.color, backgroundImage: profile.avatar ? `url(${profile.avatar})` : undefined }}
      aria-hidden="true"
    >
      {profile.avatar ? '' : profile.initials || <Icon name="person" filled size={large ? 40 : 20} />}
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
  const name = profile.name || t('profile.defaultName');
  const go = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="sh-avatar-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('profile.open', { name })}
        data-tip={name}
        onClick={() => setOpen(!open)}
      >
        <Avatar profile={profile} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={btn} label={t('profile.title')} placement="bottom-end" className="sh-profile-pop">
        <div className="sh-profile-head">
          <Avatar profile={profile} />
          <div className="sh-profile-who">
            <span className="sh-profile-name">{name}</span>
            <span className="sh-profile-sub">
              <Icon name="lock" size={14} />
              {t('profile.localOnly')}
            </span>
          </div>
        </div>
        <div className="sh-profile-rows">
          <div className="sh-profile-row">
            <span className="sh-profile-label">{t('settings.language')}</span>
            <Segmented
              size="sm"
              aria-label={t('settings.language')}
              value={language}
              onChange={(v) => set({ language: v })}
              options={[
                { value: 'cs', label: 'Čeština' },
                { value: 'en', label: 'English' },
              ]}
            />
          </div>
          <div className="sh-profile-row">
            <span className="sh-profile-label">{t('settings.theme')}</span>
            <Segmented
              size="sm"
              aria-label={t('settings.theme')}
              value={theme}
              onChange={(v) => set({ theme: v })}
              options={[
                { value: 'light', label: t('settings.themeLight'), icon: 'light_mode', iconOnly: true },
                { value: 'dark', label: t('settings.themeDark'), icon: 'dark_mode', iconOnly: true },
                { value: 'system', label: t('settings.themeSystem'), icon: 'brightness_auto', iconOnly: true },
              ]}
            />
          </div>
        </div>
        <div className="sh-profile-foot">
          <Button variant="ghost" size="sm" iconStart="settings" onClick={() => go(() => openModal({ kind: 'settings' }))}>
            {t('actions.settings')}
          </Button>
          <Button variant="ghost" size="sm" iconStart="person" onClick={() => go(() => openModal({ kind: 'settings', section: 'profile' }))}>
            {t('profile.title')}
          </Button>
          <Button variant="ghost" size="sm" iconStart="info" onClick={() => go(() => openModal({ kind: 'about' }))}>
            {t('shell.about')}
          </Button>
        </div>
      </Popover>
    </>
  );
}
