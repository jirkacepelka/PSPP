/*
 * First-run setup guide: welcome + language, profile, look (theme, accent, visual preset),
 * working style, done. A full-screen overlay over a soft accent wash; every choice applies
 * live so the workspace behind it changes as you go. Esc or "Skip" finishes it.
 *
 *   <OnboardingGate />   mount once (App.tsx); shows itself on first run
 *   openOnboarding()     opens it again (Settings → General)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { LogoMark } from '../shell/Logo';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { TextField } from '../../components/Field';
import { Segmented } from '../../components/Segmented';
import { Switch } from '../../components/Choice';
import { trapTab } from '../../components/focus';
import { ACCENT_PRESETS, findPreset } from '../../lib/color';
import { AVATAR_COLORS, initialsOf, useSettings } from '../../store/settings';
import { activePreset, getPreset } from '../../app/presets';
import { Avatar } from '../shell/ProfileMenu';
import { PresetCards } from './PresetCards';
import './onboarding.css';

export { PresetCards, PresetPreview } from './PresetCards';

const STEPS = ['welcome', 'profile', 'look', 'style', 'done'] as const;
type StepId = (typeof STEPS)[number];

/** Close animation length; matches --dur-long. */
const CLOSE_MS = 260;

const useOnboardingUi = create<{ manual: boolean; run: number }>(() => ({ manual: false, run: 0 }));

/** Opens the setup guide manually (e.g. from Settings). */
export function openOnboarding(): void {
  useOnboardingUi.setState((s) => ({ manual: true, run: s.run + 1 }));
}

