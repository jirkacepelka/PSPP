/*
 * Settings (audit SET-1…SET-4): opens on "Obecné", has a new "Analýza a výstup" section, a
 * search field over every row, and Profile last. Built from Panel, Switch, Segmented, Select
 * and NumberField; the accent picker reports the contrast it achieves (lib/color checkAccent).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { NumberField, Select } from '../../components/Field';
import { Segmented } from '../../components/Segmented';
import { Switch } from '../../components/Choice';
import { ACCENT_PRESETS, checkAccent, normalizeAccent } from '../../lib/color';
import { AVATAR_COLORS, initialsOf, useSettings, type Settings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { Avatar } from '../shell/ProfileMenu';
import { clearAutosave, clearRecent, getRecent } from '../../app/files';
import { ShortcutsList } from '../misc/ShortcutsDialog';
import { AboutContent } from '../misc/AboutDialog';
import { norm } from '../palette/fuzzy';
import { PresetCards, openOnboarding } from '../onboarding/Onboarding';
import './settings.css';

const SECTIONS = [
  { id: 'general', icon: 'tune' },
  { id: 'appearance', icon: 'palette' },
  { id: 'analysis', icon: 'query_stats' },
  { id: 'data', icon: 'pin' },
  { id: 'editor', icon: 'code' },
  { id: 'files', icon: 'folder' },
  { id: 'shortcuts', icon: 'keyboard' },
  { id: 'profile', icon: 'account_circle' },
  { id: 'about', icon: 'info' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

/** Current search query; rows that do not match hide themselves. */
const QueryCtx = createContext('');

