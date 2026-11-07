/*
 * Live miniature of the workspace drawn from the current settings: app bar (accent logo, avatar),
 * menu bar, command bar (icons or icons + labels), formula bar, data grid (density, font size,
 * value labels, decimal separator) with the variable inspector, or an output page (table style,
 * explanations), and the status bar. Parts animate in and out as settings change, and a part
 * named in `highlight` is outlined so a settings row can point at what it changes.
 *
 * Used by the onboarding guide (right column) and Settings (Appearance, workspace group).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { useSettings, type Settings } from '../../store/settings';
import { Avatar } from '../shell/ProfileMenu';

export type PreviewPart = 'appbar' | 'avatar' | 'menu' | 'toolbar' | 'labels' | 'formula' | 'grid' | 'inspector' | 'status' | 'explain' | 'table' | 'numbers' | 'valueLabels';

/** The settings the preview reads; pass `patch` to preview values that are not applied yet. */
type PreviewSettings = Pick<
  Settings,
  | 'density'
  | 'fontSize'
  | 'showToolbar'
  | 'toolbarLabels'
  | 'showFormulaBar'
  | 'showStatusBar'
  | 'inspectorOpen'
  | 'showValueLabels'
  | 'decimalSeparator'
  | 'explainResults'
  | 'tableStyle'
  | 'gridFont'
  | 'profile'
  | 'variableViewAllColumns'
  | 'pFormat'
  | 'leadingZero'
>;

function Part({ on = true, part, hl, children, className = '' }: { on?: boolean; part: PreviewPart; hl?: PreviewPart | null; children: ReactNode; className?: string }) {
  return (
    <div className={`wp-fold ${on ? 'is-on' : ''}`} aria-hidden={!on}>
      <div className={`wp-part ${className} ${hl === part ? 'is-hl' : ''}`} data-part={part}>
        {children}
      </div>
    </div>
  );
}

const ROWS: [number, number, number][] = [
  [1, 21, 2.87],
  [2, 23, 3.42],
  [1, 19, 2.15],
  [2, 22, 3.9],
  [1, 24, 3.05],
  [2, 20, 2.64],
  [1, 25, 3.71],
  [2, 21, 3.33],
  [1, 22, 2.48],
  [2, 19, 3.56],
  [1, 23, 2.92],
];

