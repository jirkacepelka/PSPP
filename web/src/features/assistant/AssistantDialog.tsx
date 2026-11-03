/*
 * Analysis assistant (F5): goal → variables → recommendation. A router into the regular dialogs:
 * it explains the choice, then runs the analysis, opens its dialog pre-filled, or pastes syntax.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { MeasureIcon } from '../../components/Chip';
import type { Variable } from '../../engine/types';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { openDialog } from '../../app/actions';
import { pasteSyntax, runSyntaxDetailed } from '../../app/engine';
import { SPECS_BY_ID } from '../dialogs/specs';
import { defaultValues, type DialogContext } from '../dialogs/types';
import { completeGroupValues, displayMeasure } from '../dialogs/dialogData';
import { GOALS, SLOTS, recommend, type Goal, type Slot, type Step, type VarInfo } from './rules';
import './assistant.css';

function varInfo(v: Variable, col: (number | string | null)[] | undefined): VarInfo {
  const counts = new Map<string, number>();
  let n = 0;
  for (const x of col ?? []) {
    if (x === null || x === '' || v.missing.values.some((m) => String(m) === String(x))) continue;
    n++;
    const k = String(x);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (counts.size > 200) break;
  }
  const major = [...counts.values()].filter((c) => c >= 0.05 * n).length;
  return { name: v.name, label: v.label, measure: v.measure, type: v.type, distinct: counts.size, major };
}

export function AssistantDialog() {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  const toast = useUi((s) => s.toast);
  const dataset = useData((s) => s.dataset);
  const listShows = useSettings((s) => s.listShows);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [testValue, setTestValue] = useState<number>(0);

  const variables = useMemo(() => dataset?.variables ?? [], [dataset]);
  const infos = useMemo(() => new Map(variables.map((v, i) => [v.name, varInfo(v, dataset?.columns[i])])), [variables, dataset]);
  const ctx: DialogContext = useMemo(() => ({ variables, column: (n: string) => dataset?.columns[variables.findIndex((v) => v.name === n)] }), [variables, dataset]);

  const slots = goal ? SLOTS[goal] : [];
  const slotVars = Object.fromEntries(slots.map((s) => [s.id, (picked[s.id] ?? []).map((n) => infos.get(n)).filter((x): x is VarInfo => !!x)]));
  const rec = goal ? recommend(goal, slotVars, { testValue }) : null;

  const valuesFor = (step: Step) => {
    const spec = SPECS_BY_ID[step.specId];
    return completeGroupValues(spec, { ...defaultValues(spec), ...step.preset }, ctx);
  };
  const syntaxFor = (step: Step) => SPECS_BY_ID[step.specId].toSyntax(valuesFor(step), ctx);

  const run = async () => {
    if (!rec) return;
    close();
    for (const step of [rec.primary, rec.also].filter((s): s is Step => !!s)) {
      try {
        await runSyntaxDetailed(syntaxFor(step), { source: { specId: step.specId, values: valuesFor(step) }, origin: 'dialog' });
      } catch {
        toast(t('run.failed', { message: step.specId }), { kind: 'error' });
      }
    }
  };

  const toggle = (slot: Slot, name: string) => {
    const cur = picked[slot.id] ?? [];
    let next: string[];
    if (cur.includes(name)) next = cur.filter((n) => n !== name);
    else next = slot.max === 1 ? [name] : [...cur, name];
    // a variable lives in one slot only
    const others = Object.fromEntries(Object.entries(picked).map(([k, v]) => [k, k === slot.id ? v : v.filter((n) => n !== name)]));
    setPicked({ ...others, [slot.id]: next });
  };

  const showName = (v: Variable) => (listShows === 'label' && v.label ? v.label : v.name);

  const goals = (
    <div className="as-goals" role="list">
      {GOALS.map((g) => (
        <button key={g.id} type="button" role="listitem" className="as-goal" onClick={() => setGoal(g.id)} data-autofocus={g.id === 'describe' ? true : undefined}>
          <Icon name={g.icon} />
          <span className="as-goal-text">
            <strong>{t(`assistant.goal.${g.id}.title`)}</strong>
            <small>{t(`assistant.goal.${g.id}.desc`)}</small>
          </span>
          <Icon name="chevron_right" className="as-goal-go" />
        </button>
      ))}
    </div>
  );

  const picker = (slot: Slot) => {
    const sel = picked[slot.id] ?? [];
    const used = new Set(Object.values(picked).flat());
    const cand = variables
      .filter((v) => !(slot.numericOnly && v.type === 'string'))
      .map((v, i) => ({ v, i, ok: slot.prefer.includes(v.type === 'string' ? 'nominal' : v.measure === 'unknown' ? 'scale' : v.measure) }))
      .sort((a, b) => (a.ok === b.ok ? a.i - b.i : a.ok ? -1 : 1));
    const isGroup = slot.id === 'group' || (goal === 'predict' && slot.id === 'outcome');
    return (
      <section className="as-slot" key={slot.id} aria-labelledby={`as-slot-${slot.id}`}>
        <h3 id={`as-slot-${slot.id}`}>
          {t(slot.label)}
          <span className="as-prefer">
            {slot.prefer.map((m) => (
              <MeasureIcon key={m} measure={m === 'unknown' ? 'scale' : m} size={14} />
            ))}
          </span>
        </h3>
        <ul className="as-vars" role="listbox" aria-multiselectable={slot.max !== 1} aria-labelledby={`as-slot-${slot.id}`}>
          {cand.map(({ v, ok }) => {
            const on = sel.includes(v.name);
            const info = infos.get(v.name);
            return (
              <li
                key={v.name}
                role="option"
                aria-selected={on}
                tabIndex={0}
                className={`${on ? 'on' : ''} ${ok ? '' : 'unsuited'} ${!on && used.has(v.name) ? 'elsewhere' : ''}`}
                title={v.label ? `${v.name}: ${v.label}` : v.name}
                onClick={() => toggle(slot, v.name)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    toggle(slot, v.name);
                  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const el = (e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as HTMLElement | null;
                    el?.focus();
                  }
                }}
              >
                <Icon name={on ? 'check_box' : 'check_box_outline_blank'} className="as-check" />
                <MeasureIcon measure={displayMeasure(v)} size={16} />
                <span className="as-name">{showName(v)}</span>
                {listShows === 'both' && v.label && <span className="as-label">{v.label}</span>}
                {isGroup && info && <span className="as-count">{t('assistant.groups', { count: info.distinct })}</span>}
              </li>
            );
          })}
        </ul>
      </section>
    );
  };

  const stepCard = (step: Step, kind: 'primary' | 'also' | 'alternative') => (
    <div className={`as-test ${kind}`}>
      <Icon name={SPECS_BY_ID[step.specId]?.icon ?? 'analytics'} />
      <div>
        <div className="as-test-name">{t(step.name)}</div>
        <code className="as-test-syntax">{syntaxFor(step).split('\n')[0]}</code>
      </div>
    </div>
  );

  const recommendation = rec ? (
    <div className="as-rec" aria-live="polite">
      <div className="as-rec-label">{t('assistant.recommended')}</div>
      {stepCard(rec.primary, 'primary')}
      {rec.also && (
        <>
          <div className="as-rec-label small">{t('assistant.alsoRun')}</div>
          {stepCard(rec.also, 'also')}
        </>
      )}
      <h4>{t('assistant.whyTitle')}</h4>
      <p>{t(rec.reason.key, rec.reason.args)}</p>
      {rec.warning && (
        <p className="as-warn">
          <Icon name="warning" />
          {t(rec.warning)}
        </p>
      )}
      {rec.assumptions.length > 0 && (
        <>
          <h4>{t('assistant.assumptions')}</h4>
          <ul className="as-assume">
            {rec.assumptions.map((a) => (
              <li key={a}>{t(a)}</li>
            ))}
          </ul>
        </>
      )}
      {rec.alternativeWhen && (
        <>
          <h4>{t('assistant.alternative')}</h4>
          <p>
            {t(rec.alternativeWhen)}{' '}
            {rec.alternative && (
              <button
                type="button"
                className="as-link"
                onClick={() => {
                  close();
                  openDialog(rec.alternative!.specId, valuesFor(rec.alternative!));
                }}
              >
                {t(rec.alternative.name)} →
              </button>
            )}
          </p>
        </>
      )}
      <p className="as-path">
        <Icon name="lightbulb" />
        {t('assistant.nextTime', { path: t(rec.menuPath) })}
      </p>
    </div>
  ) : (
    <div className="as-rec empty">
      <Icon name="arrow_back" />
      <p>{t('assistant.fillSlots')}</p>
    </div>
  );

  return (
    <Dialog
      title={t('assistant.title')}
      description={goal ? t(`assistant.goal.${goal}.title`) : t('assistant.subtitle')}
      icon="explore"
      size={goal ? 'xwide' : 'normal'}
      onClose={close}
      closeOnScrim={false}
      className="assistant-dialog"
      footer={
        goal ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setGoal(null)}>
              <Icon name="arrow_back" />
              {t('assistant.change')}
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" disabled={!rec} onClick={() => rec && (close(), pasteSyntax([rec.primary, rec.also].filter((s): s is Step => !!s).map(syntaxFor).join('\n')))}>
              <Icon name="content_paste_go" />
              <span className="hide-sm">{t('assistant.paste')}</span>
            </button>
            <button type="button" className="btn btn-secondary" disabled={!rec} onClick={() => rec && (close(), openDialog(rec.primary.specId, valuesFor(rec.primary)))}>
              <Icon name="open_in_new" />
              {t('assistant.openDialog')}
            </button>
            <button type="button" className="btn btn-primary" disabled={!rec} onClick={() => void run()}>
              <Icon name="play_arrow" />
              {t('assistant.run')}
            </button>
          </>
        ) : (
          <>
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={close}>
              {t('common.cancel')}
            </button>
          </>
        )
      }
    >
      {!dataset ? (
        <p className="as-nodata">{t('assistant.noData')}</p>
      ) : !goal ? (
        goals
      ) : (
        <div className="as-layout">
          <div className="as-slots">
            {slots.map(picker)}
            {goal === 'testValue' && (
              <div className="field num-field">
                <label className="field-label" htmlFor="as-testvalue">
                  {t('assistant.testValue')}
                </label>
                <input id="as-testvalue" className="input" type="number" step="any" value={testValue} onChange={(e) => setTestValue(Number(e.target.value) || 0)} />
              </div>
            )}
          </div>
          {recommendation}
        </div>
      )}
    </Dialog>
  );
}
