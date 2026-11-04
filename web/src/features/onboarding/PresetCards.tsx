/*
 * Visual preset picker: large selectable cards with a schematic preview of the workspace.
 * Used by the onboarding "Look" step and by Settings → General.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { UI_PRESETS, applyPreset, useActivePreset, type PresetPatch, type UiPreset } from '../../app/presets';
import './onboarding.css';

/** Miniature workspace drawn from a preset's values (bars, density, side panel, columns). */
export function PresetPreview({ patch }: { patch: PresetPatch }) {
  const rows = patch.density === 'compact' ? 7 : patch.fontSize >= 15 ? 4 : 5;
  const cols = patch.variableViewAllColumns ? 5 : 3;
  return (
    <div className={`onb-pv ${patch.density === 'compact' ? 'is-dense' : ''}`} aria-hidden="true">
      <div className="onb-pv-bar onb-pv-app">
        <i className="onb-pv-dot" />
        <i className="onb-pv-line" />
      </div>
      {patch.showToolbar && (
        <div className="onb-pv-bar onb-pv-tool">
          <i />
          <i />
          <i />
          {patch.density === 'compact' && (
            <>
              <i />
              <i />
            </>
          )}
        </div>
      )}
      {patch.showFormulaBar && <div className="onb-pv-bar onb-pv-formula" />}
      <div className="onb-pv-main">
        <div className="onb-pv-grid" style={{ ['--cols' as string]: cols }}>
          {Array.from({ length: rows * cols }, (_, i) => (
            <i key={i} />
          ))}
        </div>
        {patch.inspectorOpen && (
          <div className="onb-pv-side">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
      {patch.showStatusBar && <div className="onb-pv-bar onb-pv-status" />}
    </div>
  );
}

export function PresetCards({ compact, onPick }: { compact?: boolean; onPick?: (p: UiPreset) => void }) {
  const { t } = useTranslation();
  const active = useActivePreset();
  const ref = useRef<HTMLDivElement>(null);
  const pick = (p: UiPreset) => {
    applyPreset(p.id);
    onPick?.(p);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in step)) return;
    e.preventDefault();
    const idx = Math.max(0, UI_PRESETS.findIndex((p) => p.id === active));
    const next = UI_PRESETS[(idx + step[e.key] + UI_PRESETS.length) % UI_PRESETS.length];
    pick(next);
    ref.current?.querySelector<HTMLElement>(`[data-preset="${next.id}"]`)?.focus();
  };
  return (
    <div className="onb-presets-wrap">
      <div ref={ref} className={`onb-presets ${compact ? 'is-compact' : ''}`} role="radiogroup" aria-label={t('onboarding.presets.label')} onKeyDown={onKeyDown}>
        {UI_PRESETS.map((p) => {
          const on = active === p.id;
          const tabbable = on || (active === 'custom' && p.id === 'balanced');
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on} tabIndex={tabbable ? 0 : -1} data-preset={p.id} className="onb-preset" onClick={() => pick(p)}>
              <PresetPreview patch={p.patch} />
              <span className="onb-preset-text">
                <span className="onb-preset-head">
                  <Icon name={p.icon} size={18} />
                  <span className="onb-preset-name">{t(`${p.key}.name`)}</span>
                  <span className="onb-preset-who">{t(`${p.key}.who`)}</span>
                </span>
                <span className="onb-preset-desc">{t(`${p.key}.desc`)}</span>
              </span>
              <span className="onb-preset-check" aria-hidden="true">
                <Icon name="check" size={16} />
              </span>
            </button>
          );
        })}
      </div>
      {active === 'custom' && (
        <p className="onb-presets-note">
          <Icon name="tune" size={16} />
          {t('onboarding.presets.custom')}
        </p>
      )}
    </div>
  );
}
