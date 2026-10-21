import { updateClip } from '../actions';
import { curveFn } from '../engine/curves';
import { lutList } from '../engine/luts';
import { store } from '../store';
import {
  AdjustMask, Clip, ColorWheels, CurvePoints, Curves, defaultAdjust, defaultCurves, defaultHsl, defaultMask,
  defaultWheels, identityCurve, MaskShape, Wheel,
} from '../types';
import { live, PCT, row, SIGNED, slider } from './controls';
import { h, icon, toast } from './dom';
import { dropdown } from './select';

// Adjust tab (CapCut layout): Basic · HSL · Curves · Color wheel · Mask, plus
// "Apply to all" / "Save as preset".

export const ADJUST_TABS = ['Basic', 'HSL', 'Curves', 'Color wheel', 'Mask'];

let hslBand = 0;

/** Section with an enable checkbox, collapsible body and reset (CapCut's Adjust sections). */
function checkSection(title: string, on: boolean, onToggle: ((v: boolean) => void) | null, onReset: (() => void) | null, ...children: (HTMLElement | null | false | '')[]) {
  const body = h('div.sec-body', null, ...children);
  const caret = icon('chevronUp', 14);
  const sec = h(`div.section.adj-sec${on ? '' : '.off'}`);
  sec.append(
    h('div.sec-head', null,
      h('div.adj-sec-title', null,
        onToggle ? h('label.adj-check', null, h('input', { type: 'checkbox', checked: on, 'aria-label': `Enable ${title}`, onchange: (e: Event) => onToggle((e.target as HTMLInputElement).checked) }), h('i', null, icon('check', 11))) : null,
        h('button.sec-toggle', { type: 'button', onclick: () => sec.classList.toggle('collapsed') }, h('span', null, title), caret)),
      onReset ? h('button.icon-btn.small', { type: 'button', title: `Reset ${title.toLowerCase()}`, onclick: onReset }, icon('reset', 15)) : null),
    body);
  return sec;
}

const group = (label: string) => h('div.adj-group', null, label);

// ---- Basic -------------------------------------------------------------------------

const TRACKS = {
  temp: 'linear-gradient(90deg, #2b5cff, #8b8b92 50%, #ffe24a)',
  tint: 'linear-gradient(90deg, #2fbf3a, #8b8b92 50%, #e535e5)',
  sat: 'linear-gradient(90deg, #4a4a50, #e5252a)',
  neutral: 'linear-gradient(90deg, #4a4a52, #4a4a52)',
};

