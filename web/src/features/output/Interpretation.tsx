/*
 * "Co to znamená" card under a procedure's tables (F6 / OUT-4) with effect sizes (OUT-9).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { interpret, type TableInput } from '../../lib/interpret';
import type { NumStyle } from '../../lib/statfmt';
import { describeFact, pickLang } from './interpretText';
import { copyText } from './outputHelpers';

/** Renders "**bold**" markers. */
function rich(s: string): ReactNode[] {
  return s.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}

export function Interpretation({ command, tables }: { command: string; tables: TableInput[] }) {
  const { t, i18n } = useTranslation();
  const mode = useSettings((s) => s.explainResults);
  const dec = useSettings((s) => s.decimalSeparator);
  const leadingZero = useSettings((s) => s.leadingZero);
  const pFormat = useSettings((s) => s.pFormat);
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(mode === 'always');
  const facts = useMemo(() => (mode === 'never' ? [] : interpret(command, tables)), [command, tables, mode]);
  if (mode === 'never' || !facts.length) return null;
  const style: NumStyle = { dec, leadingZero };
  const texts = facts.slice(0, 8).map((f) => describeFact(f, t, { style, pThreshold: pFormat === 'threshold' }));
  const caveat = texts.find((x) => x.caveat)?.caveat;
  const lang = i18n.language;

  if (!open)
    return (
      <button type="button" className="out-explain-toggle" onClick={() => setOpen(true)} aria-expanded={false}>
        <Icon name="lightbulb" />
        {t('interpret.show')}
      </button>
    );

  return (
    <aside className="out-explain" aria-label={t('interpret.title')}>
      <header>
        <Icon name="lightbulb" />
        <h4>{t('interpret.title')}</h4>
        <span className="spacer" />
        <IconButton icon="close" small label={t('interpret.hide')} onClick={() => setOpen(false)} />
      </header>
      <ul>
        {texts.map((x, i) => (
          <li key={i} className={x.significant === undefined ? '' : x.significant ? 'sig' : 'ns'}>
            <p className="out-explain-head">{rich(x.headline)}</p>
            {x.details.length > 0 && <p className="out-explain-detail">{x.details.map((d) => rich(d)).flatMap((d, k) => (k ? [' ', ...d] : d))}</p>}
            <div className="out-explain-meta">
              {x.effect && (
                <span className={`out-effect size-${x.effect.size}`} title={t('interpret.computed')}>
                  {pickLang(x.effect.label, lang)} = {x.effect.value} · {t(`interpret.size.${x.effect.size}`)}
                </span>
              )}
              <button
                type="button"
                className="out-report"
                title={t('interpret.copySentence')}
                onClick={() => void copyText(x.report).then((ok) => toast(ok ? t('interpret.copied') : t('output.copyFailed')))}
              >
                <code>{x.report}</code>
                <Icon name="content_copy" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {caveat && <p className="out-explain-caveat">{caveat}</p>}
      <p className="out-explain-note">{t('interpret.computed')}</p>
    </aside>
  );
}
