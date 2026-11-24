/* Category labels under a categorical axis (flat, tilted or vertical as catLabels decides).
   SPDX-License-Identifier: GPL-3.0-or-later */

import { catLabels } from './bar';

/** Draws the labels of `info` (from catLabels) below the plot; `bottom` is the plot's bottom edge. */
export function CatLabels({ info, n, xAt, bottom }: { info: ReturnType<typeof catLabels>; n: number; xAt: (i: number) => number; bottom: number }) {
  const { mode, every, labels } = info;
  return (
    <g aria-hidden="true">
      {Array.from({ length: n }, (_, i) =>
        i % every ? null : mode === 'flat' ? (
          <text key={i} className="pspp-chart__tick pspp-chart__tick--cat" x={xAt(i)} y={bottom + 15} textAnchor="middle">
            {labels[i]}
          </text>
        ) : (
          <text
            key={i}
            className="pspp-chart__tick pspp-chart__tick--cat"
            transform={`translate(${xAt(i)} ${bottom + 8}) rotate(${mode === 'tilt' ? -45 : -90})`}
            textAnchor="end"
            dominantBaseline="central"
          >
            {labels[i]}
          </text>
        ),
      )}
    </g>
  );
}
