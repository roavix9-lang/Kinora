import { CurvePoints, Curves } from '../types';

/** Monotone cubic (Fritsch–Carlson) interpolation: smooth, never overshoots between points. */
export function curveFn(points: CurvePoints): (x: number) => number {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  if (n < 2) return (x) => x;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

const isIdentity = (p: CurvePoints) => p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1;
export const curvesNeutral = (c?: Curves) => !c || !c.enabled || [c.luma, c.r, c.g, c.b].every(isIdentity);

/** 256×1 RGBA8 lookup: R/G/B = channel curves, A = luma (master) curve. */
export function bakeCurves(c: Curves): Uint8Array {
  const fr = curveFn(c.r), fg = curveFn(c.g), fb = curveFn(c.b), fl = curveFn(c.luma);
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    out[i * 4] = q(fr(x));
    out[i * 4 + 1] = q(fg(x));
    out[i * 4 + 2] = q(fb(x));
    out[i * 4 + 3] = q(fl(x));
  }
  return out;
}