function basic(c: Clip): HTMLElement[] {
  const a = c.adjust;
  const lut = c.lut ?? { id: 'none', intensity: 1, protectSkin: false };
  const setLut = (fn: (l: NonNullable<Clip['lut']>) => void) => updateClip(c.id, (x) => { x.lut = { ...(x.lut ?? lut) }; fn(x.lut); });
  const li = live(c.id, (x, v) => { x.lut = { ...(x.lut ?? lut), intensity: v }; });
  const r = (label: string, key: keyof typeof a, min = -1, max = 1, track?: string) => {
    const l = live(c.id, (x, v) => { (x.adjust as unknown as Record<string, number>)[key] = v; });
    return slider(label, (a[key] as number | undefined) ?? 0, min, max, 0.01, min < 0 ? SIGNED : PCT, l.input, l.end, 0, track ?? (min < 0 ? TRACKS.neutral : undefined));
  };
  const presets = loadPresets();
  return [
    presets.length ? checkSection('Presets', true, null, null,
      row('Apply', dropdown('', [{ id: '', name: 'Choose a preset…' }, ...presets.map((p, i) => ({ id: String(i), name: p.name }))], (v) => {
        if (v === '') return;
        const p = presets[+v];
        updateClip(c.id, (x) => Object.assign(x, structuredClone(p.data)));
        toast(`Preset “${p.name}” applied`, 'ok');
      }))) : null,
    checkSection('LUT', lut.id !== 'none', (v) => setLut((l) => { if (!v) l.id = 'none'; else if (l.id === 'none') l.id = lutList()[0].id; }),
      () => updateClip(c.id, (x) => { x.lut = undefined; }),
      row('Name', dropdown(lut.id, [{ id: 'none', name: 'None' }, ...lutList().map((l) => ({ id: l.id, name: l.name, hint: l.category }))], (v) => setLut((l) => { l.id = v; }))),
      lut.id !== 'none' ? slider('Intensity', lut.intensity, 0, 1, 0.01, PCT, li.input, li.end, 1) : null,
      h('label.adj-skin', null,
        h('div', null, h('div.adj-skin-title', null, 'Protect skin tone'), h('div.adj-skin-sub', null, 'Turn it on to make skin tones more natural.')),
        h('span.switch', null, h('input', { type: 'checkbox', checked: lut.protectSkin, 'aria-label': 'Protect skin tone', onchange: (e: Event) => setLut((l) => { l.protectSkin = (e.target as HTMLInputElement).checked; }) }), h('i')))),
    checkSection('Adjust', c.adjustOn !== false, (v) => updateClip(c.id, (x) => { x.adjustOn = v; }),
      () => updateClip(c.id, (x) => { x.adjust = defaultAdjust(); x.adjustOn = true; }),
      group('Color'),
      r('Temp', 'temperature', -1, 1, TRACKS.temp),
      r('Tint', 'tint', -1, 1, TRACKS.tint),
      r('Saturation', 'saturation', -1, 1, TRACKS.sat),
      group('Lightness'),
      r('Exposure', 'exposure'),
      r('Contrast', 'contrast'),
      r('Highlight', 'highlight'),
      r('Shadow', 'shadow'),
      r('Whites', 'whites'),
      r('Blacks', 'blacks'),
      r('Brilliance', 'brilliance'),
      group('Effects'),
      r('Sharpen', 'sharpen', 0, 1),
      r('Clarity', 'clarity', 0, 1),
      r('Particles', 'particles', 0, 1),
      r('Fade', 'fade', 0, 1),
      r('Vignette', 'vignette', -1, 1)),
  ].filter(Boolean) as HTMLElement[];
}

// ---- HSL ---------------------------------------------------------------------------

const BANDS = [
  { name: 'Red', hue: 0 }, { name: 'Orange', hue: 30 }, { name: 'Yellow', hue: 60 }, { name: 'Green', hue: 120 },
  { name: 'Cyan', hue: 180 }, { name: 'Blue', hue: 225 }, { name: 'Purple', hue: 270 }, { name: 'Magenta', hue: 315 },
];
const hsl = (hDeg: number, s = 85, l = 55) => `hsl(${hDeg}, ${s}%, ${l}%)`;

function hslTab(c: Clip, rerender: () => void): HTMLElement[] {
  const vals = c.hsl ?? defaultHsl();
  const band = BANDS[hslBand];
  const setVal = (k: number) => live(c.id, (x, v) => { x.hsl = (x.hsl ?? defaultHsl()).map((b) => [...b]); x.hsl[hslBand][k] = v; });
  const hue = setVal(0), sat = setVal(1), bri = setVal(2);
  // Eyedropper: pick a colour anywhere on screen and jump to the closest band.
  const picker = h('button.hsl-picker', {
    type: 'button', title: 'Pick a color', 'aria-label': 'Pick a color',
    onclick: async () => {
      const ED = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
      if (!ED) { toast('Color picking is not supported in this browser', 'error'); return; }
      try {
        const { sRGBHex } = await new ED().open();
        const n = parseInt(sRGBHex.slice(1), 16);
        const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, bl = (n & 255) / 255;
        const mx = Math.max(r, g, bl), d = mx - Math.min(r, g, bl);
        if (d < 0.04) { toast('That color is too grey to pick a band'); return; }
        const hd = (mx === r ? ((g - bl) / d + 6) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4) * 60;
        const dist = (x: number) => Math.abs(((hd - x + 540) % 360) - 180);
        hslBand = BANDS.reduce((best, bd, i) => (dist(bd.hue) < dist(BANDS[best].hue) ? i : best), 0);
        rerender();
      } catch { /* cancelled */ }
    },
  });
  picker.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 5.5 4 4"/><path d="M17.8 2.7a2 2 0 0 1 2.8 2.8L18 8l-2-2z"/><path d="M15.5 7.5 6 17l-2.5 3.5L7 18l9.5-9.5"/></svg>';
  const swatches = h('div.hsl-swatches', null, picker, ...BANDS.map((b, i) => {
    const sw = h(`button.hsl-swatch${i === hslBand ? '.active' : ''}`, {
      type: 'button', title: b.name, 'aria-label': b.name, 'aria-pressed': i === hslBand,
      onclick: () => { hslBand = i; rerender(); },
    });
    sw.style.setProperty('--sw', hsl(b.hue));
    return sw;
  }));
  return [checkSection('Basic', c.hslOn !== false, (v) => updateClip(c.id, (x) => { x.hslOn = v; }),
    () => updateClip(c.id, (x) => { x.hsl = defaultHsl(); }),
    swatches,
    slider('Hue', vals[hslBand][0], -1, 1, 0.01, SIGNED, hue.input, hue.end, 0, `linear-gradient(90deg, ${hsl(band.hue - 45, 75, 58)}, ${hsl(band.hue, 70, 62)} 50%, ${hsl(band.hue + 30, 75, 58)})`),
    slider('Saturation', vals[hslBand][1], -1, 1, 0.01, SIGNED, sat.input, sat.end, 0, `linear-gradient(90deg, #808080, ${hsl(band.hue, 100, 50)})`),
    slider('Brightness', vals[hslBand][2], -1, 1, 0.01, SIGNED, bri.input, bri.end, 0, `linear-gradient(90deg, ${hsl(band.hue, 100, 8)}, ${hsl(band.hue, 25, 55)} 50%, #ffffff)`),
  )];
}