function useMatch(...texts: (string | undefined)[]): boolean {
  const q = useContext(QueryCtx);
  if (!q) return true;
  const hay = norm(texts.filter(Boolean).join(' '));
  return norm(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function Row({ title, desc, children, htmlFor, keywords }: { title: string; desc?: string; children: ReactNode; htmlFor?: string; keywords?: string }) {
  if (!useMatch(title, desc, keywords)) return null;
  return (
    <div className="set-row">
      <div className="set-row-text">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="set-row-title">
            {title}
          </label>
        ) : (
          <span className="set-row-title">{title}</span>
        )}
        {desc && <span className="set-row-desc">{desc}</span>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

function Toggle({ k, label, desc }: { k: keyof Settings; label: string; desc?: string }) {
  const v = useSettings((s) => s[k]) as boolean;
  const set = useSettings((s) => s.set);
  if (!useMatch(label, desc)) return null;
  return (
    <div className="set-row set-row-switch">
      <Switch label={label} description={desc} checked={v} onChange={(e) => set({ [k]: e.target.checked } as Partial<Settings>)} />
    </div>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="set-group">
      {title && <h4 className="set-group-title">{title}</h4>}
      <div className="set-card">{children}</div>
    </section>
  );
}

function GeneralSection() {
  const { t } = useTranslation();
  const s = useSettings();
  return (
    <>
      <Group>
        <Row title={t('settings.language')} desc={t('settings.sectionDesc.language')} keywords="jazyk language cestina english">
          <Segmented
            aria-label={t('settings.language')}
            value={s.language}
            onChange={(v) => s.set({ language: v })}
            options={[
              { value: 'cs', label: 'Čeština' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Row>
        <Row title={t('settings.theme')} keywords="motiv tema dark light">
          <ThemeSwitch />
        </Row>
        <Row title={t('settings.decimalSeparator')} desc={t('settings.decimalSeparatorDesc')}>
          <Segmented
            aria-label={t('settings.decimalSeparator')}
            value={s.decimalSeparator}
            onChange={(v) => s.set({ decimalSeparator: v })}
            options={[
              { value: ',', label: t('settings.comma') },
              { value: '.', label: t('settings.dot') },
            ]}
          />
        </Row>
      </Group>
      <WorkspaceGroup />
      <Group title={t('shell.settings.helpGroup')}>
        <Toggle k="showValueLabels" label={t('shell.settings.valueLabels')} desc={t('shell.settings.valueLabelsDesc')} />
        <ExplainRow />
        <Toggle k="showSyntaxPreview" label={t('shell.settings.syntaxPreview')} desc={t('shell.settings.syntaxPreviewDesc')} />
      </Group>
    </>
  );
}

/** Visual presets (shared with the onboarding guide) and a way to run the guide again. */
function WorkspaceGroup() {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  const showPresets = useMatch(t('onboarding.presets.label'), t('onboarding.settings.layoutDesc'), 'preset rozvrzeni layout klidny vyvazeny plny calm balanced full');
  const showRerun = useMatch(t('onboarding.settings.rerun'), t('onboarding.settings.rerunDesc'), 'onboarding pruvodce guide wizard');
  if (!showPresets && !showRerun) return null;
  return (
    <Group title={t('onboarding.settings.group')}>
      {showPresets && (
        <div className="onb-set-presets">
          <span className="set-row-title">{t('onboarding.presets.label')}</span>
          <span className="onb-row-desc">{t('onboarding.settings.layoutDesc')}</span>
          <PresetCards compact />
        </div>
      )}
      {showRerun && (
        <Row title={t('onboarding.settings.rerun')} desc={t('onboarding.settings.rerunDesc')}>
          <Button
            size="sm"
            iconStart="replay"
            onClick={() => {
              close();
              openOnboarding();
            }}
          >
            {t('onboarding.settings.rerunButton')}
          </Button>
        </Row>
      )}
    </Group>
  );
}

function ThemeSwitch() {
  const { t } = useTranslation();
  const theme = useSettings((s) => s.theme);
  const set = useSettings((s) => s.set);
  return (
    <Segmented
      aria-label={t('settings.theme')}
      value={theme}
      onChange={(v) => set({ theme: v })}
      options={[
        { value: 'light', label: t('settings.themeLight'), icon: 'light_mode' },
        { value: 'dark', label: t('settings.themeDark'), icon: 'dark_mode' },
        { value: 'system', label: t('settings.themeSystem'), icon: 'brightness_auto' },
      ]}
    />
  );
}

function ExplainRow() {
  const { t } = useTranslation();
  const v = useSettings((s) => s.explainResults);
  const set = useSettings((s) => s.set);
  return (
    <Row title={t('shell.settings.explain')} desc={t('shell.settings.explainDesc')} keywords="interpretace vysvetleni interpretation">
      <Segmented
        aria-label={t('shell.settings.explain')}
        value={v}
        onChange={(x) => set({ explainResults: x })}
        options={[
          { value: 'always', label: t('shell.settings.explainAlways') },
          { value: 'onDemand', label: t('shell.settings.explainOnDemand') },
          { value: 'never', label: t('shell.settings.explainNever') },
        ]}
      />
    </Row>
  );
}

function AccentPicker() {
  const { t, i18n } = useTranslation();
  const accent = useSettings((s) => s.accent);
  const set = useSettings((s) => s.set);
  const current = normalizeAccent(accent);
  const preset = ACCENT_PRESETS.find((p) => p.light === current || p.dark === current);
  const light = checkAccent(current, false);
  const dark = checkAccent(current, true);
  const lang = i18n.language === 'cs' ? 'cs' : 'en';
  const fmt = (n: number) => n.toLocaleString(i18n.language, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return (
    <div className="set-accent">
      <div className="set-swatches" role="radiogroup" aria-label={t('settings.accent')}>
        {ACCENT_PRESETS.map((p) => {
          const on = preset?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              className="set-swatch"
              style={{ ['--sw' as string]: p.light, ['--sw-dark' as string]: p.dark }}
              aria-label={p.name[lang]}
              data-tip={p.name[lang]}
              onClick={() => set({ accent: p.light })}
            >
              {on && <Icon name="check" size={16} />}
            </button>
          );
        })}
        <label className={`set-swatch custom ${preset ? '' : 'on'}`} data-tip={t('settings.customColor')}>
          <input type="color" value={current} onChange={(e) => set({ accent: e.target.value })} aria-label={t('settings.customColor')} />
          <Icon name="colorize" size={16} />
        </label>
      </div>
      <p className={`set-accent-check ${light.passesAA && dark.passesAA ? 'ok' : 'warn'}`} aria-live="polite">
        <Icon name={light.passesAA && dark.passesAA ? 'check_circle' : 'warning'} size={16} />
        {light.passesAA && dark.passesAA
          ? t('shell.settings.accentOk', { light: fmt(light.accentOnCanvas), dark: fmt(dark.accentOnCanvas) })
          : t('shell.settings.accentWarn', { light: fmt(light.accentOnCanvas), dark: fmt(dark.accentOnCanvas) })}
        {!preset && <span className="set-accent-note">{t('shell.settings.accentAdjusted')}</span>}
      </p>
    </div>
  );
}

function AppearanceSection() {
  const { t } = useTranslation();
  const s = useSettings();
  return (
    <>
      <Group>
        <Row title={t('settings.theme')}>
          <ThemeSwitch />
        </Row>
        <Row title={t('settings.accent')} desc={t('settings.accentDesc')} keywords="barva color akcent">
          <AccentPicker />
        </Row>
        <Toggle k="toolbarLabels" label={t('shell.settings.toolbarLabels')} desc={t('shell.settings.toolbarLabelsDesc')} />
        <Row title={t('settings.density')}>
          <Segmented
            aria-label={t('settings.density')}
            value={s.density}
            onChange={(v) => s.set({ density: v })}
            options={[
              { value: 'comfortable', label: t('settings.comfortable'), icon: 'density_medium' },
              { value: 'compact', label: t('settings.compact'), icon: 'density_small' },
            ]}
          />
        </Row>
        <Row title={t('settings.fontSize')} desc={`${s.fontSize} px`} htmlFor="set-fsize">
          <input id="set-fsize" type="range" min={12} max={18} step={1} value={s.fontSize} onChange={(e) => s.set({ fontSize: Number(e.target.value) })} className="set-range" />
        </Row>
        <Row title={t('settings.gridFont')} htmlFor="set-gfont">
          <Select
            id="set-gfont"
            size="sm"
            value={s.gridFont}
            onChange={(e) => s.set({ gridFont: e.target.value as Settings['gridFont'] })}
            options={[
              { value: 'system', label: t('settings.fontSystem') },
              { value: 'inter', label: 'Inter' },
              { value: 'roboto', label: 'Roboto' },
              { value: 'mono', label: 'Roboto Mono' },
            ]}
          />
        </Row>
      </Group>
      <TableStyles />
      <Group title={t('shell.settings.chrome')}>
        <Toggle k="showToolbar" label={t('shell.settings.commandBar')} desc={t('shell.settings.commandBarDesc')} />
        <Toggle k="showFormulaBar" label={t('actions.showFormulaBar')} />
        <Toggle k="showStatusBar" label={t('shell.settings.statusFacts')} />
      </Group>
    </>
  );
}

function TableStyles() {
  const { t } = useTranslation();
  const tableStyle = useSettings((s) => s.tableStyle);
  const set = useSettings((s) => s.set);
  if (!useMatch(t('settings.tableStyle'), 'apa tabulky tables styl')) return null;
  return (
    <Group title={t('settings.tableStyle')}>
      <div className="set-styles" role="radiogroup" aria-label={t('settings.tableStyle')}>
        {(['modern', 'classic', 'apa', 'compact'] as const).map((st) => (
          <button key={st} type="button" role="radio" aria-checked={tableStyle === st} className="set-style" onClick={() => set({ tableStyle: st })}>
            <div className={`output-doc ts-${st} set-style-preview`} aria-hidden="true">
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
                    <td className="num">21,4</td>
                  </tr>
                  <tr>
                    <th>gpa</th>
                    <td className="num">118</td>
                    <td className="num">2,87</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <span className="set-style-name">{t(`settings.style.${st}`)}</span>
          </button>
        ))}
      </div>
    </Group>
  );
}

function AnalysisSection() {
  const { t } = useTranslation();
  const s = useSettings();
  return (
    <>
      <Group title={t('shell.settings.resultsGroup')}>
        <ExplainRow />
        <Row title={t('shell.settings.pFormat')} desc={t('shell.settings.pFormatDesc')} keywords="p hodnota signifikance significance">
          <Segmented
            aria-label={t('shell.settings.pFormat')}
            value={s.pFormat}
            onChange={(v) => s.set({ pFormat: v })}
            options={[
              { value: 'exact', label: t('shell.settings.pExact') },
              { value: 'threshold', label: t('shell.settings.pThreshold') },
            ]}
          />
        </Row>
        <Row title={t('shell.settings.leadingZero')} desc={t('shell.settings.leadingZeroDesc')}>
          <Segmented
            aria-label={t('shell.settings.leadingZero')}
            value={s.leadingZero}
            onChange={(v) => s.set({ leadingZero: v })}
            options={[
              { value: 'always', label: '0,05' },
              { value: 'apa', label: t('shell.settings.leadingApa') },
              { value: 'never', label: ',05' },
            ]}
          />
        </Row>
        <Row title={t('shell.settings.ciLevel')} desc={t('shell.settings.ciLevelDesc')} htmlFor="set-ci">
          <NumberField id="set-ci" size="sm" className="set-narrow" value={s.ciLevel} min={50} max={99.9} step={1} decimalSeparator={s.decimalSeparator} onValueChange={(v) => v != null && s.set({ ciLevel: v })} />
        </Row>
        <Row title={t('shell.settings.apaLocale')} desc={t('shell.settings.apaLocaleDesc')} keywords="apa kopirovat copy word">
          <Segmented
            aria-label={t('shell.settings.apaLocale')}
            value={s.apaLocale}
            onChange={(v) => s.set({ apaLocale: v })}
            options={[
              { value: 'cs', label: t('shell.settings.apaCs') },
              { value: 'en', label: t('shell.settings.apaEn') },
            ]}
          />
        </Row>
      </Group>
      <Group title={t('shell.settings.dialogsGroup')}>
        <Row title={t('shell.settings.listShows')} desc={t('shell.settings.listShowsDesc')}>
          <Segmented
            aria-label={t('shell.settings.listShows')}
            value={s.listShows}
            onChange={(v) => s.set({ listShows: v })}
            options={[
              { value: 'name', label: t('shell.settings.listName') },
              { value: 'label', label: t('shell.settings.listLabel') },
              { value: 'both', label: t('shell.settings.listBoth') },
            ]}
          />
        </Row>
        <Toggle k="showSyntaxPreview" label={t('shell.settings.syntaxPreview')} desc={t('shell.settings.syntaxPreviewDesc')} />
        <Toggle k="rerunReplaces" label={t('shell.settings.rerunReplaces')} desc={t('shell.settings.rerunReplacesDesc')} />
      </Group>
    </>
  );
}

function DataSection() {
  const { t } = useTranslation();
  const s = useSettings();
  return (
    <>
      <Group>
        <Row title={t('settings.decimalSeparator')} desc={t('settings.decimalSeparatorDesc')}>
          <Segmented
            aria-label={t('settings.decimalSeparator')}
            value={s.decimalSeparator}
            onChange={(v) => s.set({ decimalSeparator: v })}
            options={[
              { value: ',', label: t('settings.comma') },
              { value: '.', label: t('settings.dot') },
            ]}
          />
        </Row>
        <Row title={t('settings.defaultDecimals')} desc={t('settings.defaultDecimalsDesc')} htmlFor="set-ddec">
          <NumberField id="set-ddec" size="sm" className="set-narrow" value={s.defaultDecimals} min={0} max={16} step={1} onValueChange={(v) => v != null && s.set({ defaultDecimals: Math.round(v) })} steppers />
        </Row>
        <Row title={t('settings.dateFormat')} desc={t('settings.dateFormatDesc')} htmlFor="set-dfmt">
          <Select
            id="set-dfmt"
            size="sm"
            value={s.dateFormat}
            onChange={(e) => s.set({ dateFormat: e.target.value as Settings['dateFormat'] })}
            options={[
              { value: 'EDATE', label: 'dd.mm.rrrr (EDATE)' },
              { value: 'DATE', label: 'dd-mmm-rrrr (DATE)' },
              { value: 'ADATE', label: 'mm/dd/rrrr (ADATE)' },
              { value: 'SDATE', label: 'rrrr/mm/dd (SDATE)' },
            ]}
          />
        </Row>
      </Group>
      <Group>
        <Toggle k="showValueLabels" label={t('shell.settings.valueLabels')} desc={t('shell.settings.valueLabelsDesc')} />
        <Toggle k="variableViewAllColumns" label={t('shell.settings.allColumns')} desc={t('shell.settings.allColumnsDesc')} />
      </Group>
    </>
  );
}

function EditorSection() {
  const { t } = useTranslation();
  const s = useSettings();
  return (
    <Group>
      <Row title={t('settings.editorFontSize')} desc={`${s.editorFontSize} px`} htmlFor="set-efs">
        <input id="set-efs" type="range" min={11} max={22} value={s.editorFontSize} onChange={(e) => s.set({ editorFontSize: Number(e.target.value) })} className="set-range" />
      </Row>
      <Toggle k="lineNumbers" label={t('settings.lineNumbers')} />
      <Toggle k="wordWrap" label={t('settings.wordWrap')} />
      <Toggle k="autoRunSelection" label={t('settings.autoRunSelection')} desc={t('settings.autoRunSelectionDesc')} />
    </Group>
  );
}

function FilesSection() {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const [count, setCount] = useState(0);
  useEffect(() => void getRecent().then((r) => setCount(r.length)), []);
  return (
    <Group>
      <Toggle k="autosave" label={t('settings.autosave')} desc={t('settings.autosaveDesc')} />
      <Row title={t('settings.recentFiles')} desc={t('settings.recentFilesDesc', { count })}>
        <Button
          size="sm"
          disabled={!count}
          onClick={() => {
            void clearRecent().then(() => {
              setCount(0);
              toast(t('settings.recentCleared'));
            });
          }}
        >
          {t('settings.clearRecent')}
        </Button>
      </Row>
      <Row title={t('settings.autosaveData')} desc={t('settings.autosaveDataDesc')}>
        <Button size="sm" onClick={() => void clearAutosave().then(() => toast(t('settings.autosaveCleared')))}>
          {t('settings.clearAutosave')}
        </Button>
      </Row>
      <Row title={t('settings.resetAll')} desc={t('settings.resetAllDesc')}>
        <Button size="sm" variant="ghost" onClick={() => useSettings.getState().reset()}>
          {t('settings.reset')}
        </Button>
      </Row>
    </Group>
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
      <div className="set-profile-card">
        <Avatar profile={profile} large />
        <div>
          <div className="set-profile-name">{profile.name || t('profile.defaultName')}</div>
          <div className="set-row-desc">
            <Icon name="lock" size={14} /> {t('profile.localOnlyLong')}
          </div>
        </div>
      </div>
      <Group>
        <Row title={t('profile.name')} htmlFor="set-pname">
          <input
            id="set-pname"
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
        <Row title={t('profile.initials')} desc={t('profile.initialsDesc')} htmlFor="set-pinit">
          <input id="set-pinit" className="input set-narrow" maxLength={3} value={profile.initials} onChange={(e) => setProfile({ initials: e.target.value.toUpperCase() })} />
        </Row>
        <Row title={t('profile.color')}>
          <div className="set-swatches" role="radiogroup" aria-label={t('profile.color')}>
            {AVATAR_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={profile.color === c} className="set-swatch" style={{ ['--sw' as string]: c, ['--sw-dark' as string]: c }} aria-label={c} onClick={() => setProfile({ color: c })}>
                {profile.color === c && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
        </Row>
        <Row title={t('profile.photo')} desc={t('profile.photoDesc')}>
          <div className="set-inline">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <Button size="sm" iconStart="upload" onClick={() => fileRef.current?.click()}>
              {t('profile.upload')}
            </Button>
            {profile.avatar && (
              <Button size="sm" variant="ghost" onClick={() => setProfile({ avatar: undefined })}>
                {t('profile.removePhoto')}
              </Button>
            )}
          </div>
        </Row>
      </Group>
    </>
  );
}

const SEARCHABLE: SectionId[] = ['general', 'appearance', 'analysis', 'data', 'editor', 'files'];

function SectionBody({ id }: { id: SectionId }) {
  switch (id) {
    case 'general':
      return <GeneralSection />;
    case 'appearance':
      return <AppearanceSection />;
    case 'analysis':
      return <AnalysisSection />;
    case 'data':
      return <DataSection />;
    case 'editor':
      return <EditorSection />;
    case 'files':
      return <FilesSection />;
    case 'shortcuts':
      return <ShortcutsList />;
    case 'profile':
      return <ProfileSection />;
    case 'about':
      return <AboutContent />;
  }
}

const label = (t: (k: string) => string, id: SectionId, part: 'section' | 'sectionDesc') => t(`settings.${part}.${id}`);

export function SettingsDialog({ section }: { section?: string }) {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  const initial = useMemo<SectionId>(() => {
    if (section === 'language') return 'general';
    return (SECTIONS.find((s) => s.id === section)?.id ?? 'general') as SectionId;
  }, [section]);
  const [active, setActive] = useState<SectionId>(initial);
  const [q, setQ] = useState('');
  const searching = q.trim().length > 0;
  return (
    <Dialog title={t('settings.title')} icon="settings" onClose={close} size="xwide" className="set-dialog" bodyClassName="set-body" initialFocus=".set-search input">
      <div className="set-layout">
        <nav className="set-nav" aria-label={t('settings.sections')}>
          <label className="set-search">
            <Icon name="search" size={16} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('shell.settings.search')} aria-label={t('shell.settings.search')} />
          </label>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="set-nav-item"
              aria-current={!searching && active === s.id ? 'page' : undefined}
              onClick={() => {
                setQ('');
                setActive(s.id);
              }}
            >
              <Icon name={s.icon} size={18} />
              <span>{label(t, s.id, 'section')}</span>
            </button>
          ))}
        </nav>
        <div className="set-content">
          <QueryCtx.Provider value={q.trim()}>
            {searching ? (
              <>
                {SEARCHABLE.map((id) => (
                  <div key={id} className="set-search-section">
                    <h3 className="set-h set-h-small">{label(t, id, 'section')}</h3>
                    <SectionBody id={id} />
                  </div>
                ))}
                <p className="set-search-empty">{t('shell.settings.noMatch', { q: q.trim() })}</p>
              </>
            ) : (
              <>
                <h3 className="set-h">{label(t, active, 'section')}</h3>
                <p className="set-sub">{label(t, active, 'sectionDesc')}</p>
                <SectionBody id={active} />
              </>
            )}
          </QueryCtx.Provider>
        </div>
      </div>
    </Dialog>
  );
}
