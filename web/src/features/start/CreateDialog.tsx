/*
 * "Create" popup on Home: open a file, blank data or new syntax as large tiles with previews.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { Kbd } from '../../components/Kbd';
import { formatShortcut } from '../../app/actions';
import { newDataset, newSyntax, openFileDialog } from '../../app/files';

export function CreateDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const pick = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Dialog title={t('home.createTitle')} description={t('home.createDesc')} icon="add" onClose={onClose} size="wide" className="hm-create-dlg">
      <ul className="hm-create-grid">
        <li style={{ '--i': 0 } as CSSProperties}>
          <button type="button" className="hm-ctile hm-ctile-open" onClick={pick(() => void openFileDialog())} data-autofocus>
            <span className="hm-cthumb">
              <span className="hm-cupload">
                <Icon name="upload_file" size={34} />
              </span>
              <span className="hm-formats">.sav · .zsav · .por · .csv · .ods · .sps</span>
              <span className="hm-kbd">
                <Kbd keys={formatShortcut('Mod+O').split('+')} />
              </span>
            </span>
            <span className="hm-card-title">{t('home.openTitle')}</span>
            <span className="hm-card-desc">{t('home.openDescShort')}</span>
          </button>
        </li>
        <li style={{ '--i': 1 } as CSSProperties}>
          <button type="button" className="hm-ctile" onClick={pick(newDataset)}>
            <span className="hm-cthumb">
              <span className="hm-sheet empty" aria-hidden="true">
                <span className="hm-sheet-head" />
                {Array.from({ length: 6 }, (_, r) => (
                  <span key={r} className="hm-sheet-row" style={{ '--r': r } as CSSProperties}>
                    <span />
                    <span />
                    <span />
                  </span>
                ))}
              </span>
              <span className="hm-plus">
                <Icon name="add" size={28} />
              </span>
            </span>
            <span className="hm-card-title">{t('home.blankTitle')}</span>
            <span className="hm-card-desc">{t('home.blankDesc')}</span>
          </button>
        </li>
        <li style={{ '--i': 2 } as CSSProperties}>
          <button type="button" className="hm-ctile" onClick={pick(() => void newSyntax())}>
            <span className="hm-cthumb hm-cthumb-code" aria-hidden="true">
              <code>
                <span className="hm-code-line" style={{ '--r': 0 } as CSSProperties}>
                  <b>FREQUENCIES</b>
                </span>
                <span className="hm-code-line" style={{ '--r': 1 } as CSSProperties}>
                  {'  /VARIABLES=…'}
                </span>
                <span className="hm-code-line" style={{ '--r': 2 } as CSSProperties}>
                  <b>DESCRIPTIVES</b>
                </span>
                <span className="hm-code-line" style={{ '--r': 3 } as CSSProperties}>
                  {'  /VARIABLES=…'}
                </span>
                <span className="hm-caret" />
              </code>
            </span>
            <span className="hm-card-title">{t('home.syntaxTitle')}</span>
            <span className="hm-card-desc">{t('home.syntaxDesc')}</span>
          </button>
        </li>
      </ul>
      <p className="hm-create-hint">
        <Icon name="file_open" size={16} />
        {t('home.dropHint')}
      </p>
    </Dialog>
  );
}