// ---- Curves ------------------------------------------------------------------------

/** Mutates the clip in place during a drag (no inspector rebuild), redrawing the player. */
function liveMutate(clipId: string, fn: (c: Clip) => void) {
  const f = store.findClip(clipId);
  if (!f) return;
  fn(f.clip);
  store.emit('time');
}

const CURVE_DEFS: { key: keyof Omit<Curves, 'enabled'>; name: string; color: string }[] = [
  { key: 'luma', name: 'Luma', color: '#ffffff' },
  { key: 'r', name: 'Red (R)', color: '#ff3b3b' },
  { key: 'g', name: 'Green (G)', color: '#35d44a' },
  { key: 'b', name: 'Blue (B)', color: '#3b82ff' },
];

function curveEditor(c: Clip, key: keyof Omit<Curves, 'enabled'>, color: string) {
  const cv = h('canvas.curve-canvas') as HTMLCanvasElement;
  const pad = 6;
  const getPts = (): CurvePoints => (store.findClip(c.id)?.clip.curves?.[key] ?? identityCurve());
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 300, H = cv.clientHeight || 220;
    cv.width = W * dpr; cv.height = H * dpr;
    const x = cv.getContext('2d')!;
    x.scale(dpr, dpr);
    x.fillStyle = '#08080a'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#26262b'; x.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      x.beginPath(); x.moveTo(Math.round((W * i) / 4) + 0.5, 0); x.lineTo(Math.round((W * i) / 4) + 0.5, H); x.stroke();
      x.beginPath(); x.moveTo(0, Math.round((H * i) / 4) + 0.5); x.lineTo(W, Math.round((H * i) / 4) + 0.5); x.stroke();
    }
    const pts = getPts();
    const f = curveFn(pts);
    const px = (v: number) => pad + v * (W - pad * 2), py = (v: number) => H - pad - v * (H - pad * 2);
    x.strokeStyle = color; x.lineWidth = 1.6;
    x.beginPath();
    for (let i = 0; i <= 200; i++) { const t = i / 200; const X = px(t), Y = py(Math.min(1, Math.max(0, f(t)))); if (i) x.lineTo(X, Y); else x.moveTo(X, Y); }
    x.stroke();
    for (const [a, b] of pts) {
      x.beginPath(); x.arc(px(a), py(b), 5, 0, Math.PI * 2);
      x.fillStyle = '#ffffff'; x.fill();
      x.lineWidth = 2.5; x.strokeStyle = color === '#ffffff' ? '#000000' : color; x.stroke();
    }
  };
  requestAnimationFrame(draw);
  new ResizeObserver(draw).observe(cv);

  const toVal = (e: PointerEvent): [number, number] => {
    const r = cv.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left - pad) / (r.width - pad * 2))), Math.min(1, Math.max(0, 1 - (e.clientY - r.top - pad) / (r.height - pad * 2)))];
  };
  const hitIndex = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    return getPts().findIndex(([a, b]) => Math.hypot(pad + a * (r.width - pad * 2) - (e.clientX - r.left), r.height - pad - b * (r.height - pad * 2) - (e.clientY - r.top)) < 10);
  };
  cv.addEventListener('pointerdown', (e) => {
    store.checkpoint();
    let pts = getPts().map((p) => [...p] as [number, number]);
    let idx = hitIndex(e);
    if (idx < 0) {
      const [vx, vy] = toVal(e);
      pts.push([vx, vy]);
      pts.sort((p, q) => p[0] - q[0]);
      idx = pts.findIndex((p) => p[0] === vx && p[1] === vy);
    }
    const apply = () => liveMutate(c.id, (x) => { x.curves = { ...(x.curves ?? defaultCurves()), [key]: pts.map((p) => [...p]) }; });
    apply(); draw();
    cv.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const [vx, vy] = toVal(ev);
      const last = pts.length - 1;
      // End points stay at the left/right edges; inner points stay between their neighbours.
      const nx = idx === 0 ? 0 : idx === last ? 1 : Math.min(pts[idx + 1][0] - 0.01, Math.max(pts[idx - 1][0] + 0.01, vx));
      pts[idx] = [nx, vy];
      apply(); draw();
    };
    const up = () => {
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      store.normalize();
      store.emit('project');
    };
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    pts = pts.slice();
  });
  cv.addEventListener('dblclick', (e) => {
    const i = hitIndex(e as PointerEvent);
    const pts = getPts();
    if (i <= 0 || i >= pts.length - 1) return;
    updateClip(c.id, (x) => { x.curves = { ...(x.curves ?? defaultCurves()), [key]: pts.filter((_, k) => k !== i) }; });
  });
  return cv;
}

