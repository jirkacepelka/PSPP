/* Shared parts of the 3D charts: the view controller (drag, wheel, pinch, keys), the toolbar buttons,
   and the bounding box with back-wall gridlines and tick labels that follow the rotation.
   SPDX-License-Identifier: GPL-3.0-or-later */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { FONT } from './shell';
import { measureText, niceTicks, tickFormatter, truncateText } from './scale';
import { applyDomain } from './styleSpec';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  boxEdges,
  boxFaces,
  clampNum,
  corner,
  edgeInFront,
  faceVisible,
  normalizeView,
  pickAxisEdges,
  project,
  sameView,
  thinByGap,
  wrapAzimuth,
  type Box3,
  type Cam,
} from './proj3d';
import { tr, type ChartT } from './strings';
import type { View3d } from './studioTypes';

/* ------------------------------------------------------------ controller */

export interface ViewCtl {
  view: Required<View3d>;
  /** the latest view, also between renders */
  get(): Required<View3d>;
  /** true while a pointer drag or pinch is in progress (renderers may draw a lighter level of detail) */
  dragging: boolean;
  setDragging(v: boolean): void;
  /** change the view because the user asked to (reported through onView3dChange) */
  change(patch: Partial<View3d>): void;
  reset(): void;
  togglePerspective(): void;
}

const REPORT_DELAY = 300;

/** The view state of a 3D chart.  It starts from `init` (chart.view3d, or the defaults), follows later changes of
    `init`, and reports the user's changes through `onChange`, debounced; a pending report is flushed on unmount. */
export function useView3d(init: View3d | undefined, onChange?: (v: View3d) => void): ViewCtl {
  const initial = normalizeView(init);
  const initKey = `${initial.azimuth}|${initial.elevation}|${initial.perspective}|${initial.zoom}`;
  const [view, setView] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const viewRef = useRef(view);
  const cbRef = useRef(onChange);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);
  const firstKey = useRef(initKey);
  cbRef.current = onChange;

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) {
      pending.current = false;
      const v = viewRef.current;
      cbRef.current?.({ azimuth: v.azimuth, elevation: v.elevation, perspective: v.perspective, zoom: v.zoom });
    }
  }, []);

  const commit = useCallback(
    (next: Required<View3d>, user: boolean) => {
      if (sameView(next, viewRef.current)) return;
      viewRef.current = next;
      setView(next);
      if (user) {
        pending.current = true;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, REPORT_DELAY);
      }
    },
    [flush],
  );

  // a new chart.view3d from outside (the studio's own change) replaces the view without being reported back
  useEffect(() => {
    if (initKey === firstKey.current) return;
    firstKey.current = initKey;
    pending.current = false;
    commit(initial, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initKey]);

  useEffect(() => flush, [flush]);

  const change = useCallback(
    (patch: Partial<View3d>) => commit(normalizeView({ ...viewRef.current, ...patch }), true),
    [commit],
  );
  const reset = useCallback(() => commit(normalizeView({ ...initial, perspective: viewRef.current.perspective }), true), [commit, initial]);
  const togglePerspective = useCallback(() => commit(normalizeView({ ...viewRef.current, perspective: !viewRef.current.perspective }), true), [commit]);
  const get = useCallback(() => viewRef.current, []);
  return { view, get, dragging, setDragging, change, reset, togglePerspective };
}

/** The reset and perspective buttons that go into the chart's hover toolbar. */
export function ViewButtons({ ctl, t }: { ctl: ViewCtl; t: ChartT }) {
  const resetLabel = tr(t, 'resetView');
  const perspLabel = tr(t, 'perspective');
  return (
    <>
      <button type="button" className="pspp-chart__btn" title={resetLabel} aria-label={resetLabel} onClick={ctl.reset}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 8a5.5 5.5 0 1 0 1.8-4.1M2.5 2.5v3.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button type="button" className="pspp-chart__btn" aria-pressed={ctl.view.perspective} title={perspLabel} aria-label={perspLabel} onClick={ctl.togglePerspective}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 5.5l4-2h8v7l-4 2H2zM2 5.5h8v7M10 5.5l4-2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </button>
    </>
  );
}

/* ------------------------------------------------------- input surface */

