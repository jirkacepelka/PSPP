/*
 * Import of delimited text and spreadsheets with a live preview: encoding, delimiter, decimal
 * separator and header row for text files; the sheet and header row for Excel / OpenDocument.
 * Each column shows the type it will get, so problems (a number column read as text because of
 * the wrong decimal separator) are visible before importing.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { useUi } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { importKind, readDataFile, type ImportOptions, type ImportResult, type TextEncoding } from '../../lib/io';
import { loadImportedDataset } from '../../app/files';
import { formatCell } from '../../lib/format';
import { variableIcon } from '../../app/varIcons';
import './import.css';

const DELIMS: { v: string; key: string }[] = [
  { v: 'auto', key: 'auto' },
  { v: ',', key: 'comma' },
  { v: ';', key: 'semicolon' },
  { v: '\t', key: 'tab' },
  { v: '|', key: 'pipe' },
];
const ENCODINGS: TextEncoding[] = ['auto', 'utf-8', 'windows-1250', 'iso-8859-2', 'windows-1252', 'utf-16le'];
const PREVIEW_ROWS = 8;
const PREVIEW_COLS = 12;

export function ImportDialog({ name, bytes }: { name: string; bytes: Uint8Array }) {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  const decimalSeparator = useSettings((s) => s.decimalSeparator);
  const kind = importKind(name);
  const text = kind === 'text';
  const [o, setO] = useState<ImportOptions>({ delimiter: 'auto', decimal: 'auto', encoding: 'auto', sheet: 0 });
  const set = (p: Partial<ImportOptions>) => setO((x) => ({ ...x, ...p }));

  const res = useMemo((): { ok: ImportResult } | { error: string } => {
    try {
      return { ok: readDataFile(name, bytes, o) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [name, bytes, o]);

  const ok = 'ok' in res ? res.ok : null;
  const ds = ok?.dataset;
  const cases = ds ? Math.max(0, ...ds.columns.map((c) => c.length)) : 0;
  const header = o.header ?? ok?.detected?.header ?? (ds ? !ds.variables.every((v) => /^VAR\d{5}$/.test(v.name)) : true);
  const shownVars = ds?.variables.slice(0, PREVIEW_COLS) ?? [];
  const numeric = ds?.variables.filter((v) => v.type === 'numeric' && !/DATE|TIME|YMDHMS/.test(v.print.type)).length ?? 0;

  const doImport = () => {
    if (!ds) return;
    close();
    loadImportedDataset(name, ds);
  };

  const det = ok?.detected;
  const autoNote = (val: string) => t('io.import.detected', { value: val });

  return (
    <Dialog
      title={t('io.import.title')}
      description={<span className="imp-file"><Icon name={text ? 'description' : 'table_view'} size={16} />{name}</span>}
      icon="upload_file"
      size="wide"
      onClose={close}
      footer={
        <>
          {ds && (
            <span className="imp-summary">
              {t('io.import.summary', { cases: t('io.n.cases', { count: cases }), vars: t('io.n.vars', { count: ds.variables.length }) })}
              {ds.variables.length > 0 && <> · {t('io.import.numeric', { count: numeric })}</>}
            </span>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={close}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={doImport} disabled={!ds || !ds.variables.length} data-autofocus>
            <Icon name="download_done" />
            {t('io.import.import')}
          </button>
        </>
      }
    >
      <div className="imp">
        <div className="imp-opts">
          {text && (
            <>
              <div className="field">
                <label htmlFor="imp-enc">{t('io.import.encoding')}</label>
                <select id="imp-enc" className="select" value={o.encoding} onChange={(e) => set({ encoding: e.target.value as TextEncoding })}>
                  {ENCODINGS.map((x) => (
                    <option key={x} value={x}>{x === 'auto' ? `${t('io.import.auto')}${det && o.encoding === 'auto' ? ` (${det.encoding.toUpperCase()})` : ''}` : x.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <span className="field-label" id="imp-del-l">{t('io.import.delimiter')}</span>
                <div className="segmented imp-seg" role="radiogroup" aria-labelledby="imp-del-l">
                  {DELIMS.map((d) => (
                    <button key={d.key} type="button" role="radio" aria-checked={o.delimiter === d.v} onClick={() => set({ delimiter: d.v })}>
                      {t(`io.import.delim.${d.key}`)}
                    </button>
                  ))}
                </div>
                {o.delimiter === 'auto' && det && <span className="field-hint">{autoNote(t(`io.import.delim.${DELIMS.find((d) => d.v === det.delimiter)?.key ?? 'comma'}`).toLocaleLowerCase())}</span>}
              </div>
              <div className="field">
                <span className="field-label" id="imp-dec-l">{t('io.import.decimal')}</span>
                <div className="segmented imp-seg" role="radiogroup" aria-labelledby="imp-dec-l">
                  {(['auto', 'dot', 'comma'] as const).map((d) => (
                    <button key={d} type="button" role="radio" aria-checked={o.decimal === d} onClick={() => set({ decimal: d })}>
                      {t(`io.import.dec.${d}`)}
                    </button>
                  ))}
                </div>
                {o.decimal === 'auto' && det && <span className="field-hint">{autoNote(det.decimalComma ? t('io.import.dec.comma') : t('io.import.dec.dot'))}</span>}
              </div>
            </>
          )}
          {!text && ok?.sheets && ok.sheets.length > 1 && (
            <div className="field">
              <label htmlFor="imp-sheet">{t('io.import.sheet')}</label>
              <select id="imp-sheet" className="select" value={o.sheet} onChange={(e) => set({ sheet: Number(e.target.value) })}>
                {ok.sheets.map((s, i) => (
                  <option key={i} value={i}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <label className="check imp-header">
            <input type="checkbox" checked={header} onChange={(e) => set({ header: e.target.checked })} />
            {t('io.import.header')}
          </label>
        </div>

        <div className="imp-preview" aria-label={t('io.import.preview')}>
          {'error' in res ? (
            <p className="dlg-info warn">
              <Icon name="error" />
              {t('io.import.error', { message: res.error })}
            </p>
          ) : ds && ds.variables.length ? (
            <div className="imp-table-wrap" tabIndex={0}>
              <table className="imp-table">
                <thead>
                  <tr>
                    <th className="imp-rn" />
                    {shownVars.map((v) => (
                      <th key={v.name} title={v.label || v.name}>
                        <span className="imp-var">
                          <Icon name={variableIcon(v)} size={14} />
                          {v.label || v.name}
                        </span>
                        <span className="imp-type">{t(v.type === 'string' ? 'io.import.typeText' : /DATE|TIME|YMDHMS/.test(v.print.type) ? 'io.import.typeDate' : 'io.import.typeNumber')}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: Math.min(PREVIEW_ROWS, cases) }, (_, r) => (
                    <tr key={r}>
                      <td className="imp-rn">{r + 1}</td>
                      {shownVars.map((v, c) => (
                        <td key={c} className={v.type === 'numeric' ? 'num' : ''}>
                          {formatCell(ds.columns[c][r] ?? null, v, { decimalSeparator })}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {(ds.variables.length > PREVIEW_COLS || cases > PREVIEW_ROWS) && (
                <p className="imp-more">{t('io.import.more', { rows: Math.max(0, cases - PREVIEW_ROWS), cols: Math.max(0, ds.variables.length - PREVIEW_COLS) })}</p>
              )}
            </div>
          ) : (
            <p className="imp-empty">{t('io.import.empty')}</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