function curvesTab(c: Clip): HTMLElement[] {
  const cur = c.curves ?? defaultCurves();
  return [checkSection('All', cur.enabled, (v) => updateClip(c.id, (x) => { x.curves = { ...(x.curves ?? defaultCurves()), enabled: v }; }),
    () => updateClip(c.id, (x) => { x.curves = defaultCurves(); }),
    ...CURVE_DEFS.map((d) => h('div.curve-block', null,
      h('div.curve-head', null,
        h('span.curve-name', null, h('i.curve-dot', { style: { background: d.color } }), d.name),
        h('button.icon-btn.small', { type: 'button', title: `Reset ${d.name}`, onclick: () => updateClip(c.id, (x) => { x.curves = { ...(x.curves ?? defaultCurves()), [d.key]: identityCurve() }; }) }, icon('reset', 15))),
      curveEditor(c, d.key, d.color))),
    h('p.hint', null, 'Click to add a point, drag to shape the curve, double-click a point to remove it.'),
  )];
}

// ---- Color wheel -------------------------------------------------------------------

// Colour layout as in CapCut / Resolve: vectorscope (YUV) angles, so red sits at the top,
// yellow on the left, green bottom-left, cyan bottom-right, blue on the right.
const EDGE = 2 / 3;
/** Wheel dot (x, y in the unit disc, y up) → RGB offset with no brightness change. */
const dotToRgb = (x: number, y: number): [number, number, number] => {
  const m = Math.hypot(x, y);
  if (m < 1e-6) return [0, 0, 0];
  const r = y / 0.877, b = x / 0.492, g = -(0.299 * r + 0.114 * b) / 0.587;
  const k = (EDGE * Math.min(1, m)) / Math.max(Math.abs(r), Math.abs(g), Math.abs(b));
  return [r * k, g * k, b * k];
};
const rgbToDot = (r: number, g: number, b: number): [number, number] => {
  const peak = Math.max(Math.abs(r), Math.abs(g), Math.abs(b));
  if (peak < 1e-6) return [0, 0];
  const Y = 0.299 * r + 0.587 * g + 0.114 * b;
  const a = Math.atan2(0.877 * (r - Y), 0.492 * (b - Y));
  const m = Math.min(1, peak / EDGE);
  return [Math.cos(a) * m, Math.sin(a) * m];
};
/** Display colour for a canvas angle (radians, clockwise from +x). */
const colourAt = (phi: number, base: number, bright: number) => {
  const rgb = dotToRgb(Math.cos(-phi), Math.sin(-phi));
  // Stretch to a fully saturated colour, then scale its brightness.
  const lo = Math.min(...rgb), hi = Math.max(...rgb);
  const [r, g, b] = rgb.map((v) => Math.round((base + ((v - lo) / (hi - lo || 1)) * (bright - base)) * 255));
  return `rgb(${r}, ${g}, ${b})`;
};