const DRAG_DEG_PER_PX = 0.5;
const KEY_STEP = 5;

/** Transparent rectangle over the plot that turns pointer, wheel and key input into view changes.  Hover is
    reported to the chart (`onHover`, local plot coordinates) while no button is down. */
export function ViewSurface({
  ctl,
  width,
  height,
  label,
  t,
  onHover,
  onLeave,
}: {
  ctl: ViewCtl;
  width: number;
  height: number;
  label: string;
  t: ChartT;
  onHover?: (x: number, y: number, e: { clientX: number; clientY: number }) => void;
  onLeave?: () => void;
}) {
  const ref = useRef<SVGRectElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const ctlRef = useRef(ctl);
  ctlRef.current = ctl;

  // wheel needs a non-passive listener to stop the page from scrolling while the chart zooms
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const c = ctlRef.current;
      const z = c.get().zoom;
      const next = clampNum(z * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), ZOOM_MIN, ZOOM_MAX);
      // at a limit the page may scroll as usual
      if (Math.abs(next - z) < 1e-9) return;
      e.preventDefault();
      c.change({ zoom: next });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const down = (e: RPointerEvent<SVGRectElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // keyboard rotation after a click, without the focus ring a mouse press should not show
    e.currentTarget.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
    ctl.setDragging(true);
    onLeave?.();
  };
  const move = (e: RPointerEvent<SVGRectElement>) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) {
      if (onHover) {
        const r = e.currentTarget.getBoundingClientRect();
        onHover(e.clientX - r.left, e.clientY - r.top, e);
      }
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current > 0 && dist > 0) ctl.change({ zoom: clampNum(ctl.get().zoom * (dist / pinch.current), ZOOM_MIN, ZOOM_MAX) });
      pinch.current = dist;
      return;
    }
    if (dx || dy) {
      const cur = ctl.get();
      ctl.change({ azimuth: wrapAzimuth(cur.azimuth + dx * DRAG_DEG_PER_PX), elevation: clampNum(cur.elevation + dy * DRAG_DEG_PER_PX, -90, 90) });
    }
  };
  const up = (e: RPointerEvent<SVGRectElement>) => {
    pointers.current.delete(e.pointerId);
    pinch.current = 0;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!pointers.current.size) ctl.setDragging(false);
  };
  const key = (e: KeyboardEvent<SVGRectElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? KEY_STEP * 3 : KEY_STEP;
    const v = ctl.get();
    switch (e.key) {
      case 'ArrowLeft':
        ctl.change({ azimuth: wrapAzimuth(v.azimuth - step) });
        break;
      case 'ArrowRight':
        ctl.change({ azimuth: wrapAzimuth(v.azimuth + step) });
        break;
      case 'ArrowUp':
        ctl.change({ elevation: clampNum(v.elevation + step, -90, 90) });
        break;
      case 'ArrowDown':
        ctl.change({ elevation: clampNum(v.elevation - step, -90, 90) });
        break;
      case '+':
      case '=':
        ctl.change({ zoom: clampNum(v.zoom * 1.15, ZOOM_MIN, ZOOM_MAX) });
        break;
      case '-':
      case '_':
        ctl.change({ zoom: clampNum(v.zoom / 1.15, ZOOM_MIN, ZOOM_MAX) });
        break;
      case 'Home':
        ctl.reset();
        break;
      case 'Escape':
        onLeave?.();
        return;
      default:
        return;
    }
    e.preventDefault();
  };
  const v = ctl.view;
  return (
    <rect
      ref={ref}
      data-export="omit"
      className="pspp-chart__hit pspp-chart__hit--3d"
      x={0}
      y={0}
      width={width}
      height={height}
      tabIndex={0}
      role="group"
      aria-label={`${label} ${tr(t, 'view3dHelp')}`}
      aria-description={tr(t, 'view3dState', { azimuth: Math.round(v.azimuth), elevation: Math.round(v.elevation), zoom: v.zoom.toFixed(2) })}
      style={{ touchAction: 'none', cursor: ctl.dragging ? 'grabbing' : 'grab' }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={(e) => {
        if (!pointers.current.has(e.pointerId)) onLeave?.();
      }}
      onKeyDown={key}
      onBlur={onLeave}
    />
  );
}