/** Renders the guide on first run (settings loaded, not onboarded) or after openOnboarding(). */
export function OnboardingGate() {
  const loaded = useSettings((s) => s.loaded);
  const onboarded = useSettings((s) => s.onboarded);
  const manual = useOnboardingUi((s) => s.manual);
  const run = useOnboardingUi((s) => s.run);
  if (!manual && !(loaded && !onboarded)) return null;
  return (
    <Onboarding
      key={run}
      onDone={() => {
        useOnboardingUi.setState({ manual: false });
        useSettings.getState().set({ onboarded: true });
      }}
    />
  );
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const uid = useId();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [closing, setClosing] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const id = STEPS[step];
  const titleId = `${uid}-title`;
  const last = step === STEPS.length - 1;

  // Focus: into the card on open, back to where it was on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    nextRef.current?.focus({ preventScroll: true });
    return () => prev?.focus?.({ preventScroll: true });
  }, []);

  // After a step change: focus the step's preferred field, keep focus if it is still in the
  // card, otherwise move it to the step heading so screen readers announce the new step.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const auto = stepRef.current?.querySelector<HTMLElement>('[data-autofocus]');
    const active = document.activeElement;
    if (auto) auto.focus({ preventScroll: true });
    else if (!active || active === document.body || !cardRef.current?.contains(active)) stepRef.current?.querySelector<HTMLElement>('.onb-title')?.focus({ preventScroll: true });
  }, [step]);

  // Animate the card height between steps.
  useLayoutEffect(() => {
    const el = stepRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    setHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, [step]);

  const finish = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onDone, CLOSE_MS);
  };
  const go = (to: number) => {
    if (to < 0 || to >= STEPS.length) return;
    setDir(to > step ? 'fwd' : 'back');
    setStep(to);
  };
  const next = () => (last ? finish() : go(step + 1));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Keep app shortcuts (palette, menus, views) from firing behind the guide.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      finish();
    } else trapTab(e, cardRef.current);
  };

  return createPortal(
    <div className={`onb-root ${closing ? 'is-closing' : ''}`} onKeyDown={onKeyDown}>
      <div className="onb-backdrop" aria-hidden="true" />
      <div ref={cardRef} className="onb-card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="onb-head">
          <div className="onb-progress">
            <span className="onb-progress-text">
              {t('onboarding.stepOf', { n: step + 1, total: STEPS.length })}
              <span className="onb-progress-sep" aria-hidden="true">
                ·
              </span>
              <span className="onb-progress-name">{t(`onboarding.steps.${id}`)}</span>
            </span>
            <ol className="onb-dots" aria-hidden="true">
              {STEPS.map((s, i) => (
                <li key={s} className={i < step ? 'is-done' : i === step ? 'is-current' : ''} />
              ))}
            </ol>
          </div>
          {!last && (
            <Button variant="ghost" size="sm" className="onb-skip" onClick={finish} title={t('onboarding.skipHint')}>
              {t('onboarding.skip')}
            </Button>
          )}
        </header>

        <div className="onb-viewport" style={height ? { height } : undefined}>
          <div key={id} ref={stepRef} className={`onb-step is-${dir}`} data-step={id}>
            <StepBody id={id} titleId={titleId} onEnter={next} />
          </div>
        </div>

        <footer className="onb-foot">
          {step > 0 ? (
            <Button variant="ghost" iconStart="arrow_back" onClick={() => go(step - 1)}>
              {t('onboarding.back')}
            </Button>
          ) : null}
          <span className="spacer" />
          <Button ref={nextRef} variant="primary" size="lg" iconEnd={last ? 'check' : 'arrow_forward'} onClick={next} className="onb-next">
            {last ? t('onboarding.start') : t('onboarding.next')}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function StepBody({ id, titleId, onEnter }: { id: StepId; titleId: string; onEnter: () => void }) {
  switch (id) {
    case 'welcome':
      return <WelcomeStep titleId={titleId} />;
    case 'profile':
      return <ProfileStep titleId={titleId} onEnter={onEnter} />;
    case 'look':
      return <LookStep titleId={titleId} />;
    case 'style':
      return <StyleStep titleId={titleId} />;
    case 'done':
      return <DoneStep titleId={titleId} />;
  }
}

function StepHead({ titleId, title, lead, eyebrow }: { titleId: string; title: string; lead?: string; eyebrow?: string }) {
  return (
    <div className="onb-step-head">
      {eyebrow && <p className="onb-eyebrow">{eyebrow}</p>}
      <h2 id={titleId} className="onb-title" tabIndex={-1}>
        {title}
      </h2>
      {lead && <p className="onb-lead">{lead}</p>}
    </div>
  );
}

function OptionRow({ label, desc, children, stack }: { label: string; desc?: string; children: ReactNode; stack?: boolean }) {
  return (
    <div className={`onb-row ${stack ? 'is-stack' : ''}`}>
      <div className="onb-row-text">
        <span className="onb-row-label">{label}</span>
        {desc && <span className="onb-row-desc">{desc}</span>}
      </div>
      <div className="onb-row-control">{children}</div>
    </div>
  );
}

function LanguageSwitch() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const set = useSettings((s) => s.set);
  return (
    <Segmented
      aria-label={t('onboarding.welcome.language')}
      value={language}
      onChange={(v) => {
        const s = useSettings.getState();
        // Follow the language with the number conventions while the user has not chosen them.
        const patch: Parameters<typeof set>[0] = { language: v, apaLocale: v };
        if (s.decimalSeparator === (s.language === 'cs' ? ',' : '.')) patch.decimalSeparator = v === 'cs' ? ',' : '.';
        if (s.dateFormat === (s.language === 'cs' ? 'EDATE' : 'ADATE')) patch.dateFormat = v === 'cs' ? 'EDATE' : 'ADATE';
        set(patch);
      }}
      options={[
        { value: 'cs', label: 'Čeština' },
        { value: 'en', label: 'English' },
      ]}
    />
  );
}

