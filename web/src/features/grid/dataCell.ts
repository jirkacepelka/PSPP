/*
 * Custom canvas cell for the Data View: plain values, value labels drawn as calm tags in
 * categorical columns, user-missing values (muted italic with ∅), and a corner mark for
 * data-quality flags (F2, DV-4, DV-6).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';
import type { FlagKind } from './quality';
import type { GridPalette, MeasureKey } from './gridTheme';
import { fitText, roundRect, textWidth } from './canvas';

export interface PickOption {
  /** editable code text */
  code: string;
  label: string;
  missing: boolean;
}

export interface DataCellData {
  kind: 'pspp-data';
  /** text shown in the cell */
  text: string;
  /** editable text (code) */
  raw: string;
  /** draw the text as a value-label tag tinted with this measurement level */
  tag: MeasureKey | null;
  state: 'value' | 'userMissing' | 'empty';
  flag: FlagKind | null;
  align: 'left' | 'right' | 'center';
  /** for the editor: variable name (undefined for phantom columns), case index, label options */
  name?: string;
  row: number;
  options?: PickOption[];
  /** the variable is a string (typing codes is free text) */
  isString?: boolean;
}

export type DataCell = CustomCell<DataCellData>;

export function isDataCell(c: { kind: GridCellKind; data?: unknown }): c is DataCell {
  return c.kind === GridCellKind.Custom && (c.data as DataCellData | undefined)?.kind === 'pspp-data';
}

export function makeDataCellRenderer(getPalette: () => GridPalette, getZoom: () => number): CustomRenderer<DataCell> {
  return {
    kind: GridCellKind.Custom,
    isMatch: (c): c is DataCell => (c.data as DataCellData | undefined)?.kind === 'pspp-data',
    needsHover: false,
    draw: (args, cell) => {
      const { ctx, rect, theme } = args;
      const d = cell.data;
      const pal = getPalette();
      const zoom = getZoom();
      const pad = theme.cellHorizontalPadding;
      const font = `${theme.baseFontStyle} ${theme.fontFamily}`;
      const cy = rect.y + rect.height / 2 + 0.5;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const place = (w: number) => (d.align === 'right' ? rect.x + rect.width - pad - w : d.align === 'center' ? rect.x + (rect.width - w) / 2 : rect.x + pad);

      if (d.text !== '') {
        if (d.state === 'userMissing') {
          ctx.font = `italic ${font}`;
          ctx.fillStyle = pal.ink3;
          const mark = '∅';
          const mw = textWidth(ctx, mark) + 4 * zoom;
          const t = fitText(ctx, d.text, rect.width - 2 * pad - mw);
          const x = place(textWidth(ctx, t) + mw);
          ctx.fillText(mark, x, cy);
          ctx.fillText(t, x + mw, cy);
        } else if (d.tag) {
          ctx.font = font;
          const tagPad = Math.round(6 * zoom);
          const t = fitText(ctx, d.text, rect.width - 2 * pad - 2 * tagPad);
          const w = textWidth(ctx, t) + 2 * tagPad;
          const h = Math.min(rect.height - 8, Math.round(20 * zoom));
          const x = place(w);
          ctx.fillStyle = pal.measureTint[d.tag];
          roundRect(ctx, x, rect.y + (rect.height - h) / 2, w, h, 4);
          ctx.fill();
          ctx.fillStyle = pal.ink;
          ctx.fillText(t, x + tagPad, cy);
        } else {
          ctx.font = font;
          ctx.fillStyle = pal.ink;
          const t = fitText(ctx, d.text, rect.width - 2 * pad);
          ctx.fillText(t, place(textWidth(ctx, t)), cy);
        }
      }

      if (d.flag) {
        const s = Math.round(7 * zoom);
        const rx = rect.x + rect.width;
        ctx.fillStyle = pal.warning;
        ctx.beginPath();
        ctx.moveTo(rx - s - 1, rect.y + 1);
        ctx.lineTo(rx - 1, rect.y + 1);
        ctx.lineTo(rx - 1, rect.y + s + 1);
        ctx.closePath();
        ctx.fill();
      }
      return true;
    },
    onDelete: (cell) => ({ ...cell, data: { ...cell.data, raw: '' } }),
  };
}