export function WorkspacePreview({ view = 'data', highlight = null, patch, className = '', label }: { view?: 'data' | 'output'; highlight?: PreviewPart | null; patch?: Partial<PreviewSettings>; className?: string; label?: string }) {
  const { t } = useTranslation();
  const live = useSettings();
  const s: PreviewSettings = { ...live, ...patch };
  const dec = (x: number, d = 2) => x.toFixed(d).replace('.', s.decimalSeparator);
  const p = (x: number) => {
    const txt = dec(x, 3);
    return s.leadingZero === 'always' ? txt : txt.replace(/^0/, '');
  };
  const dense = s.density === 'compact';
  const rows = dense ? 12 : s.fontSize >= 15 ? 7 : 9;
  const style = { ['--wp-row' as string]: `${(dense ? 11 : 14) * (s.fontSize / 14)}px`, ['--wp-fs' as string]: `${(dense ? 6.5 : 7.5) * (s.fontSize / 14)}px` } as CSSProperties;
  const sex = (v: number) => (s.showValueLabels ? t(v === 1 ? 'preview.male' : 'preview.female') : String(v));
  const tools = [
    { icon: 'label', text: t('preview.tLabels') },
    { icon: 'search', text: t('preview.tFind') },
    { icon: 'table_rows', text: t('preview.tCase') },
    { icon: 'sort', text: t('preview.tSort') },
  ];
  const cols = s.variableViewAllColumns ? 4 : 3;
  return (
    <div className={`wp ${dense ? 'is-dense' : ''} wp-font-${s.gridFont} ${className}`} style={style} role="img" aria-label={label ?? t('preview.aria')}>
      <Part part="appbar" hl={highlight} className="wp-app">
        <span className="wp-logo" />
        <span className="wp-title">{t('preview.docTitle')}</span>
        <span className="wp-sp" />
        <span className="wp-search" />
        <span className={`wp-avatar ${highlight === 'avatar' ? 'is-hl' : ''}`} data-part="avatar">
          <Avatar profile={s.profile} />
        </span>
      </Part>
      <Part part="menu" hl={highlight} className="wp-menu">
        {['file', 'edit', 'data', 'transform', 'analyze', 'graphs'].map((m) => (
          <span key={m}>{t(`menu.${m}`)}</span>
        ))}
      </Part>
      <Part part="toolbar" on={s.showToolbar} hl={highlight === 'labels' ? 'toolbar' : highlight} className="wp-tool">
        {tools.map((x) => (
          <span key={x.icon} className={`wp-tbtn ${s.toolbarLabels ? 'has-label' : ''}`}>
            <Icon name={x.icon} size={9} />
            {s.toolbarLabels && <span>{x.text}</span>}
          </span>
        ))}
        {!s.toolbarLabels && (
          <>
            <span className="wp-tbtn">
              <Icon name="undo" size={9} />
            </span>
            <span className="wp-tbtn">
              <Icon name="filter_alt" size={9} />
            </span>
          </>
        )}
      </Part>
      <Part part="formula" on={s.showFormulaBar && view === 'data'} hl={highlight} className="wp-formula">
        <span className="wp-cellref">2:age</span>
        <span className="wp-fx">fx</span>
        <span>23</span>
      </Part>
      <div className="wp-body">
        {view === 'data' ? (
          <>
            <div className={`wp-grid ${highlight === 'grid' || highlight === 'numbers' || highlight === 'valueLabels' ? 'is-hl' : ''}`} style={{ ['--cols' as string]: cols }}>
              <span className="wp-h wp-rn" />
              <span className="wp-h">sex</span>
              <span className="wp-h">age</span>
              <span className="wp-h">gpa</span>
              {cols > 3 && <span className="wp-h">job</span>}
              {ROWS.slice(0, rows).map((r, i) => (
                <div key={i} className="wp-r">
                  <span className="wp-rn">{i + 1}</span>
                  <span className={`wp-c wp-txt ${highlight === 'valueLabels' ? 'is-hl' : ''}`}>{sex(r[0])}</span>
                  <span className={`wp-c wp-num ${i === 1 ? 'is-sel' : ''}`}>{r[1]}</span>
                  <span className={`wp-c wp-num ${highlight === 'numbers' ? 'is-hl' : ''}`}>{dec(r[2])}</span>
                  {cols > 3 && <span className="wp-c wp-num">{(i % 3) + 1}</span>}
                </div>
              ))}
            </div>
            <div className={`wp-fold-x ${s.inspectorOpen ? 'is-on' : ''}`} aria-hidden={!s.inspectorOpen}>
              <div className={`wp-insp ${highlight === 'inspector' ? 'is-hl' : ''}`} data-part="inspector">
                <span className="wp-insp-title">age</span>
                <span className="wp-insp-sub">{t('preview.scale')}</span>
                <span className="wp-bars">
                  {[3, 6, 9, 7, 4, 2].map((h, i) => (
                    <i key={i} style={{ height: `${h * 9}%` }} />
                  ))}
                </span>
                <span className="wp-chips">
                  <i>{t('preview.male')}</i>
                  <i>{t('preview.female')}</i>
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="wp-out">
            <span className="wp-out-h">{t('preview.outTitle')}</span>
            <div className={`output-doc ts-${s.tableStyle} wp-out-table ${highlight === 'table' ? 'is-hl' : ''}`}>
              <table>
                <tbody>
                  <tr>
                    <th />
                    <th>N</th>
                    <th>{t('stat.mean')}</th>
                    <th>p</th>
                  </tr>
                  <tr>
                    <th>{t('preview.male')}</th>
                    <td className="num">58</td>
                    <td className={`num ${highlight === 'numbers' ? 'is-hl' : ''}`}>{dec(2.71)}</td>
                    <td className="num" rowSpan={2}>
                      {s.pFormat === 'threshold' ? '< ' + p(0.01) : p(0.004)}
                    </td>
                  </tr>
                  <tr>
                    <th>{t('preview.female')}</th>
                    <td className="num">62</td>
                    <td className="num">{dec(3.08)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={`wp-fold ${s.explainResults !== 'never' ? 'is-on' : ''}`}>
              <div className={`wp-part ${highlight === 'explain' ? 'is-hl' : ''}`} data-part="explain">
                {s.explainResults === 'always' ? (
                  <span className="wp-explain">
                    <Icon name="lightbulb" size={9} />
                    <span>{t('preview.explain')}</span>
                  </span>
                ) : (
                  <span className="wp-explain-btn">
                    <Icon name="lightbulb" size={9} />
                    {t('preview.explainBtn')}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <Part part="status" on={s.showStatusBar} hl={highlight} className="wp-status">
        <span className="wp-dot" />
        <span>{t('preview.status')}</span>
        <span className="wp-sp" />
        <span>N = 120</span>
      </Part>
    </div>
  );
}
