/*
 * Toolbar with frequent actions and dataset status chips.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { ACTIONS_BY_ID, formatShortcut, runAction } from '../../app/actions';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';

function Btn({ id, icon }: { id: string; icon?: string }) {
  const { t } = useTranslation();
  const a = ACTIONS_BY_ID[id];
  useData((s) => s.revision);
  if (!a) return null;
  const sc = formatShortcut(a.shortcut);
  return (
    <IconButton
      icon={icon ?? a.icon ?? 'help'}
      small
      label={sc ? `${t(a.label)} (${sc})` : t(a.label)}
      disabled={a.enabled ? !a.enabled() : false}
      pressed={a.checked ? a.checked() : undefined}
      onClick={() => runAction(id)}
    />
  );
}

const Sep = () => <span className="tb-sep" aria-hidden="true" />;

export function Toolbar() {
  const { t } = useTranslation();
  const view = useUi((s) => s.view);
  const showStart = useUi((s) => s.showStart);
  const zoom = useUi((s) => s.zoom);
  const setZoom = useUi((s) => s.setZoom);
  const openModal = useUi((s) => s.openModal);
  const valueLabels = useUi((s) => s.valueLabels);
  const ds = useData((s) => s.dataset);
  const engineStatus = useUi((s) => s.engineStatus);
  const dataView = !showStart && (view === 'data' || view === 'variables');
  return (
    <div className="toolbar" role="toolbar" aria-label={t('toolbar.label')}>
      <div className="toolbar-scroll">
        <Btn id="file.open" />
        <Btn id="file.save" />
        <Btn id="file.print" />
        <Sep />
        <Btn id="edit.undo" />
        <Btn id="edit.redo" />
        <Sep />
        <label className="zoom-select" data-tip={t('toolbar.zoom')}>
          <span className="sr-only">{t('toolbar.zoom')}</span>
          <select className="select" value={String(zoom)} onChange={(e) => setZoom(Number(e.target.value))} aria-label={t('toolbar.zoom')}>
            {[0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].map((z) => (
              <option key={z} value={String(z)}>
                {Math.round(z * 100)} %
              </option>
            ))}
            {![0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].includes(zoom) && <option value={String(zoom)}>{Math.round(zoom * 100)} %</option>}
          </select>
        </label>
        <Sep />
        <IconButton icon="label" small pressed={valueLabels} label={`${t('actions.valueLabels')} (${formatShortcut('Mod+L')})`} onClick={() => runAction('view.valueLabels')} />
        <Btn id="edit.goto" />
        <Btn id="edit.find" />
        <Sep />
        <Btn id="edit.insertCase" />
        <Btn id="edit.insertVariable" />
        <Sep />
        <Btn id="dialog:frequencies" />
        <Btn id="dialog:descriptives" icon="functions" />
        <Btn id="dialog:crosstabs" />
        {ds && (
          <div className="tb-chips">
            <button type="button" className={`chip ${ds.split?.length ? 'on' : ''}`} onClick={() => openModal({ kind: 'analysis', specId: 'splitFile' })}>
              <Icon name="call_split" />
              {ds.split?.length ? t('status.splitBy', { vars: ds.split.join(', ') }) : t('status.noSplit')}
            </button>
            <button type="button" className={`chip ${ds.weight ? 'on' : ''}`} onClick={() => openModal({ kind: 'analysis', specId: 'weightCases' })}>
              <Icon name="scale" />
              {ds.weight ? t('status.weightBy', { var: ds.weight }) : t('status.noWeight')}
            </button>
            <button type="button" className={`chip ${ds.filter ? 'on' : ''}`} onClick={() => openModal({ kind: 'analysis', specId: 'selectCases' })}>
              <Icon name="filter_alt" />
              {ds.filter ? t('status.filterBy', { var: ds.filter }) : t('status.noFilter')}
            </button>
          </div>
        )}
      </div>
      {view === 'syntax' && !showStart && (
        <button type="button" className="btn btn-filled btn-sm run-btn" onClick={() => runAction('syntax.runAll')} disabled={engineStatus === 'running'}>
          <Icon name="play_arrow" filled />
          {t('toolbar.run')}
        </button>
      )}
      {dataView && <span className="sr-only">{t(`views.${view}`)}</span>}
    </div>
  );
}