/* ----------------------------------------------------------------- frame */

export interface Axis3 {
  /** tick positions as fractions 0..1 along the axis, with their labels */
  ticks: { t: number; label: string }[];
  /** gridline positions as fractions 0..1 */
  grid: number[];
  title?: string;
}

const half = (b: Box3): [number, number, number] => [b.bx / 2, b.by / 2, b.bz / 2];
const len = (b: Box3): [number, number, number] => [b.bx, b.by, b.bz];
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The box and its labels, as two layers: `before` (back walls, silhouette edges) goes under the data and
    `after` (front edges, tick labels, axis titles) over it. */
export function buildFrame(o: {
  cam: Cam;
  view: Required<View3d>;
  box: Box3;
  axes: [Axis3, Axis3, Axis3];
  grid: boolean;
  fs: number;
  width: number;
  height: number;
  /** z as a fraction of the box height where the zero plane lies, drawn when it is not the floor */
  zeroT?: number;
}): { before: ReactNode; after: ReactNode } {
  const { cam, view, box, axes, fs, width, height } = o;
  const P = (x: number, y: number, z: number) => project(cam, x, y, z);
  const hf = half(box);
  const L = len(box);
  const fmt = (p: { x: number; y: number }) => `${r1(p.x)},${r1(p.y)}`;

  // back walls: gridlines on the three faces turned away from the camera
  let gridPath = '';
  if (o.grid) {
    for (const f of boxFaces(box)) {
      if (faceVisible(cam, f.centre, f.normal)) continue;
      const [a1, a2] = ([0, 1, 2] as const).filter((k) => k !== f.axis);
      for (const [u, v] of [
        [a1, a2],
        [a2, a1],
      ] as const) {
        for (const t of axes[u].grid) {
          const c0: [number, number, number] = [0, 0, 0];
          c0[f.axis] = f.centre[f.axis];
          c0[u] = (t - 0.5) * L[u];
          const c1: [number, number, number] = [...c0];
          c0[v] = -hf[v];
          c1[v] = hf[v];
          gridPath += `M${fmt(P(...c0))}L${fmt(P(...c1))}`;
        }
      }
    }
  }
  let backEdges = '';
  let frontEdges = '';
  for (const e of boxEdges()) {
    const a = P(...corner(box, e.a));
    const b = P(...corner(box, e.b));
    const seg = `M${fmt(a)}L${fmt(b)}`;
    if (edgeInFront(cam, box, e)) frontEdges += seg;
    else backEdges += seg;
  }
  let zeroPath = '';
  if (o.zeroT !== undefined && o.zeroT > 0.001 && o.zeroT < 0.999) {
    const z = (o.zeroT - 0.5) * box.bz;
    const ring = [
      [-hf[0], -hf[1]],
      [hf[0], -hf[1]],
      [hf[0], hf[1]],
      [-hf[0], hf[1]],
    ].map(([x, y]) => P(x, y, z));
    zeroPath = 'M' + ring.map(fmt).join('L') + 'Z';
  }

  // tick labels along one edge per axis
  const picks = pickAxisEdges(view);
  const centre = P(0, 0, 0);
  const tickSize = FONT.tick * fs;
  const labels: ReactNode[] = [];
  const titles: ReactNode[] = [];
  const marks: string[] = [];
  ([0, 1, 2] as const).forEach((k) => {
    const at = k === 0 ? picks.x : k === 1 ? picks.y : picks.z;
    const others = ([0, 1, 2] as const).filter((j) => j !== k);
    const at3 = (t: number): [number, number, number] => {
      const p: [number, number, number] = [0, 0, 0];
      p[k] = (t - 0.5) * L[k];
      p[others[0]] = at[0] * hf[others[0]];
      p[others[1]] = at[1] * hf[others[1]];
      return p;
    };
    const p0 = P(...at3(0));
    const p1 = P(...at3(1));
    const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    let dx = mid.x - centre.x;
    let dy = mid.y - centre.y;
    const dl = Math.hypot(dx, dy);
    if (dl < 1e-6) (dx = k === 2 ? -1 : 0), (dy = k === 2 ? 0 : 1);
    else (dx /= dl), (dy /= dl);
    const edgeLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const ax = axes[k];
    const maxW = ax.ticks.reduce((m, tk) => Math.max(m, measureText(truncateText(tk.label, 96, tickSize), tickSize)), 0);
    // tick labels, thinned by their distance on screen
    if (edgeLen >= 24 && ax.ticks.length) {
      const anchors = ax.ticks.map((tk) => P(...at3(tk.t)));
      const ux = (p1.x - p0.x) / (edgeLen || 1);
      const uy = (p1.y - p0.y) / (edgeLen || 1);
      const gap = Math.abs(ux) * (maxW + 8) + Math.abs(uy) * (tickSize + 6);
      const keep = thinByGap(anchors, Math.max(tickSize + 4, gap));
      for (const i of keep) {
        const a = anchors[i];
        const lx = a.x + dx * 11;
        const ly = a.y + dy * 11;
        marks.push(`M${fmt(a)}L${r1(a.x + dx * 5)},${r1(a.y + dy * 5)}`);
        const anchor = dx > 0.45 ? 'start' : dx < -0.45 ? 'end' : 'middle';
        labels.push(
          <text key={`${k}:${i}`} className="pspp-chart__tick3d" x={r1(lx)} y={r1(ly + (Math.abs(dy) > 0.45 ? dy * (tickSize * 0.5) : 0))} textAnchor={anchor} dominantBaseline="central">
            {truncateText(ax.ticks[i].label, 96, tickSize)}
          </text>,
        );
      }
    }
    if (ax.title) {
      const reach = 14 + Math.abs(dx) * maxW + Math.abs(dy) * tickSize + 12 * fs;
      const tw = measureText(truncateText(ax.title, Math.max(80, width * 0.4), FONT.axisTitle * fs, 600), FONT.axisTitle * fs, 600);
      const tx = clampNum(mid.x + dx * reach, tw / 2 + 4, Math.max(tw / 2 + 4, width - tw / 2 - 4));
      const ty = clampNum(mid.y + dy * reach, 10 * fs, Math.max(10 * fs, height - 8));
      titles.push(
        <text key={`t${k}`} className="pspp-chart__axis-title pspp-chart__tick3d" x={r1(tx)} y={r1(ty)} textAnchor="middle" dominantBaseline="central">
          {truncateText(ax.title, Math.max(80, width * 0.4), FONT.axisTitle * fs, 600)}
        </text>,
      );
    }
  });

  return {
    before: (
      <g aria-hidden="true" className="pspp-chart__frame3d">
        {gridPath && <path className="pspp-chart__grid" d={gridPath} />}
        {zeroPath && <path className="pspp-chart__axis3d" d={zeroPath} />}
        <path className="pspp-chart__axis3d" d={backEdges} />
      </g>
    ),
    after: (
      <g aria-hidden="true" className="pspp-chart__frame3d">
        <path className="pspp-chart__axis3d pspp-chart__axis3d--front" d={frontEdges} />
        <path className="pspp-chart__axis3d" d={marks.join('')} />
        {labels}
        {titles}
      </g>
    ),
  };
}

/* --------------------------------------------------------- numeric axis */

export interface NumAxis {
  domain: [number, number];
  ticks: number[];
  fmt: (v: number) => string;
}

/** Nice ticks for a data extent; `lo`/`hi` are the style's axis range overrides.  The tick count is fixed (the
    label thinning on screen handles crowding), so the domain does not change while the chart rotates. */
export function numAxis(min: number, max: number, lo: number | null | undefined, hi: number | null | undefined, locale?: string, count = 5): NumAxis {
  const t = applyDomain(niceTicks(min, max, count), lo, hi, count);
  return { domain: t.domain, ticks: t.ticks, fmt: tickFormatter(t.step, t.ticks, locale) };
}

/** Axis definition (ticks and gridlines as fractions of the box edge) of a numeric axis. */
export function numAxisDef(a: NumAxis, title?: string): Axis3 {
  const span = a.domain[1] - a.domain[0] || 1;
  const ticks = a.ticks.filter((v) => v >= a.domain[0] - span * 1e-9 && v <= a.domain[1] + span * 1e-9).map((v) => ({ t: (v - a.domain[0]) / span, label: a.fmt(v) }));
  return { ticks, grid: ticks.map((k) => k.t), title };
}
