/*
 * Contextual command bar — one per view (audit SH-4/SH-5). Replaces the old global toolbar.
 *   Data / Proměnné: Data ⇄ Proměnné switch · undo/redo · value labels · find/go to · insert
 *   Výstup: edit / re-run / pin result · export · print · clear
 *   Syntaxe: run ▾ · save · journal · split
 * Right side everywhere (with data): Filtr / Vážení / Rozdělení chips · recall · "Analyzovat…".
 * Other feature areas can add or replace the left part via useCommandBarSlot (layout.ts).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Chip, FilterChip } from '../../components/Chip';
import { IconButton } from '../../components/IconButton';
import { MenuButton } from '../../components/MenuButton';
import { Segmented } from '../../components/Segmented';
import { Toolbar, ToolbarGroup, ToolbarSeparator, ToolbarSpacer } from '../../components/Toolbar';
import type { MenuEntry } from '../../components/Menu';
import { ACTIONS_BY_ID, formatShortcut, openDialog, runAction } from '../../app/actions';
import { runSyntax } from '../../app/engine';
import { SPECS_BY_ID } from '../dialogs/specs';
import { useData } from '../../store/data';
import { useDialogMemory } from '../../store/dialogs';
import { useOutput } from '../../store/output';
import { useSettings } from '../../store/settings';
import { useUi, type View } from '../../store/ui';
import { useLayout } from './layout';

/** Icon button bound to an action (label, shortcut, enabled and checked state). */
export function ActionButton({ id, icon, labelKey }: { id: string; icon?: string; labelKey?: string }) {
  const { t } = useTranslation();
  const a = ACTIONS_BY_ID[id];
  if (!a) return null;
  return (
    <IconButton
      icon={icon ?? a.icon ?? 'help'}
      small
      label={t(labelKey ?? a.label)}
      shortcut={formatShortcut(a.shortcut) || undefined}
      disabled={a.enabled ? !a.enabled() : false}
      pressed={a.checked ? a.checked() : undefined}
      onClick={() => runAction(id)}
    />
  );
}

function StatusChips() {
  const { t } = useTranslation();
  const ds = useData((s) => s.dataset);
  if (!ds) return null;
  const off = (cmd: string) => void runSyntax(cmd, { showOutput: false, quiet: true, origin: 'menu' });
  const chip = (key: string, on: boolean, icon: string, text: string, tip: string, spec: string, offCmd: string) => (
    <span className="sh-chip" title={tip} key={key}>
      <FilterChip
        selected={false}
        icon={icon}
        className={on ? 'sh-chip-on' : ''}
        onToggle={() => openDialog(spec)}
        onRemove={on ? () => off(offCmd) : undefined}
        removeLabel={t('shell.chips.remove', { what: text })}
      >
        {text}
      </FilterChip>
    </span>
  );
  return (
    <ToolbarGroup label={t('shell.chips.label')} className="sh-chips">
      {chip('filter', !!ds.filter, 'filter_alt', ds.filter ? t('status.filterBy', { var: ds.filter }) : t('status.noFilter'), t('shell.chips.filterTip'), 'selectCases', 'FILTER OFF.\nUSE ALL.')}
      {chip('weight', !!ds.weight, 'scale', ds.weight ? t('status.weightBy', { var: ds.weight }) : t('status.noWeight'), t('shell.chips.weightTip'), 'weightCases', 'WEIGHT OFF.')}
      {chip('split', !!ds.split?.length, 'call_split', ds.split?.length ? t('status.splitBy', { vars: ds.split.join(', ') }) : t('status.noSplit'), t('shell.chips.splitTip'), 'splitFile', 'SPLIT FILE OFF.')}
    </ToolbarGroup>
  );
}

function RecallButton() {
  const { t } = useTranslation();
  const recent = useDialogMemory((s) => s.recent);
  const items: MenuEntry[] = recent.slice(0, 10).flatMap((id) => {
    const spec = SPECS_BY_ID[id];
    return spec ? [{ type: 'item' as const, id, label: t(spec.title), icon: spec.icon, onSelect: () => openDialog(id) }] : [];
  });
  if (!items.length) return null;
  return <MenuButton iconOnly icon="history" size="sm" label={`${t('shell.recall')} (${formatShortcut('Mod+Shift+R')})`} menuLabel={t('shell.recall')} items={[{ type: 'header', label: t('shell.recallHeader') }, ...items]} />;
}

