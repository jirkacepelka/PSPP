/*
 * Visual radio cards: each option shows a small picture of what it does (VisualChoice), and the
 * theme picker as miniature light / dark / split windows (ThemeCards). Arrow keys move the choice
 * (roving tabindex). Shared by the onboarding guide and Settings.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { useSettings } from '../../store/settings';
import './preview.css';

export interface VisualOption<T extends string> {
  value: T;
  label: string;
  desc?: string;
  art: ReactNode;
}

export function VisualChoice<T extends string>({
  value,
  onChange,
  options,
  label,
  onHover,
  className = '',
}: {
  value: T;
  onChange: (v: T) => void;
  options: VisualOption<T>[];
  label: string;
  /** called with an option while it is hovered or focused, null after (for live previews) */
  onHover?: (v: T | null) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = options.findIndex((o) => o.value === value);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in step)) return;
    e.preventDefault();
    const n = options[(Math.max(0, idx) + step[e.key] + options.length) % options.length];
    onChange(n.value);
    ref.current?.querySelector<HTMLElement>(`[data-value="${n.value}"]`)?.focus();
  };
  return (
    <div ref={ref} className={`vc-grid ${className}`} style={{ ['--n' as string]: options.length }} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} onPointerLeave={() => onHover?.(null)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-value={o.value}
            tabIndex={on || (idx < 0 && i === 0) ? 0 : -1}
            className="vc"
            onClick={() => onChange(o.value)}
            onPointerEnter={() => onHover?.(o.value)}
            onFocus={() => onHover?.(o.value)}
            onBlur={() => onHover?.(null)}
          >
            <span className="vc-art" aria-hidden="true">
              {o.art}
            </span>
            <span className="vc-name">{o.label}</span>
            {o.desc && <span className="vc-desc">{o.desc}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Win({ dark, cut }: { dark?: boolean; cut?: boolean }) {
  return (
    <span className={`thc-half ${dark ? 'dark' : ''} ${cut ? 'cut' : ''}`}>
      <span className="thc-bar">
        <b />
        <i />
      </span>
      <span className="thc-sheet" />
    </span>
  );
}

/** Light / dark / follow-the-system as miniature windows. */
export function ThemeCards() {
  const { t } = useTranslation();
  const theme = useSettings((s) => s.theme);
  const set = useSettings((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  const opts = [
    { value: 'light' as const, icon: 'light_mode', label: t('settings.themeLight') },
    { value: 'dark' as const, icon: 'dark_mode', label: t('settings.themeDark') },
    { value: 'system' as const, icon: 'brightness_auto', label: t('settings.themeSystem') },
  ];
  const idx = opts.findIndex((o) => o.value === theme);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in step)) return;
    e.preventDefault();
    const n = opts[(Math.max(0, idx) + step[e.key] + opts.length) % opts.length];
    set({ theme: n.value });
    ref.current?.querySelector<HTMLElement>(`[data-value="${n.value}"]`)?.focus();
  };
  return (
    <div ref={ref} className="thc-grid" role="radiogroup" aria-label={t('settings.theme')} onKeyDown={onKeyDown}>
      {opts.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={theme === o.value} tabIndex={theme === o.value ? 0 : -1} data-value={o.value} className="thc" onClick={() => set({ theme: o.value })}>
          <span className="thc-win" aria-hidden="true">
            {o.value === 'light' && <Win />}
            {o.value === 'dark' && <Win dark />}
            {o.value === 'system' && (
              <>
                <Win />
                <Win dark cut />
              </>
            )}
          </span>
          <span className="thc-label">
            <Icon name={o.icon} size={16} />
            {o.label}
          </span>
          <span className="thc-check" aria-hidden="true">
            <Icon name="check" size={13} />
          </span>
        </button>
      ))}
    </div>
  );
}

/** Small pictures for the visual choices. */
export function DensityArt({ dense }: { dense: boolean }) {
  return (
    <span className={`onb-art-rows ${dense ? 'is-dense' : ''}`}>
      {Array.from({ length: dense ? 5 : 3 }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}
export function ToolbarArt({ labels }: { labels: boolean }) {
  const icons = ['label', 'search', 'table_rows'];
  return (
    <span className="onb-art-tools">
      {icons.map((n) => (
        <span key={n} className={labels ? 'has-label' : ''}>
          <Icon name={n} size={13} />
          {labels && <i />}
        </span>
      ))}
    </span>
  );
}

export function ExplainArt({ mode }: { mode: 'always' | 'onDemand' | 'never' }) {
  return (
    <span className="onb-art-explain">
      <span className="onb-art-table">
        <i />
        <i />
        <i />
      </span>
      {mode === 'always' && (
        <span className="onb-art-note">
          <Icon name="lightbulb" size={11} />
          <i />
        </span>
      )}
      {mode === 'onDemand' && (
        <span className="onb-art-btn">
          <Icon name="lightbulb" size={11} />
        </span>
      )}
    </span>
  );
}

