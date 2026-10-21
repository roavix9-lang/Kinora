import { TextStyle } from '../types';

interface Rendered { canvas: OffscreenCanvas | HTMLCanvasElement; width: number; height: number; key: string }

const cache = new Map<string, Rendered>();
const loadedFonts = new Set<string>();
let onFontLoaded: (() => void) | null = null;

export function setFontLoadedHandler(fn: () => void) { onFontLoaded = fn; }

const fontString = (s: TextStyle, px: number) =>
  `${s.italic ? 'italic ' : ''}${s.bold ? '700' : '400'} ${px}px "${s.font}", sans-serif`;

function ensureFont(s: TextStyle) {
  const id = `${s.font}|${s.bold}|${s.italic}`;
  if (loadedFonts.has(id)) return;
  loadedFonts.add(id);
  document.fonts.load(fontString(s, 32)).then(() => {
    // Drop cached renders made with the fallback face.
    for (const k of [...cache.keys()]) if (k.includes(s.font)) cache.delete(k);
    onFontLoaded?.();
  }).catch(() => {});
}

function makeCanvas(w: number, h: number) {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
}

/**
 * Rasterises a text style. `px` is the final font size in output pixels, so text
 * stays crisp at 4K. Returns logical width/height in those same pixels.
 */
export function renderText(s: TextStyle, px: number): Rendered {
  px = Math.max(4, Math.round(px));
  const key = `${JSON.stringify(s)}@${px}`;
  const hit = cache.get(key);
  if (hit) return hit;
  ensureFont(s);

  const lines = s.content.split('\n');
  const measureCanvas = makeCanvas(1, 1);
  const m = measureCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  m.font = fontString(s, px);
  if ('letterSpacing' in m) (m as unknown as { letterSpacing: string }).letterSpacing = `${s.letterSpacing * px / 100}px`;
  const lineH = px * s.lineHeight;
  const widths = lines.map((l) => m.measureText(l || ' ').width);
  const pad = Math.ceil(px * 0.25 + s.strokeWidth * px / 100 + (s.shadow ? px * 0.2 : 0));
  const textW = Math.max(...widths, 1);
  const w = Math.ceil(textW + pad * 2);
  const h = Math.ceil(lineH * lines.length + pad * 2);

  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.font = m.font;
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${s.letterSpacing * px / 100}px`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  if (s.background) {
    ctx.fillStyle = s.background;
    const r = px * 0.18;
    ctx.beginPath();
    ctx.roundRect(pad * 0.4, pad * 0.4, w - pad * 0.8, h - pad * 0.8, r);
    ctx.fill();
  }

  const hl = new Set(s.highlightWords ?? []);
  lines.forEach((line, i) => {
    const lw = widths[i];
    const x = s.align === 'left' ? pad : s.align === 'right' ? w - pad - lw : (w - lw) / 2;
    const y = pad + lineH * (i + 0.5);
    if (s.shadow) {
      ctx.shadowColor = s.color === '#ffffff' ? 'rgba(0,0,0,0.85)' : s.color;
      ctx.shadowBlur = px * 0.25;
      ctx.shadowOffsetX = s.color === '#ffffff' ? px * 0.04 : 0;
      ctx.shadowOffsetY = s.color === '#ffffff' ? px * 0.04 : 0;
    }
    if (s.strokeWidth > 0) {
      ctx.strokeStyle = s.strokeColor;
      ctx.lineWidth = (s.strokeWidth * px) / 50;
      ctx.strokeText(line, x, y);
    }
    if (hl.size) {
      // Word by word so highlighted keywords get their own colour.
      let cx = x;
      for (const tok of line.split(/(\s+)/)) {
        if (!tok) continue;
        const key = tok.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
        ctx.fillStyle = key && hl.has(key) ? s.highlightColor ?? '#ffe600' : s.color;
        ctx.fillText(tok, cx, y);
        cx += ctx.measureText(tok).width;
      }
    } else {
      ctx.fillStyle = s.color;
      ctx.fillText(line, x, y);
    }
    ctx.shadowColor = 'transparent';
  });

  const out = { canvas, width: w, height: h, key };
  cache.set(key, out);
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return out;
}
