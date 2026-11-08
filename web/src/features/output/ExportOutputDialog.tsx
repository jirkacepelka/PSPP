/*
 * Export of the output as PDF or HTML: choose the format and what the document includes (table
 * of contents, interpretations, syntax). A miniature page shows the result as options change.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { useUi } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { useOutput } from '../../store/output';
import { exportOutputDocx, exportOutputHtml, exportOutputPdf } from '../../app/files';
import './export-dialog.css';

type Fmt = 'pdf' | 'docx' | 'html';
const FMT_ICON: Record<Fmt, string> = { pdf: 'picture_as_pdf', docx: 'article', html: 'html' };

function PageArt({ toc, interpret, syntax, fmt }: { toc: boolean; interpret: boolean; syntax: boolean; fmt: Fmt }) {
  return (
    <div className={`xd-page is-${fmt === 'html' ? 'html' : 'paged'}`} aria-hidden="true">
      <div className="xd-head">
        <i className="xd-logo" />
        <span>
          <i className="xd-l w40" />
          <i className="xd-l w70 big" />
        </span>
      </div>
      <div className={`xd-fold ${toc ? 'is-on' : ''}`}>
        <div className="xd-toc">
          <i className="xd-l w50" />
          <i className="xd-l w60" />
          <i className="xd-l w40" />
        </div>
      </div>
      <div className="xd-entry">
        <i className="xd-l w60 mid" />
        <div className={`xd-fold ${syntax ? 'is-on' : ''}`}>
          <div className="xd-syntax">
            <i className="xd-l w70" />
          </div>
        </div>
        <div className="xd-table">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className={i === 0 ? 'h' : ''}>
              <i />
              <i />
              <i />
            </span>
          ))}
        </div>
        <div className="xd-chart">
          {[5, 8, 6, 9, 4].map((h, i) => (
            <i key={i} style={{ height: `${h * 10}%` }} />
          ))}
        </div>
        <div className={`xd-fold ${interpret ? 'is-on' : ''}`}>
          <div className="xd-explain">
            <i className="xd-l w80" />
            <i className="xd-l w50" />
          </div>
        </div>
      </div>
      {fmt !== 'html' && <span className="xd-pageno">1 / 3</span>}
    </div>
  );
}

export function ExportOutputDialog({ format }: { format?: Fmt }) {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  const saved = useSettings((s) => s.outputExport);
  const set = useSettings((s) => s.set);
  const count = useOutput((s) => s.entries.length);
  const [fmt, setFmt] = useState<Fmt>(format ?? saved.format ?? 'pdf');
  const [o, setO] = useState(saved);
  const run = () => {
    set({ outputExport: { ...o, format: fmt } });
    close();
    // let the dialog close before the print dialog takes over
    setTimeout(() => (fmt === 'pdf' ? exportOutputPdf(o) : fmt === 'docx' ? void exportOutputDocx(o) : exportOutputHtml(o)), 30);
  };
  const opts: { key: 'toc' | 'interpret' | 'syntax'; icon: string }[] = [
    { key: 'toc', icon: 'toc' },
    { key: 'interpret', icon: 'lightbulb' },
    { key: 'syntax', icon: 'code' },
  ];
  return (
    <Dialog
      title={t('io.out.title')}
      icon="ios_share"
      size="wide"
      onClose={close}
      footer={
        <>
          <span className="imp-summary">{t('output.results', { count })}</span>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={close}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={run} data-autofocus>
            <Icon name={fmt === 'pdf' ? 'picture_as_pdf' : 'download'} />
            {t(fmt === 'pdf' ? 'io.out.makePdf' : fmt === 'docx' ? 'io.out.makeDocx' : 'io.out.makeHtml')}
          </button>
        </>
      }
    >
      <div className="xd">
        <div className="xd-main">
          <fieldset className="dlg-fieldset">
            <legend className="field-label">{t('saveAs.format')}</legend>
            <div className="format-cards xd-formats">
              {(['pdf', 'docx', 'html'] as const).map((f) => (
                <label key={f} className={`format-card ${fmt === f ? 'on' : ''}`}>
                  <input type="radio" name="xfmt" checked={fmt === f} onChange={() => setFmt(f)} />
                  <Icon name={FMT_ICON[f]} />
                  <span className="format-name">{t(`io.out.fmt.${f}`)}</span>
                  <span className="set-row-desc">{t(`io.out.fmtDesc.${f}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="dlg-fieldset xd-opts">
            <legend className="field-label">{t('io.out.include')}</legend>
            {opts.map(({ key, icon }) => (
              <label key={key} className="check">
                <input type="checkbox" checked={o[key]} onChange={(e) => setO({ ...o, [key]: e.target.checked })} />
                <Icon name={icon} size={18} />
                <span>
                  {t(`io.out.opt.${key}`)}
                  <span className="set-row-desc">{t(`io.out.optDesc.${key}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {fmt === 'pdf' && <p className="field-hint">{t('io.out.pdfHint')}</p>}
        </div>
        <PageArt toc={o.toc} interpret={o.interpret} syntax={o.syntax} fmt={fmt} />
      </div>
    </Dialog>
  );
}
