/* SVG / PNG export.  Charts are styled with CSS custom properties, which a
   standalone SVG file can't see, so the computed style of every element is
   inlined into a clone before serializing. */

const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'visibility',
  'paint-order',
] as const;

function findSvg(el: Element): SVGSVGElement | null {
  if (el instanceof SVGSVGElement) return el;
  return el.querySelector('svg.pspp-chart__svg') ?? el.querySelector('svg');
}

/** Serialize a rendered chart (its <svg>, or any element containing it) to a standalone SVG document. */
export function chartToSvgString(el: Element): string {
  const svg = findSvg(el);
  if (!svg) throw new Error('chartToSvgString: no <svg> found');
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const dst = [clone, ...Array.from(clone.querySelectorAll('*'))];
  for (let i = 0; i < src.length && i < dst.length; i++) {
    const s = src[i];
    const d = dst[i] as SVGElement;
    if (!(d instanceof SVGElement)) continue;
    const cs = getComputedStyle(s);
    const decl: string[] = [];
    for (const p of STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) decl.push(`${p}:${v}`);
    }
    if (cs.display === 'none') decl.push('display:none');
    d.setAttribute('style', decl.join(';'));
    d.removeAttribute('class');
    d.removeAttribute('tabindex');
    d.removeAttribute('focusable');
  }
  // Interaction-only nodes (hover rings, hit areas) don't belong in a file.
  clone.querySelectorAll('[data-export="omit"]').forEach((n) => n.remove());
  const { width, height } = svg.getBoundingClientRect();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.round(width)));
  clone.setAttribute('height', String(Math.round(height)));
  clone.removeAttribute('role');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

/** Render a chart to a PNG blob at `scale`× its on-screen size. */
export function chartToPngBlob(el: Element, scale = 2): Promise<Blob> {
  const svg = findSvg(el);
  if (!svg) return Promise.reject(new Error('chartToPngBlob: no <svg> found'));
  const { width, height } = svg.getBoundingClientRect();
  const text = chartToSvgString(svg);
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const g = canvas.getContext('2d');
        if (!g) throw new Error('no 2d context');
        g.scale(scale, scale);
        g.drawImage(img, 0, 0, width, height);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('could not rasterize chart SVG'));
    };
    img.src = url;
  });
}

export function safeFilename(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'chart';
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSvg(el: Element, name = 'chart'): void {
  saveBlob(new Blob([chartToSvgString(el)], { type: 'image/svg+xml;charset=utf-8' }), safeFilename(name) + '.svg');
}

export async function downloadPng(el: Element, name = 'chart', scale = 2): Promise<void> {
  saveBlob(await chartToPngBlob(el, scale), safeFilename(name) + '.png');
}