function WelcomeStep({ titleId }: { titleId: string }) {
  const { t } = useTranslation();
  const points = [
    { icon: 'query_stats', title: t('onboarding.welcome.point1Title'), text: t('onboarding.welcome.point1') },
    { icon: 'lock', title: t('onboarding.welcome.point2Title'), text: t('onboarding.welcome.point2') },
    { icon: 'lightbulb', title: t('onboarding.welcome.point3Title'), text: t('onboarding.welcome.point3') },
  ];
  return (
    <>
      <div className="onb-hero-logo" aria-hidden="true">
        <LogoMark size={56} />
      </div>
      <StepHead titleId={titleId} eyebrow={t('onboarding.welcome.eyebrow')} title={t('onboarding.welcome.title')} lead={t('onboarding.welcome.lead')} />
      <ul className="onb-points">
        {points.map((p) => (
          <li key={p.icon} className="onb-point">
            <span className="onb-point-icon" aria-hidden="true">
              <Icon name={p.icon} size={20} />
            </span>
            <span className="onb-point-text">
              <strong>{p.title}</strong>
              <span>{p.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="onb-lang">
        <span className="onb-row-label">
          <Icon name="language" size={18} />
          {t('onboarding.welcome.language')}
        </span>
        <LanguageSwitch />
      </div>
    </>
  );
}

function ProfileStep({ titleId, onEnter }: { titleId: string; onEnter: () => void }) {
  const { t } = useTranslation();
  const profile = useSettings((s) => s.profile);
  const setProfile = useSettings((s) => s.setProfile);
  return (
    <>
      <StepHead titleId={titleId} title={t('onboarding.profile.title')} lead={t('onboarding.profile.lead')} />
      <div className="onb-profile">
        <div className="onb-profile-preview" aria-label={t('onboarding.profile.preview')} role="img">
          <div className="onb-avatar-wrap" key={profile.color}>
            <Avatar profile={profile} large />
          </div>
          <span className="onb-profile-name">{profile.name.trim() || t('onboarding.profile.anonymous')}</span>
          <span className="onb-profile-local">
            <Icon name="lock" size={14} />
            {t('onboarding.profile.local')}
          </span>
        </div>
        <div className="onb-profile-fields">
          <TextField
            label={t('onboarding.profile.name')}
            help={t('onboarding.profile.nameHelp')}
            placeholder={t('onboarding.profile.namePlaceholder')}
            value={profile.name}
            autoComplete="name"
            data-autofocus
            maxLength={60}
            onChange={(e) => {
              const name = e.target.value;
              const auto = !profile.initials || profile.initials === initialsOf(profile.name);
              setProfile({ name, ...(auto ? { initials: name.trim() ? initialsOf(name) : '' } : {}) });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onEnter();
              }
            }}
          />
          <div className="onb-field">
            <span className="field-label" id={`${titleId}-color`}>
              {t('onboarding.profile.color')}
            </span>
            <SwatchGroup
              labelledBy={`${titleId}-color`}
              kind="avatar"
              value={profile.color}
              onChange={(c) => setProfile({ color: c })}
              items={AVATAR_COLORS.map((c, i) => ({ id: c, light: c, dark: c, label: t('onboarding.profile.colorN', { n: i + 1 }) }))}
            />
          </div>
        </div>
      </div>
    </>
  );
}

interface Swatch {
  id: string;
  light: string;
  dark: string;
  label: string;
}

/** Colour radiogroup with roving focus and arrow keys. */
function SwatchGroup({ items, value, onChange, labelledBy, kind }: { items: Swatch[]; value: string | undefined; onChange: (v: string) => void; labelledBy: string; kind: 'accent' | 'avatar' }) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = items.findIndex((s) => s.id === value);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in step)) return;
    e.preventDefault();
    const n = items[(Math.max(0, idx) + step[e.key] + items.length) % items.length];
    onChange(n.id);
    ref.current?.querySelector<HTMLElement>(`[data-id="${n.id}"]`)?.focus();
  };
  return (
    <div ref={ref} className={`onb-swatches is-${kind}`} role="radiogroup" aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      {items.map((s, i) => {
        const on = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={s.label}
            data-tip={s.label}
            data-id={s.id}
            tabIndex={on || (idx < 0 && i === 0) ? 0 : -1}
            className="onb-swatch"
            style={{ ['--sw' as string]: s.light, ['--sw-dark' as string]: s.dark }}
            onClick={() => onChange(s.id)}
          >
            <Icon name="check" size={16} />
          </button>
        );
      })}
    </div>
  );
}

function LookStep({ titleId }: { titleId: string }) {
  const { t, i18n } = useTranslation();
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  const set = useSettings((s) => s.set);
  const lang = i18n.language === 'cs' ? 'cs' : 'en';
  const current = findPreset(accent);
  return (
    <>
      <StepHead titleId={titleId} title={t('onboarding.look.title')} lead={t('onboarding.look.lead')} />
      <div className="onb-look-top">
        <div className="onb-field">
          <span className="field-label">{t('onboarding.look.theme')}</span>
          <Segmented
            aria-label={t('onboarding.look.theme')}
            value={theme}
            onChange={(v) => set({ theme: v })}
            options={[
              { value: 'light', label: t('onboarding.look.light'), icon: 'light_mode' },
              { value: 'dark', label: t('onboarding.look.dark'), icon: 'dark_mode' },
              { value: 'system', label: t('onboarding.look.system'), icon: 'brightness_auto' },
            ]}
          />
        </div>
        <div className="onb-field">
          <span className="field-label" id={`${titleId}-accent`}>
            {t('onboarding.look.accent')}
          </span>
          <SwatchGroup
            labelledBy={`${titleId}-accent`}
            kind="accent"
            value={current?.id}
            onChange={(pid) => {
              const p = ACCENT_PRESETS.find((x) => x.id === pid);
              if (p) set({ accent: p.light });
            }}
            items={ACCENT_PRESETS.map((p) => ({ id: p.id, light: p.light, dark: p.dark, label: p.name[lang] }))}
          />
        </div>
      </div>
      <div className="onb-field">
        <span className="field-label">{t('onboarding.look.layout')}</span>
        <PresetCards />
      </div>
    </>
  );
}