function DataSwitch({ view }: { view: View }) {
  const { t } = useTranslation();
  return (
    <Segmented
      size="sm"
      aria-label={t('shell.dataSwitch')}
      className="sh-dataswitch"
      value={view === 'variables' ? 'variables' : 'data'}
      onChange={(v) => useUi.getState().setView(v)}
      options={[
        { value: 'data', label: t('views.data'), icon: 'table' },
        { value: 'variables', label: t('views.variables'), icon: 'view_list' },
      ]}
    />
  );
}

function DataTools({ view }: { view: View }) {
  return (
    <>
      <DataSwitch view={view} />
      <ToolbarSeparator />
      <ToolbarGroup className="sh-keep-mobile">
        <ActionButton id="edit.undo" />
        <ActionButton id="edit.redo" />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        {view === 'data' && <ActionButton id="view.valueLabels" />}
        <ActionButton id="edit.find" />
        <ActionButton id="edit.goto" />
        <ActionButton id="edit.gotoVariable" />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        {view === 'data' && <ActionButton id="edit.insertCase" />}
        <ActionButton id="edit.insertVariable" />
        {view === 'data' && <ActionButton id="dialog:sortCases" icon="sort" />}
      </ToolbarGroup>
    </>
  );
}

function OutputTools() {
  const { t } = useTranslation();
  return (
    <>
      <ToolbarGroup className="sh-keep-mobile">
        <ActionButton id="output.edit" />
        <ActionButton id="output.rerun" />
        <ActionButton id="output.pin" />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <ActionButton id="file.exportOutput" icon="ios_share" />
        <ActionButton id="file.print" />
        <ActionButton id="util.clearOutput" />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ActionButton id="view.journal" labelKey="shell.actions.journal" />
      <ActionButton id="view.split" />
      <span className="sr-only">{t('views.output')}</span>
    </>
  );
}

function SyntaxTools() {
  const { t } = useTranslation();
  const running = useUi((s) => s.engineStatus === 'running');
  const runItems: MenuEntry[] = ['syntax.runCurrent', 'syntax.runSelection', 'syntax.runToEnd', 'syntax.runAll'].map((id) => ({
    type: 'item',
    id,
    label: t(ACTIONS_BY_ID[id].label),
    icon: ACTIONS_BY_ID[id].icon,
    shortcut: formatShortcut(ACTIONS_BY_ID[id].shortcut),
    onSelect: () => runAction(id),
  }));
  return (
    <>
      <ToolbarGroup attached className="sh-run sh-keep-mobile">
        <Button size="sm" variant="secondary" iconStart="play_arrow" disabled={running} onClick={() => runAction('syntax.runAll')} title={`${t('actions.runAll')} (${formatShortcut('Mod+Shift+Enter')})`}>
          {t('actions.runAll')}
        </Button>
        <MenuButton iconOnly size="sm" icon="expand_more" label={t('shell.runOptions')} items={runItems} disabled={running} />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <ActionButton id="syntax.save" />
        <ActionButton id="view.journal" />
        <ActionButton id="view.split" />
      </ToolbarGroup>
    </>
  );
}

export function CommandBar() {
  const { t } = useTranslation();
  const view = useUi((s) => s.view);
  const hasData = useData((s) => !!s.dataset);
  const slot = useLayout((s) => s.slots[view]);
  // re-render on state that changes enabled/checked
  useData((s) => s.revision);
  useOutput((s) => `${s.entries.length}${s.selectedId}`);
  useSettings((s) => `${s.showValueLabels}${s.inspectorOpen}${s.splitView}`);
  useLayout((s) => s.journalOpen);
  useUi((s) => s.engineStatus);
  const assistant = ACTIONS_BY_ID['analysis.assistant'];
  const defaults =
    view === 'data' || view === 'variables' ? <DataTools view={view} /> : view === 'output' ? <OutputTools /> : <SyntaxTools />;
  return (
    <Toolbar aria-label={t('shell.commandBar', { view: t(`views.${view}`) })} className="sh-commandbar">
      <div className="sh-cb-main">
        {(!slot || !slot.replace) && defaults}
        {slot && (
          <>
            {!slot.replace && <ToolbarSeparator />}
            {slot.node}
          </>
        )}
      </div>
      <ToolbarSpacer />
      {hasData && <StatusChips />}
      {hasData && (view === 'data' || view === 'variables') && <ActionButton id="view.inspector" />}
      <RecallButton />
      {hasData ? (
        <Button size="sm" variant="secondary" iconStart="explore" className="sh-analyze" onClick={() => runAction('analysis.assistant')} title={`${t(assistant.label)} (${formatShortcut(assistant.shortcut)})`}>
          {t('shell.analyze')}
        </Button>
      ) : (
        <Chip icon="info">{t('shell.noDataHint')}</Chip>
      )}
    </Toolbar>
  );
}