function wheelCtl(c: Clip, key: keyof Omit<ColorWheels, 'enabled' | 'intensity'>, title: string) {
  const size = 176, cx = size / 2, cy = size / 2;
  const R = 64, RING = 11, ARC = R + RING / 2 + 9;
  const inner = R - RING / 2;
  // Side arcs span ±50° around 3 and 9 o'clock; up is +1.
  const SPAN = (50 * Math.PI) / 180;
  const rightAngle = (v: number) => -v * SPAN;
  const leftAngle = (v: number) => Math.PI + v * SPAN;
  let leftActive = false;
  const cv = h('canvas.wheel-canvas', { width: size * 2, height: size * 2, style: { width: `${size}px`, height: `${size}px` } }) as HTMLCanvasElement;
  const get = (): Wheel => (store.findClip(c.id)?.clip.wheels?.[key] ?? [0, 0, 0, 0]);
  const inputs: HTMLInputElement[] = [];
  const conic = (x: CanvasRenderingContext2D, lift: number, gain: number) => {
    const g = x.createConicGradient(0, cx, cy);
    for (let k = 0; k <= 48; k++) g.addColorStop(k / 48, colourAt((k / 48) * Math.PI * 2, lift, gain));
    return g;
  };
  const draw = () => {
    const x = cv.getContext('2d')!;
    x.setTransform(2, 0, 0, 2, 0, 0);
    x.clearRect(0, 0, size, size);
    // Inner disc: colour tint at the edge, dark at the centre.
    x.fillStyle = conic(x, 0.06, 0.36);
    x.beginPath(); x.arc(cx, cy, inner, 0, Math.PI * 2); x.fill();
    const shade = x.createRadialGradient(cx, cy, 0, cx, cy, inner);
    shade.addColorStop(0, 'rgba(14,14,16,0.92)'); shade.addColorStop(0.55, 'rgba(14,14,16,0.55)'); shade.addColorStop(1, 'rgba(14,14,16,0.05)');
    x.fillStyle = shade;
    x.beginPath(); x.arc(cx, cy, inner, 0, Math.PI * 2); x.fill();
    // Tick marks just inside the ring.
    x.strokeStyle = 'rgba(255,255,255,0.14)'; x.lineWidth = 1;
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2, r0 = inner - (k % 6 === 0 ? 6 : 3.5);
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * (inner - 1), cy + Math.sin(a) * (inner - 1)); x.stroke();
    }
    // Hue ring with dark outlines.
    x.strokeStyle = conic(x, 0.12, 0.95); x.lineWidth = RING;
    x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = '#0b0b0d'; x.lineWidth = 2;
    x.beginPath(); x.arc(cx, cy, R + RING / 2 + 1, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.arc(cx, cy, inner - 0.5, 0, Math.PI * 2); x.stroke();
    const w = get();
    const [r, gg, b, l] = w;
    const sat = w[4] ?? 0;
    const tinted = Math.max(Math.abs(r), Math.abs(gg), Math.abs(b)) > 1e-3;
    // Side arcs (CapCut): right = brightness, left = saturation. Each is moved by its
    // triangle; the left one only appears once a colour is picked or it has been changed.
    x.lineCap = 'round'; x.lineWidth = 5;
    const rightG = x.createLinearGradient(0, cy - ARC, 0, cy + ARC);
    rightG.addColorStop(0, '#8d96a6'); rightG.addColorStop(1, '#25272c');
    x.strokeStyle = rightG;
    x.beginPath(); x.arc(cx, cy, ARC, -SPAN, SPAN); x.stroke();
    // Left bar: shown once a colour is picked, after it has been changed, or while dragging it.
    const showLeft = tinted || Math.abs(sat) > 1e-3 || leftActive;
    if (showLeft) {
      const [dx0, dy0] = rgbToDot(r, gg, b);
      const leftG = x.createLinearGradient(0, cy - ARC, 0, cy + ARC);
      leftG.addColorStop(0, tinted ? colourAt(-Math.atan2(dy0, dx0), 0.12, 0.42) : '#55585f');
      leftG.addColorStop(1, '#1d1e22');
      x.strokeStyle = leftG;
      x.beginPath(); x.arc(cx, cy, ARC, Math.PI - SPAN, Math.PI + SPAN); x.stroke();
    }
    x.lineCap = 'butt';
    // Triangles point at the wheel from where each arc's value sits.
    x.fillStyle = '#ffffff';
    const tri = (a: number) => {
      const tip = ARC - 5, base = ARC + 2, half = 0.07;
      x.beginPath();
      x.moveTo(cx + Math.cos(a) * tip, cy + Math.sin(a) * tip);
      x.lineTo(cx + Math.cos(a - half) * base, cy + Math.sin(a - half) * base);
      x.lineTo(cx + Math.cos(a + half) * base, cy + Math.sin(a + half) * base);
      x.closePath(); x.fill();
    };
    tri(rightAngle(l));
    tri(leftAngle(sat));
    // Centre mark once the colour has moved off it.
    const [dx, dy] = rgbToDot(r, gg, b);
    if (tinted) {
      x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(cx - 4, cy); x.lineTo(cx + 4, cy); x.moveTo(cx, cy - 4); x.lineTo(cx, cy + 4); x.stroke();
    }
    // Colour dot.
    x.fillStyle = '#e8e8ea'; x.strokeStyle = '#000'; x.lineWidth = 1.5;
    x.beginPath(); x.arc(cx + dx * (inner - 6), cy - dy * (inner - 6), 5, 0, Math.PI * 2); x.fill(); x.stroke();
    [r, gg, b].forEach((v, i) => { if (inputs[i] && document.activeElement !== inputs[i]) inputs[i].value = v.toFixed(2); });
  };
  const setWheel = (w: Wheel) => liveMutate(c.id, (x) => { x.wheels = { ...(x.wheels ?? defaultWheels()), [key]: w }; });
  /** Which handle a point (relative to the centre) grabs: a triangle, the colour disc, or nothing. */
  const handleAt = (px: number, py: number): 'right' | 'left' | 'dot' | null => {
    const w = get();
    const near = (a: number) => Math.hypot(px - Math.cos(a) * (ARC - 1), py - Math.sin(a) * (ARC - 1)) < 13;
    if (near(rightAngle(w[3]))) return 'right';
    if (near(leftAngle(w[4] ?? 0))) return 'left';
    return Math.hypot(px, py) <= R + RING / 2 ? 'dot' : null;
  };
  cv.addEventListener('pointerdown', (e) => {
    const rect = cv.getBoundingClientRect();
    const local = (ev: PointerEvent) => [ev.clientX - rect.left - cx, ev.clientY - rect.top - cy];
    const [sx, sy] = local(e);
    const grab = handleAt(sx, sy);
    if (!grab) return;
    store.checkpoint();
    cv.setPointerCapture(e.pointerId);
    leftActive = grab === 'left';
    const move = (ev: PointerEvent) => {
      const [px, py] = local(ev);
      const w = [...get()] as Wheel;
      const ang = Math.atan2(py, px);
      if (grab === 'right') {
        w[3] = Math.max(-1, Math.min(1, -ang / SPAN));
      } else if (grab === 'left') {
        const rel = ang < 0 ? ang + Math.PI * 2 : ang;
        w[4] = Math.max(-1, Math.min(1, (rel - Math.PI) / SPAN));
      } else {
        let vx = px / (inner - 6), vy = -py / (inner - 6);
        const m = Math.hypot(vx, vy);
        if (m > 1) { vx /= m; vy /= m; }
        const [nr, ng, nb] = dotToRgb(vx, vy);
        w[0] = nr; w[1] = ng; w[2] = nb;
      }
      setWheel(w);
      draw();
    };
    move(e);
    const up = () => {
      leftActive = false;
      cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up);
      store.emit('project');
    };
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
  });
  cv.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const rect = cv.getBoundingClientRect();
    const g = handleAt(e.clientX - rect.left - cx, e.clientY - rect.top - cy);
    cv.style.cursor = g === 'right' || g === 'left' ? 'ns-resize' : g === 'dot' ? 'pointer' : 'default';
  });
  cv.addEventListener('dblclick', () => { updateClip(c.id, (x) => { x.wheels = { ...(x.wheels ?? defaultWheels()), [key]: [0, 0, 0, 0] }; }); });
  const nums = h('div.wheel-nums', null, ['#ff1f1f', '#14d41a', '#1530ff'].map((col, i) => {
    const inp = h('input.wheel-num', { type: 'text', inputmode: 'decimal', 'aria-label': ['Red', 'Green', 'Blue'][i] }) as HTMLInputElement;
    inp.addEventListener('change', () => {
      const v = Math.max(-1, Math.min(1, parseFloat(inp.value) || 0));
      updateClip(c.id, (x) => { const w = [...(x.wheels?.[key] ?? [0, 0, 0, 0])] as Wheel; w[i] = v; x.wheels = { ...(x.wheels ?? defaultWheels()), [key]: w }; });
    });
    inputs[i] = inp;
    return h('div.wheel-num-wrap', null, h('i', { style: { background: col } }), inp);
  }));
  requestAnimationFrame(draw);
  return h('div.wheel', null,
    h('div.wheel-head', null, h('span', null, title),
      h('button.icon-btn.small', { type: 'button', title: `Reset ${title}`, onclick: () => updateClip(c.id, (x) => { x.wheels = { ...(x.wheels ?? defaultWheels()), [key]: [0, 0, 0, 0] }; }) }, icon('reset', 14))),
    cv, nums);
}