function StyleStep({ titleId }: { titleId: string }) {
  const { t } = useTranslation();
  const s = useSettings();
  return (
    <>
      <StepHead titleId={titleId} title={t('onboarding.style.title')} lead={t('onboarding.style.lead')} />
      <div className="onb-rows">
        <OptionRow label={t('onboarding.style.decimal')} desc={t('onboarding.style.decimalDesc')}>
          <Segmented
            aria-label={t('onboarding.style.decimal')}
            value={s.decimalSeparator}
            onChange={(v) => s.set({ decimalSeparator: v })}
            options={[
              { value: ',', label: `${t('onboarding.style.comma')}  3,14` },
              { value: '.', label: `${t('onboarding.style.dot')}  3.14` },
            ]}
          />
        </OptionRow>
        <OptionRow label={t('onboarding.style.explain')} desc={t('onboarding.style.explainDesc')}>
          <Segmented
            aria-label={t('onboarding.style.explain')}
            value={s.explainResults}
            onChange={(v) => s.set({ explainResults: v })}
            options={[
              { value: 'always', label: t('onboarding.style.explainAlways') },
              { value: 'onDemand', label: t('onboarding.style.explainOnDemand') },
              { value: 'never', label: t('onboarding.style.explainNever') },
            ]}
          />
        </OptionRow>
        <div className="onb-row onb-row-switch">
          <Switch label={t('onboarding.style.syntax')} description={t('onboarding.style.syntaxDesc')} checked={s.showSyntaxPreview} onChange={(e) => s.set({ showSyntaxPreview: e.target.checked })} />
        </div>
      </div>
    </>
  );
}

function DoneStep({ titleId }: { titleId: string }) {
  const { t } = useTranslation();
  const s = useSettings();
  const first = s.profile.name.trim().split(/\s+/)[0] ?? '';
  const preset = activePreset(s);
  const themeLabel = t(`onboarding.look.${s.theme}`);
  const explainKey = { always: 'explainAlways', onDemand: 'explainOnDemand', never: 'explainNever' }[s.explainResults];
  const items = [
    { icon: 'contrast', label: t('onboarding.done.theme'), value: themeLabel },
    { icon: 'view_list', label: t('onboarding.done.layout'), value: preset === 'custom' ? t('onboarding.done.custom') : t(`${getPreset(preset).key}.name`) },
    { icon: 'pin', label: t('onboarding.done.decimal'), value: s.decimalSeparator === ',' ? '1 234,56' : '1,234.56' },
    { icon: 'lightbulb', label: t('onboarding.done.explain'), value: t(`onboarding.style.${explainKey}`) },
  ];
  return (
    <>
      <div className="onb-done-mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="56" height="56">
          <circle className="onb-done-ring" cx="24" cy="24" r="21" />
          <path className="onb-done-tick" d="M15 24.5l6 6 12-13" />
        </svg>
      </div>
      <StepHead titleId={titleId} title={t('onboarding.done.title', { name: first ? `, ${first}` : '' })} lead={t('onboarding.done.lead')} />
      <div className="onb-summary">
        <div className="onb-summary-profile">
          <Avatar profile={s.profile} />
          <span>{s.profile.name.trim() || t('onboarding.profile.anonymous')}</span>
        </div>
        <dl className="onb-summary-list">
          {items.map((it) => (
            <div key={it.label} className="onb-summary-item">
              <dt>
                <Icon name={it.icon} size={18} />
                {it.label}
              </dt>
              <dd>{it.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}
