/*
 * Menu aim ("safe triangle", as in Amazon's mega menu or Notion): while the pointer travels
 * from an item towards its open submenu, crossing other items neither switches nor closes the
 * submenu. Hover actions are routed through aimed(): they run at once, or as soon as the pointer
 * stops heading into the submenu.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';

type Pt = { x: number; y: number };

export function useMenuAim(menu: RefObject<HTMLElement>, level: number) {
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locs = useRef<Pt[]>([]);
  const lastDelayLoc = useRef<Pt | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      locs.current.push({ x: e.clientX, y: e.clientY });
      if (locs.current.length > 3) locs.current.shift();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  const cancel = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }, []);

  const aimed = useCallback(
    (action: () => void, base = 0) => {
      const delay = (): number | 'inside' => {
        const r = document.querySelector<HTMLElement>(`.menu[data-level="${level + 1}"]`)?.getBoundingClientRect();
        if (!r) return 0;
        const loc = locs.current[locs.current.length - 1];
        const prev = locs.current[0];
        if (!loc) return 0;
        if (loc.x >= r.left && loc.x <= r.right && loc.y >= r.top && loc.y <= r.bottom) return 'inside';
        if (!prev || (prev.x === loc.x && prev.y === loc.y)) return 0;
        const last = lastDelayLoc.current;
        if (last && last.x === loc.x && last.y === loc.y) return 0; // the pointer stopped
        const m = menu.current?.getBoundingClientRect();
        const toRight = !m || r.left >= m.left + m.width / 2;
        const edgeX = toRight ? r.left : r.right;
        const tol = 40; // slack above and below the submenu
        const a: Pt = { x: edgeX, y: r.top - tol };
        const b: Pt = { x: edgeX, y: r.bottom + tol };
        const side = (p: Pt, q: Pt, w: Pt) => (p.x - w.x) * (q.y - w.y) - (q.x - w.x) * (p.y - w.y);
        const d1 = side(loc, prev, a);
        const d2 = side(loc, a, b);
        const d3 = side(loc, b, prev);
        const inTriangle = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
        const towards = toRight ? loc.x > prev.x : loc.x < prev.x;
        if (inTriangle && towards) {
          lastDelayLoc.current = loc;
          return 260;
        }
        return 0;
      };
      cancel();
      const attempt = () => {
        const d = delay();
        if (d === 'inside') return; // reached the submenu: keep it open
        if (d > 0) hoverTimer.current = setTimeout(attempt, d);
        else action();
      };
      if (base > 0) hoverTimer.current = setTimeout(attempt, base);
      else attempt();
    },
    [menu, level, cancel],
  );

  return { aimed, cancel };
}
