/*
 * Small dialogs: go to case, find, save as, confirm.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { useData } from '../../store/data';
import { useUi, type Modal } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { caseCount } from '../../lib/variables';
import { formatCell } from '../../lib/format';
import { gridCommands } from '../../app/gridBus';
import { saveDataset, type SaveFormat } from '../../app/files';
import './misc.css';

export function GotoDialog() {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  const setView = useUi((s) => s.setView);
  const ds = useData((s) => s.dataset);
  const sel = useUi((s) => s.selected);
  const [row, setRow] = useState(String((sel?.row ?? 0) + 1));
  const [col, setCol] = useState(ds?.variables[sel?.col ?? 0]?.name ?? '');
  const n = caseCount(ds);
  const go = () => {
    const r = Math.max(1, Math.min(n || 1, Number(row) || 1)) - 1;
    const c = Math.max(0, ds?.variables.findIndex((v) => v.name === col) ?? 0);
    close();
    setView('data');
    setTimeout(() => gridCommands.gotoCase(r, c), 30);
  };
  return (
    <Dialog
      title={t('goto.title')}
      icon="move_down"
      size="small"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={close}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={go}>{t('goto.go')}</button>
        </>
      }
    >
      <form className="dlg-fields" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <div className="field">
          <label htmlFor="goto-row">{t('goto.case', { count: n })}</label>
          <input id="goto-row" className="input" type="number" min={1} max={n} value={row} onChange={(e) => setRow(e.target.value)} data-autofocus />
        </div>
        <div className="field">
          <label htmlFor="goto-var">{t('goto.variable')}</label>
          <select id="goto-var" className="select" value={col} onChange={(e) => setCol(e.target.value)}>
            {ds?.variables.map((v) => (
              <option key={v.name} value={v.name}>{v.label ? `${v.name} – ${v.label}` : v.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function FindDialog() {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  const setView = useUi((s) => s.setView);
  const sel = useUi((s) => s.selected);
  const ds = useData((s) => s.dataset);
  const dec = useSettings((s) => s.decimalSeparator);
  const valueLabels = useUi((s) => s.valueLabels);
  const [q, setQ] = useState('');
  const [col, setCol] = useState<number>(-1);
  const [matchCase, setMatchCase] = useState(false);
  const [whole, setWhole] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pos, setPos] = useState<{ row: number; col: number } | null>(sel);
  const n = caseCount(ds);
  const find = (dir: 1 | -1) => {
    if (!ds || !q) return;
    const cols = col >= 0 ? [col] : ds.variables.map((_, i) => i);
    const norm = (s: string) => (matchCase ? s : s.toLowerCase());
    const needle = norm(q);
    const start = pos ?? { row: dir === 1 ? -1 : n, col: cols[0] };
    const total = n * cols.length;
    let ci = Math.max(0, cols.indexOf(start.col));
    let r = start.row;
    for (let k = 0; k < total; k++) {
      ci += dir;
      if (ci >= cols.length || ci < 0) {
        ci = dir === 1 ? 0 : cols.length - 1;
        r += dir;
        if (r >= n) r = 0;
        if (r < 0) r = n - 1;
      }
      const c = cols[ci];
      const v = ds.variables[c];
      const cell = ds.columns[c][r] ?? null;
      const text = norm(formatCell(cell, v, { valueLabels, decimalSeparator: dec }));
      const raw = norm(cell === null ? '' : String(cell));
      const hit = whole ? text === needle || raw === needle : text.includes(needle) || raw.includes(needle);
      if (hit) {
        setPos({ row: r, col: c });
        setMsg(t('find.found', { row: r + 1, name: v.name }));
        setView('data');
        gridCommands.gotoCase(r, c);
        return;
      }
    }
    setMsg(t('find.notFound', { query: q }));
  };
  return (
    <Dialog
      title={t('find.title')}
      icon="search"
      size="small"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={close}>{t('common.close')}</button>
          <button type="button" className="btn btn-secondary" onClick={() => find(-1)} disabled={!q}>{t('find.previous')}</button>
          <button type="button" className="btn btn-primary" onClick={() => find(1)} disabled={!q}>{t('find.next')}</button>
        </>
      }
    >
      <form className="dlg-fields" onSubmit={(e) => { e.preventDefault(); find(1); }}>
        <div className="field">
          <label htmlFor="find-q">{t('find.query')}</label>
          <input id="find-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus />
        </div>
        <div className="field">
          <label htmlFor="find-col">{t('find.in')}</label>
          <select id="find-col" className="select" value={col} onChange={(e) => setCol(Number(e.target.value))}>
            <option value={-1}>{t('find.allVariables')}</option>
            {ds?.variables.map((v, i) => (
              <option key={v.name} value={i}>{v.name}</option>
            ))}
          </select>
        </div>
        <label className="check"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />{t('find.matchCase')}</label>
        <label className="check"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />{t('find.wholeCell')}</label>
        {msg && <p className="find-msg" role="status">{msg}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

const FORMAT_ICON: Record<SaveFormat, string> = {
  sav: 'description',
  zsav: 'folder_zip',
  por: 'swap_horizontal_circle',
  xlsx: 'table_view',
  ods: 'grid_on',
  csv: 'csv',
  tsv: 'view_column',
  json: 'data_object',
};
const FORMAT_GROUPS: { key: string; formats: SaveFormat[] }[] = [
  { key: 'spss', formats: ['sav', 'zsav', 'por'] },
  { key: 'sheets', formats: ['xlsx', 'ods', 'csv', 'tsv', 'json'] },
];

export function SaveAsDialog() {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  const title = useData((s) => s.title);
  const kind = useUi((s) => s.engineKind);
  const exportOptions = useSettings((s) => s.exportOptions);
  const setSettings = useSettings((s) => s.set);
  const [name, setName] = useState(title || 'data');
  const [format, setFormat] = useState<SaveFormat>(kind === 'mock' ? 'xlsx' : 'sav');
  const [opts, setOpts] = useState(exportOptions);
  const needsEngine = (f: SaveFormat) => f === 'sav' || f === 'zsav' || f === 'por';
  const lossy = !needsEngine(format) && format !== 'json';
  const save = () => {
    close();
    if (lossy) setSettings({ exportOptions: opts });
    void saveDataset({ format, name, saveAs: true, options: opts });
  };
  return (
    <Dialog
      title={t('saveAs.title')}
      icon="save_as"
      size="wide"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={close}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!name.trim()}>
            <Icon name="download" />
            {t('saveAs.save')}
          </button>
        </>
      }
    >
      <form className="dlg-fields" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="field">
          <label htmlFor="sa-name">{t('saveAs.name')}</label>
          <div className="name-ext">
            <input id="sa-name" className="input" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
            <span className="ext">.{format}</span>
          </div>
        </div>
        {FORMAT_GROUPS.map((g) => (
          <fieldset key={g.key} className="dlg-fieldset">
            <legend className="field-label">{t(`io.group.${g.key}`)}</legend>
            <div className="format-cards">
              {g.formats.map((f) => (
                <label key={f} className={`format-card ${format === f ? 'on' : ''}`}>
                  <input type="radio" name="fmt" checked={format === f} onChange={() => setFormat(f)} />
                  <Icon name={FORMAT_ICON[f]} />
                  <span className="format-name">{t(`saveAs.fmt.${f}`)}</span>
                  <span className="set-row-desc">{t(`saveAs.fmtDesc.${f}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {lossy && (
          <fieldset className="dlg-fieldset sa-opts">
            <legend className="field-label">{t('io.options')}</legend>
            <label className="check">
              <input type="checkbox" checked={opts.labels} onChange={(e) => setOpts({ ...opts, labels: e.target.checked })} />
              <span>
                {t('io.labels')}
                <span className="set-row-desc">{t('io.labelsDesc')}</span>
              </span>
            </label>
            {format === 'csv' && (
              <div className="segmented" role="radiogroup" aria-label={t('io.csvStyle')}>
                {[false, true].map((semi) => (
                  <button key={String(semi)} type="button" role="radio" aria-checked={opts.semicolon === semi} onClick={() => setOpts({ ...opts, semicolon: semi })}>
                    {t(semi ? 'io.csvSemicolon' : 'io.csvComma')}
                  </button>
                ))}
              </div>
            )}
            {(format === 'xlsx' || format === 'ods') && <p className="field-hint">{t('io.sheetNote')}</p>}
          </fieldset>
        )}
        {kind === 'mock' && needsEngine(format) && (
          <p className="dlg-info warn">
            <Icon name="warning" />
            {t('saveAs.mockWarning')}
          </p>
        )}
        <p className="field-hint">{t('saveAs.browserNote')}</p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({ modal }: { modal: Extract<Modal, { kind: 'confirm' }> }) {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  return (
    <Dialog
      title={t(modal.titleKey, modal.messageArgs)}
      size="small"
      icon={modal.danger ? 'warning' : 'help'}
      onClose={close}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={close} data-autofocus>{t('common.cancel')}</button>
          <button
            type="button"
            className={`btn ${modal.danger ? 'btn-danger' : 'btn-filled'}`}
            onClick={() => {
              close();
              modal.onConfirm();
            }}
          >
            {t(modal.confirmKey ?? 'common.ok')}
          </button>
        </>
      }
    >
      <p>{t(modal.messageKey, modal.messageArgs)}</p>
    </Dialog>
  );
}