function wheelsTab(c: Clip): HTMLElement[] {
  const w = c.wheels ?? defaultWheels();
  const amt = live(c.id, (x, v) => { x.wheels = { ...(x.wheels ?? defaultWheels()), intensity: v }; });
  return [checkSection('Color wheel', w.enabled, (v) => updateClip(c.id, (x) => { x.wheels = { ...(x.wheels ?? defaultWheels()), enabled: v }; }),
    () => updateClip(c.id, (x) => { x.wheels = defaultWheels(); }),
    dropdown('primary', [{ id: 'primary', name: 'Primary' }], () => {}),
    slider('Intensity', w.intensity, 0, 1, 0.01, PCT, amt.input, amt.end, 1),
    h('div.wheel-grid', null,
      wheelCtl(c, 'shadows', 'Shadows'), wheelCtl(c, 'mid', 'Middle grey'),
      wheelCtl(c, 'high', 'Tint'), wheelCtl(c, 'offset', 'Offset')),
    h('p.hint', null, 'Drag the dot to tint, drag the arc on the right for brightness. Double-click a wheel to reset it.'),
  )];
}

// ---- Mask --------------------------------------------------------------------------

const SHAPES: { id: MaskShape; name: string; svg: string }[] = [
  { id: 'split', name: 'Split', svg: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 12h18"/>' },
  { id: 'filmstrip', name: 'Filmstrip', svg: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 8h18M3 16h18"/>' },
  { id: 'circle', name: 'Circle', svg: '<rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="12" cy="12" r="5"/>' },
  { id: 'rectangle', name: 'Rectangle', svg: '<rect x="3" y="3" width="18" height="18" rx="1"/><rect x="7" y="7" width="10" height="10"/>' },
  { id: 'star', name: 'Stars', svg: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="m12 6.5 1.7 3.5 3.8.5-2.8 2.6.7 3.8-3.4-1.9-3.4 1.9.7-3.8-2.8-2.6 3.8-.5z"/>' },
  { id: 'heart', name: 'Heart', svg: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M12 17s-5-3-5-6.2A2.6 2.6 0 0 1 12 9.5a2.6 2.6 0 0 1 5 1.3C17 14 12 17 12 17z"/>' },
];

function maskTab(c: Clip): HTMLElement[] {
  const m = c.adjMask;
  const setM = (fn: (x: AdjustMask) => void) => updateClip(c.id, (x) => { x.adjMask = { ...(x.adjMask ?? defaultMask()) }; fn(x.adjMask); });
  const lm = (k: keyof AdjustMask) => live(c.id, (x, v) => { x.adjMask = { ...(x.adjMask ?? defaultMask()), [k]: v }; });
  const grid = h('div.mask-grid', null, SHAPES.map((s) => {
    const btn = h(`button.mask-shape${m?.type === s.id && m.enabled ? '.active' : ''}`, { type: 'button', title: s.name, onclick: () => setM((x) => { x.type = s.id; x.enabled = true; }) });
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">${s.svg}</svg>`;
    return h('div.mask-item', null, btn, h('span', null, s.name));
  }));
  const px = lm('x'), py = lm('y'), pw = lm('w'), ph = lm('h'), pr = lm('rotation'), pf = lm('feather'), pc = lm('round');
  return [checkSection('Mask', !!m?.enabled, (v) => setM((x) => { x.enabled = v; }), m ? () => updateClip(c.id, (x) => { x.adjMask = undefined; }) : null,
    m ? null : h('button.adj-add-mask', { type: 'button', onclick: () => setM((x) => { x.enabled = true; }) }, icon('plus', 14), 'Add mask'),
    grid,
    m ? slider('Position X', m.x, 0, 1, 0.005, PCT, px.input, px.end, 0.5) : null,
    m ? slider('Position Y', m.y, 0, 1, 0.005, PCT, py.input, py.end, 0.5) : null,
    m && m.type !== 'split' ? slider('Width', m.w, 0.02, 2, 0.01, PCT, pw.input, pw.end, 0.5) : null,
    m ? slider(m.type === 'split' || m.type === 'filmstrip' ? 'Size' : 'Height', m.h, 0.02, 2, 0.01, PCT, ph.input, ph.end, 0.5) : null,
    m ? slider('Rotate', m.rotation, -180, 180, 1, { show: (v) => String(Math.round(v)), parse: parseFloat, unit: '°' }, pr.input, pr.end, 0) : null,
    m ? slider('Feather', m.feather, 0, 1, 0.01, PCT, pf.input, pf.end, 0.1) : null,
    m?.type === 'rectangle' ? slider('Round corners', m.round ?? 0, 0, 1, 0.01, PCT, pc.input, pc.end, 0) : null,
    m ? row('Invert', h('label.switch', null, h('input', { type: 'checkbox', checked: m.invert, 'aria-label': 'Invert mask', onchange: (e: Event) => setM((x) => { x.invert = (e.target as HTMLInputElement).checked; }) }), h('i'))) : null,
    h('p.hint', null, 'The adjustments only apply inside the mask. Drag the yellow frame on the player to move it; use its handles to rotate, resize and feather.'),
  )];
}

// ---- presets / apply to all ---------------------------------------------------------

interface Preset { name: string; data: Partial<Clip> }
const PRESET_KEY = 'kinora.adjustPresets';
const loadPresets = (): Preset[] => { try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]'); } catch { return []; } };
const gradeOf = (c: Clip): Partial<Clip> => structuredClone({
  adjust: c.adjust, adjustOn: c.adjustOn, lut: c.lut, hsl: c.hsl, hslOn: c.hslOn, curves: c.curves, wheels: c.wheels, adjMask: c.adjMask,
});

export function adjustFooter(c: Clip) {
  return h('div.adj-foot', null,
    h('button.adj-btn', {
      type: 'button',
      onclick: () => {
        const g = gradeOf(c);
        let n = 0;
        store.commit((p) => {
          for (const t of p.tracks) for (const x of t.clips) {
            if (x.id === c.id || (x.type !== 'video' && x.type !== 'image')) continue;
            Object.assign(x, structuredClone(g));
            n++;
          }
        });
        toast(n ? `Adjustments applied to ${n} more clip${n > 1 ? 's' : ''}` : 'No other video or photo clips to apply to');
      },
    }, 'Apply to all'),
    h('button.adj-btn.primary', {
      type: 'button',
      onclick: () => {
        const list = loadPresets();
        const name = `Preset ${list.length + 1}`;
        list.push({ name, data: gradeOf(c) });
        try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); } catch { toast('Could not save the preset', 'error'); return; }
        toast(`Saved “${name}”. Apply it from Adjust › Basic › Presets.`, 'ok');
        store.emit('view');
      },
    }, 'Save as preset'));
}

export function adjustContent(c: Clip, sub: string, rerender: () => void): HTMLElement[] {
  switch (sub) {
    case 'HSL': return hslTab(c, rerender);
    case 'Curves': return curvesTab(c);
    case 'Color wheel': return wheelsTab(c);
    case 'Mask': return maskTab(c);
    default: return basic(c);
  }
}
