import { Clip, MediaItem, Project, Transition } from '../types';
import { ANIMS, AnimState, sampleAnim } from './anims';
import { stickerSize } from './sticker';
import { templateDef } from './templateClips';
import { renderText } from './text';

export interface LayerGeom {
  /** Centre, in project pixels (origin top-left). */
  cx: number;
  cy: number;
  /** Displayed size in project pixels (after scale). */
  w: number;
  h: number;
  /** Radians, clockwise. */
  rotation: number;
  opacity: number;
  flipX: boolean;
  /** 0 = none, 1 = reveal left→right, 2 = reveal right→left. */
  wipeMode: number;
  wipe: number;
  blur: number;
  /** Seconds since clip start; drives time-based effects deterministically. */
  local: number;
}

const ease = (p: number) => 1 - Math.pow(1 - p, 3);

/** Intrinsic (unscaled) size of a clip in project pixels. */
export function baseSize(clip: Clip, media: MediaItem | undefined, p: Project): [number, number] {
  if (clip.type === 'text' && clip.text) {
    const px = clip.text.size * (p.height / 1080);
    const r = renderText(clip.text, px);
    return [r.width, r.height];
  }
  if (clip.type === 'sticker' && clip.sticker) return stickerSize(clip.sticker, p.height);
  if (clip.type === 'template') {
    // Fit the template's own shape (e.g. 9:16) inside the canvas.
    const t = templateDef(clip);
    const [a, b] = (t?.ratio ?? '16:9').split(':').map(Number);
    const s = Math.min(p.width / a, p.height / b);
    return [a * s, b * s];
  }
  if (!media || !media.width) return [p.width, p.height];
  const rotated = media.rotation === 90 || media.rotation === 270;
  const mw = rotated ? media.height : media.width;
  const mh = rotated ? media.width : media.height;
  const s = Math.min(p.width / mw, p.height / mh);
  return [mw * s, mh * s];
}

function applyTransition(g: LayerGeom, tr: Transition, prog: number, isOut: boolean, p: Project) {
  // prog: 0 = transition fully applied, 1 = done (clip fully visible).
  const e = ease(prog);
  const dir = isOut ? -1 : 1;
  switch (tr.type) {
    case 'fade': g.opacity *= prog; break;
    case 'zoom-in': g.w *= 0.3 + 0.7 * e; g.h *= 0.3 + 0.7 * e; g.opacity *= prog; break;
    case 'zoom-out': g.w *= 1.6 - 0.6 * e; g.h *= 1.6 - 0.6 * e; g.opacity *= prog; break;
    case 'slide-left': g.cx += dir * (1 - e) * p.width; break;
    case 'slide-right': g.cx -= dir * (1 - e) * p.width; break;
    case 'slide-up': g.cy += dir * (1 - e) * p.height; break;
    case 'slide-down': g.cy -= dir * (1 - e) * p.height; break;
    case 'wipe-left': g.wipeMode = isOut ? 1 : 2; g.wipe = e; break;
    case 'wipe-right': g.wipeMode = isOut ? 2 : 1; g.wipe = e; break;
    case 'blur': g.blur += (1 - e) * 1.5; g.opacity *= Math.min(1, prog * 1.5); break;
    case 'spin': g.rotation += dir * (1 - e) * Math.PI; g.w *= 0.2 + 0.8 * e; g.h *= 0.2 + 0.8 * e; g.opacity *= prog; break;
  }
}

/** Applies a library animation's state (see anims.ts) on top of the resting geometry. */
function applyAnim(g: LayerGeom, a: AnimState, p: Project) {
  g.w *= a.s * a.sx;
  g.h *= a.s * a.sy;
  g.cx += a.x * p.width;
  g.cy += a.y * p.height;
  g.rotation += (a.r * Math.PI) / 180;
  g.opacity *= Math.max(0, Math.min(1, a.o));
  g.blur += Math.max(0, a.b);
}

export function layerGeom(clip: Clip, media: MediaItem | undefined, p: Project, t: number, withAnimation = true): LayerGeom {
  const [bw, bh] = baseSize(clip, media, p);
  const tf = clip.transform;
  const local = t - clip.start;
  const g: LayerGeom = {
    cx: p.width / 2 + tf.x * p.width,
    cy: p.height / 2 + tf.y * p.height,
    w: bw * tf.scale,
    h: bh * tf.scale,
    rotation: (tf.rotation * Math.PI) / 180,
    opacity: tf.opacity,
    flipX: tf.flipX,
    wipeMode: 0,
    wipe: 1,
    blur: 0,
    local,
  };
  if (!withAnimation) return g;

  const ti = clip.transitionIn, to = clip.transitionOut;
  if (ti.type !== 'none' && ti.duration > 0 && local < ti.duration) {
    const lib = ANIMS.get(ti.type);
    if (lib) applyAnim(g, sampleAnim(lib, Math.max(0, local / ti.duration)), p);
    else applyTransition(g, ti, Math.max(0, local / ti.duration), false, p);
  }
  const remain = clip.duration - local;
  if (to.type !== 'none' && to.duration > 0 && remain < to.duration) {
    const lib = ANIMS.get(to.type);
    if (lib) applyAnim(g, sampleAnim(lib, 1 - Math.max(0, remain / to.duration)), p);
    else applyTransition(g, to, Math.max(0, remain / to.duration), true, p);
  }
  const co = clip.combo;
  const combo = co && co.type !== 'none' && co.duration > 0 ? ANIMS.get(co.type) : undefined;
  if (combo && local >= 0) {
    const prog = combo.loop ? (local % co!.duration) / co!.duration : Math.min(1, local / co!.duration);
    applyAnim(g, sampleAnim(combo, prog), p);
  }

  const amt = clip.effect.intensity;
  if (clip.effect.id === 'shake') {
    g.cx += Math.sin(local * 47.3) * Math.cos(local * 31.1) * 0.015 * amt * p.width;
    g.cy += Math.cos(local * 53.7) * Math.sin(local * 29.3) * 0.015 * amt * p.height;
  } else if (clip.effect.id === 'zoom-pulse') {
    const k = 1 + 0.06 * amt * (0.5 + 0.5 * Math.sin(local * Math.PI * 2 * 1.5));
    g.w *= k; g.h *= k;
  }
  return g;
}

/** Audio gain envelope at timeline time t (volume × fades). */
export function audioGain(clip: Clip, t: number): number {
  if (clip.muted) return 0;
  const local = t - clip.start;
  let g = clip.volume;
  if (clip.fadeIn > 0 && local < clip.fadeIn) g *= Math.max(0, local / clip.fadeIn);
  const remain = clip.duration - local;
  if (clip.fadeOut > 0 && remain < clip.fadeOut) g *= Math.max(0, remain / clip.fadeOut);
  return g;
}
