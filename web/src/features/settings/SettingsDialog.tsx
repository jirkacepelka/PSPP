/*
 * Settings: profile, appearance, language, numbers, editor, files, shortcuts, about.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { ACCENT_PRESETS, AVATAR_COLORS, initialsOf, useSettings, type Settings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { Avatar } from '../shell/ProfileMenu';
import { clearAutosave, clearRecent, getRecent } from '../../app/files';
import { ShortcutsList } from '../misc/ShortcutsDialog';
import { AboutContent } from '../misc/AboutDialog';

const SECTIONS = [
  { id: 'profile', icon: 'account_circle' },
  { id: 'appearance', icon: 'palette' },
  { id: 'language', icon: 'translate' },
  { id: 'data', icon: 'pin' },
  { id: 'editor', icon: 'code' },
  { id: 'files', icon: 'folder' },
  { id: 'shortcuts', icon: 'keyboard' },
  { id: 'about', icon: 'info' },
] as const;

function Row({ title, desc, children, htmlFor }: { title: string; desc?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        {htmlFor ? <label htmlFor={htmlFor} className="set-row-title">{title}</label> : <span className="set-row-title">{title}</span>}
        {desc && <span className="set-row-desc">{desc}</span>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

function Toggle({ k, label, desc }: { k: keyof Settings; label: string; desc?: string }) {
  const v = useSettings((s) => s[k]) as boolean;
  const set = useSettings((s) => s.set);
  return (
    <label className="switch set-switch">
      <span className="switch-text">
        <span>{label}</span>
        {desc && <small>{desc}</small>}
      </span>
      <input type="checkbox" role="switch" checked={v} onChange={(e) => set({ [k]: e.target.checked } as Partial<Settings>)} />
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; icon?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ProfileSection() {
  const { t } = useTranslation();
  const profile = useSettings((s) => s.profile);
  const setProfile = useSettings((s) => s.setProfile);
  const fileRef = useRef<HTMLInputElement>(null);
  const onFile = (f: File | undefined) => {
    if (!f) return;
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const c = document.createElement('canvas');
        const size = 128;
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        setProfile({ avatar: c.toDataURL('image/jpeg', 0.85) });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(f);
  };
  return (
    <>
      <div className="profile-card">
        <Avatar profile={profile} large />
        <div>
          <div className="profile-card-name">{profile.name || t('profile.defaultName')}</div>
          <div className="set-row-desc">
            <Icon name="lock" size={14} /> {t('profile.localOnlyLong')}
          </div>
        </div>
      </div>
      <Row title={t('profile.name')} htmlFor="pname">
        <input
          id="pname"
          className="input"
          placeholder={t('profile.namePlaceholder')}
          value={profile.name}
          onChange={(e) => {
            const name = e.target.value;
            const auto = profile.initials === initialsOf(profile.name);
            setProfile({ name, ...(auto ? { initials: initialsOf(name) } : {}) });
          }}
        />
      </Row>
      <Row title={t('profile.initials')} desc={t('profile.initialsDesc')} htmlFor="pinit">
        <input id="pinit" className="input initials-input" maxLength={3} value={profile.initials} onChange={(e) => setProfile({ initials: e.target.value.toUpperCase() })} />
      </Row>
      <Row title={t('profile.color')}>
        <div className="swatches" role="radiogroup" aria-label={t('profile.color')}>
          {AVATAR_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={profile.color === c} className="swatch" style={{ background: c }} aria-label={c} onClick={() => setProfile({ color: c })}>
              {profile.color === c && <Icon name="check" />}
            </button>
          ))}
          <label className="swatch custom" aria-label={t('settings.customColor')} data-tip={t('settings.customColor')}>
            <input type="color" value={profile.color} onChange={(e) => setProfile({ color: e.target.value })} />
            <Icon name="colorize" />
          </label>
        </div>
      </Row>
      <Row title={t('profile.photo')} desc={t('profile.photoDesc')}>
        <div className="row-gap">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button type="button" className="btn btn-outlined btn-sm" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" />
            {t('profile.upload')}
          </button>
          {profile.avatar && (
            <button type="button" className="btn btn-text btn-sm" onClick={() => setProfile({ avatar: undefined })}>
              {t('profile.removePhoto')}
            </button>
          )}
        </div>
      </Row>
    </>
  );
}

function AppearanceSection() {
  const { t } = useTranslation();
  const s = useSettings();
  return (
    <>
      <Row title={t('settings.theme')}>
        <Segmented
          label={t('settings.theme')}
          value={s.theme}
          onChange={(v) => s.set({ theme: v })}
          options={[
            { value: 'light', label: t('settings.themeLight'), icon: 'light_mode' },
            { value: 'dark', label: t('settings.themeDark'), icon: 'dark_mode' },
            { value: 'system', label: t('settings.themeSystem'), icon: 'brightness_auto' },
          ]}
        />
      </Row>
      <Row title={t('settings.accent')} desc={t('settings.accentDesc')}>
        <div className="swatches" role="radiogroup" aria-label={t('settings.accent')}>
          {ACCENT_PRESETS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={s.accent === c} className="swatch" style={{ background: c }} aria-label={c} onClick={() => s.set({ accent: c })}>
              {s.accent === c && <Icon name="check" />}
            </button>
          ))}
          <label className="swatch custom" aria-label={t('settings.customColor')} data-tip={t('settings.customColor')}>
            <input type="color" value={s.accent} onChange={(e) => s.set({ accent: e.target.value })} />
            <Icon name="colorize" />
          </label>
        </div>
      </Row>
      <Row title={t('settings.density')}>
        <Segmented
          label={t('settings.density')}
          value={s.density}
          onChange={(v) => s.set({ density: v })}
          options={[
            { value: 'comfortable', label: t('settings.comfortable'), icon: 'density_medium' },
            { value: 'compact', label: t('settings.compact'), icon: 'density_small' },
          ]}
        />
      </Row>
      <Row title={t('settings.fontSize')} desc={`${s.fontSize}px`} htmlFor="fsize">
        <input id="fsize" type="range" min={12} max={18} step={1} value={s.fontSize} onChange={(e) => s.set({ fontSize: Number(e.target.value) })} className="range" />
      </Row>
      <Row title={t('settings.gridFont')} htmlFor="gfont">
        <select id="gfont" className="select" value={s.gridFont} onChange={(e) => s.set({ gridFont: e.target.value as Settings['gridFont'] })}>
          <option value="system">{t('settings.fontSystem')}</option>
          <option value="inter">Inter</option>
          <option value="roboto">Roboto</option>
          <option value="mono">Roboto Mono</option>
        </select>
      </Row>
      <div className="set-subhead">{t('settings.tableStyle')}</div>
      <div className="style-cards" role="radiogroup" aria-label={t('settings.tableStyle')}>
        {(['modern', 'classic', 'apa', 'compact'] as const).map((st) => (
          <button key={st} type="button" role="radio" aria-checked={s.tableStyle === st} className={`style-card ${s.tableStyle === st ? 'on' : ''}`} onClick={() => s.set({ tableStyle: st })}>
            <div className={`output-doc ts-${st} style-preview`}>
              <table>
                <tbody>
                  <tr>
                    <th />
                    <th>N</th>
                    <th>{t('stat.mean')}</th>
                  </tr>
                  <tr>
                    <th>age</th>
                    <td className="num">120</td>
                    <td className="num">21.4</td>
                  </tr>
                  <tr>
                    <th>gpa</th>
                    <td className="num">118</td>
                    <td className="num">2.87</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <span className="style-name">{t(`settings.style.${st}`)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function LanguageSection() {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.language);
  const set = useSettings((s) => s.set);
  return (
    <div className="lang-list" role="radiogroup" aria-label={t('settings.language')}>
      {(
        [
          ['cs', 'Čeština', 'Czech'],
          ['en', 'English', 'Angličtina'],
        ] as const
      ).map(([code, name, other]) => (
        <label key={code} className={`lang-option ${lang === code ? 'on' : ''}`}>
          <input type="radio" name="lang" checked={lang === code} onChange={() => set({ language: code })} />
          <span className="lang-name">{name}</span>
          <span className="set-row-desc">{other}</span>
        </label>
      ))}
    </div>
  );
}

function DataSection() {
  const { t } = useTranslation();
  const s = useSettings();
  return (
    <>
      <Row title={t('settings.decimalSeparator')} desc={t('settings.decimalSeparatorDesc')}>
        <Segmented
          label={t('settings.decimalSeparator')}
          value={s.decimalSeparator}
          onChange={(v) => s.set({ decimalSeparator: v })}
          options={[
            { value: '.', label: t('settings.dot') },
            { value: ',', label: t('settings.comma') },
          ]}
        />
      </Row>
      <Row title={t('settings.defaultDecimals')} desc={t('settings.defaultDecimalsDesc')} htmlFor="ddec">
        <input id="ddec" className="input narrow" type="number" min={0} max={16} value={s.defaultDecimals} onChange={(e) => s.set({ defaultDecimals: Math.max(0, Math.min(16, Number(e.target.value) || 0)) })} />
      </Row>
      <Row title={t('settings.dateFormat')} desc={t('settings.dateFormatDesc')} htmlFor="dfmt">
        <select id="dfmt" className="select" value={s.dateFormat} onChange={(e) => s.set({ dateFormat: e.target.value as Settings['dateFormat'] })}>
          <option value="EDATE">dd.mm.yyyy (EDATE)</option>
          <option value="DATE">dd-mmm-yyyy (DATE)</option>
          <option value="ADATE">mm/dd/yyyy (ADATE)</option>
          <option value="SDATE">yyyy/mm/dd (SDATE)</option>
        </select>
      </Row>
    </>
  );
}

function EditorSection() {
  const { t } = useTranslation();
  const s = useSettings();
  return (
    <>
      <Row title={t('settings.editorFontSize')} desc={`${s.editorFontSize}px`} htmlFor="efs">
        <input id="efs" type="range" min={11} max={22} value={s.editorFontSize} onChange={(e) => s.set({ editorFontSize: Number(e.target.value) })} className="range" />
      </Row>
      <Toggle k="lineNumbers" label={t('settings.lineNumbers')} />
      <Toggle k="wordWrap" label={t('settings.wordWrap')} />
      <Toggle k="autoRunSelection" label={t('settings.autoRunSelection')} desc={t('settings.autoRunSelectionDesc')} />
    </>
  );
}

function FilesSection() {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const [count, setCount] = useState(0);
  useEffect(() => void getRecent().then((r) => setCount(r.length)), []);
  return (
    <>
      <Toggle k="autosave" label={t('settings.autosave')} desc={t('settings.autosaveDesc')} />
      <Row title={t('settings.recentFiles')} desc={t('settings.recentFilesDesc', { count })}>
        <button
          type="button"
          className="btn btn-outlined btn-sm"
          disabled={!count}
          onClick={() => {
            void clearRecent().then(() => {
              setCount(0);
              toast(t('settings.recentCleared'));
            });
          }}
        >
          {t('settings.clearRecent')}
        </button>
      </Row>
      <Row title={t('settings.autosaveData')} desc={t('settings.autosaveDataDesc')}>
        <button type="button" className="btn btn-outlined btn-sm" onClick={() => void clearAutosave().then(() => toast(t('settings.autosaveCleared')))}>
          {t('settings.clearAutosave')}
        </button>
      </Row>
      <Row title={t('settings.resetAll')} desc={t('settings.resetAllDesc')}>
        <button type="button" className="btn btn-text btn-sm" onClick={() => useSettings.getState().reset()}>
          {t('settings.reset')}
        </button>
      </Row>
    </>
  );
}

export function SettingsDialog({ section }: { section?: string }) {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  const [active, setActive] = useState<string>(section ?? 'profile');
  return (
    <Dialog title={t('settings.title')} icon="settings" onClose={close} size="xwide" className="settings-dialog" bodyClassName="settings-body">
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.sections')}>
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={`settings-nav-item ${active === s.id ? 'on' : ''}`} aria-current={active === s.id ? 'page' : undefined} onClick={() => setActive(s.id)}>
              <Icon name={s.icon} filled={active === s.id} />
              <span>{t(`settings.section.${s.id}`)}</span>
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <h3 className="settings-h">{t(`settings.section.${active}`)}</h3>
          <p className="settings-sub">{t(`settings.sectionDesc.${active}`)}</p>
          <div className="settings-card">
            {active === 'profile' && <ProfileSection />}
            {active === 'appearance' && <AppearanceSection />}
            {active === 'language' && <LanguageSection />}
            {active === 'data' && <DataSection />}
            {active === 'editor' && <EditorSection />}
            {active === 'files' && <FilesSection />}
            {active === 'shortcuts' && <ShortcutsList />}
            {active === 'about' && <AboutContent />}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
