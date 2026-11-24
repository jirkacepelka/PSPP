/*
 * Chart gallery: searchable icon tiles grouped by chart family, driven by GALLERY (model.ts).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon';
import { GALLERY, GROUP_ORDER } from './model';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function Gallery({ kind, variant, onPick }: { kind: string; variant: string; onPick: (kind: string, variant: string) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const q = fold(query.trim());
  const groups = useMemo(() => {
    const keep = (e: (typeof GALLERY)[number]) => !q || [t(e.label), t(e.family), t(`graphstudio.group.${e.group}`)].some((s) => fold(s).includes(q));
    return GROUP_ORDER.map((g) => ({
      id: g,
      entries: GALLERY.filter((e) => e.group === g && keep(e)),
    })).filter((g) => g.entries.length);
  }, [q, t]);
  return (
    <section className="gs-gallery" aria-label={t('graphstudio.gallery')}>
      <div className="gs-search input-wrap has-start">
        <span className="adorn start">
          <Icon name="search" />
        </span>
        <input className="input input-sm" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('graphstudio.searchCharts')} aria-label={t('graphstudio.searchCharts')} />
      </div>
      <div className="gs-gallery-groups">
        {groups.map((g) => (
          <div key={g.id} role="group" aria-labelledby={`gs-grp-${g.id}`} className="gs-group">
            <h4 className="gs-group-title" id={`gs-grp-${g.id}`}>
              {t(`graphstudio.group.${g.id}`)}
            </h4>
            <div className="gs-tiles">
              {g.entries.map((e) => (
                <button key={e.id} type="button" className="gs-tile" aria-pressed={e.kind === kind && e.variant === variant} onClick={() => onPick(e.kind, e.variant)}>
                  <Icon name={e.icon} />
                  <span>{t(e.label)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {!groups.length && <p className="gs-muted">{t('graphstudio.noChartFound')}</p>}
      </div>
    </section>
  );
}
