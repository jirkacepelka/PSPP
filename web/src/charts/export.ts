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
  'stop-color',
  'stop-opacity',
] as const;

/** Properties whose value may be a colour function (color-mix, color(), oklch ...) that a standalone SVG
    rasterizer may not understand. */
const COLOR_PROPS = new Set(['fill', 'stroke', 'stop-color']);
const MODERN_COLOR = /color-mix\(|color\(|oklab\(|oklch\(|lab\(|lch\(|light-dark\(/i;
let px: CanvasRenderingContext2D | null | undefined;
const colorCache = new Map<string, string>();

/** Resolve a CSS colour to plain rgb()/rgba() by painting one pixel; the input is returned when that fails. */
export function plainColor(value: string): string {
  const hit = colorCache.get(value);
  if (hit !== undefined) return hit;
  let out = value;
  try {
    if (px === undefined) {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      px = c.getContext('2d', { willReadFrequently: true });
    }
    if (px) {
      px.clearRect(0, 0, 1, 1);
      px.fillStyle = '#000';
      px.fillStyle = value;
      px.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = px.getImageData(0, 0, 1, 1).data;
      out = a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
    }
  } catch {
    // keep the original value
  }
  colorCache.set(value, out);
  return out;
}

function findSvg(el: Element): SVGSVGElement | null {
  if (el instanceof SVGSVGElement) return el;
  return el.querySelector('svg.pspp-chart__svg') ?? el.querySelector('svg');
}

/** A copy of an <svg> with the computed style of every element inlined. */
function styledClone(svg: SVGSVGElement): SVGSVGElement {
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
      let v = cs.getPropertyValue(p);
      if (v && COLOR_PROPS.has(p) && MODERN_COLOR.test(v)) v = plainColor(v);
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
  return clone;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The panels chart is a grid of charts; its export puts every panel's <svg> into one outer <svg>. */
function panelsClone(root: Element): { svg: SVGSVGElement; width: number; height: number } {
  const host = root.matches('[data-pspp-panels]') ? root : (root.querySelector('[data-pspp-panels]') as Element);
  const hostBox = host.getBoundingClientRect();
  const surface = plainColor(getComputedStyle(host).backgroundColor || '#ffffff');
  const out = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(Math.round(hostBox.width)));
  bg.setAttribute('height', String(Math.round(hostBox.height)));
  bg.setAttribute('style', `fill:${surface}`);
  out.appendChild(bg);
  const addText = (el: Element, text: string, extra = '') => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(Math.round(b.left - hostBox.left)));
    t.setAttribute('y', String(Math.round(b.top - hostBox.top + b.height / 2)));
    t.setAttribute('style', `fill:${plainColor(cs.color)};font-family:${cs.fontFamily};font-size:${cs.fontSize};font-weight:${cs.fontWeight};dominant-baseline:central${extra}`);
    t.textContent = text;
    out.appendChild(t);
  };
  host.querySelectorAll('[data-panels-title]').forEach((el) => addText(el, el.textContent ?? ''));
  host.querySelectorAll('[data-panel]').forEach((cell) => {
    const title = cell.querySelector('[data-panel-title]');
    if (title) addText(title, title.textContent ?? '');
    const svg = cell.querySelector('svg.pspp-chart__svg');
    if (!svg) return;
    const b = svg.getBoundingClientRect();
    const inner = styledClone(svg as SVGSVGElement);
    inner.setAttribute('x', String(Math.round(b.left - hostBox.left)));
    inner.setAttribute('y', String(Math.round(b.top - hostBox.top)));
    inner.setAttribute('width', String(Math.round(b.width)));
    inner.setAttribute('height', String(Math.round(b.height)));
    out.appendChild(inner);
  });
  return { svg: out, width: Math.round(hostBox.width), height: Math.round(hostBox.height) };
}

function buildSvg(el: Element): { text: string; width: number; height: number } {
  let clone: SVGSVGElement;
  let width: number;
  let height: number;
  if (el.matches('[data-pspp-panels]') || el.querySelector('[data-pspp-panels]')) {
    ({ svg: clone, width, height } = panelsClone(el));
  } else {
    const svg = findSvg(el);
    if (!svg) throw new Error('chartToSvgString: no <svg> found');
    clone = styledClone(svg);
    ({ width, height } = svg.getBoundingClientRect());
    clone.removeAttribute('role');
  }
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(Math.round(width)));
  clone.setAttribute('height', String(Math.round(height)));
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${Math.round(width)} ${Math.round(height)}`);
  return { text: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone), width, height };
}

/** Serialize a rendered chart (its <svg>, or any element containing it) to a standalone SVG document. */
export function chartToSvgString(el: Element): string {
  return buildSvg(el).text;
}

/** Render a chart to a PNG blob at `scale`× its on-screen size. */
export function chartToPngBlob(el: Element, scale = 2): Promise<Blob> {
  let built: { text: string; width: number; height: number };
  try {
    built = buildSvg(el);
  } catch (e) {
    return Promise.reject(e);
  }
  const { text, width, height } = built;
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
