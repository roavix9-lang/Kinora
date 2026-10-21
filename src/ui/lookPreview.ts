import { allEffects } from '../catalog';
import { Compositor } from '../engine/compositor';
import { layerGeom } from '../engine/layout';
import { makeClip, Project } from '../types';
import { SAMPLE_H, SAMPLE_W, samplePair } from './sampleImages';

// Filter / effect thumbnails rendered through the real compositor, so a tile looks
// exactly like the result on the timeline.

let comp: Compositor | null = null;
let canvas: HTMLCanvasElement | null = null;
let sampleKey = '';
const cache = new Map<string, string>();

function renderer() {
  if (!comp) {
    canvas = document.createElement('canvas');
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    comp = new Compositor(canvas);
  }
  return comp;
}

/** Data URL of the sample picture with a filter or effect applied (cached). */
export function lookPreview(kind: 'filter' | 'effect', id: string): string {
  const pair = samplePair();
  if (pair.key !== sampleKey) { sampleKey = pair.key; cache.clear(); }
  const key = `${kind}|${id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = renderer();
  const clip = makeClip('image', { id: 'preview' });
  if (kind === 'filter') clip.filter = { id, intensity: 1 };
  else clip.effect = { id, intensity: 0.8 };
  const geom = {
    cx: SAMPLE_W / 2, cy: SAMPLE_H / 2, w: SAMPLE_W, h: SAMPLE_H, rotation: 0, opacity: 1,
    flipX: false, wipeMode: 0, wipe: 1, blur: 0, local: 0.35,
  };
  c.render([{ id: 'preview', source: pair.from, sourceKey: pair.key, texW: SAMPLE_W, texH: SAMPLE_H, rotation: 0, geom, clip }], SAMPLE_W, SAMPLE_H, '#000000');
  const url = canvas!.toDataURL('image/jpeg', 0.85);
  cache.set(key, url);
  return url;
}

const MOVING = new Set(allEffects().filter((e) => e.moving).map((e) => e.id));

/** Plays an effect live on the sample photo into `target` while hovered; returns a stop function. */
export function animateEffect(target: HTMLCanvasElement, id: string): () => void {
  const c = renderer();
  const pair = samplePair();
  const clip = makeClip('image', { id: 'preview', duration: 1e9 });
  clip.effect = { id, intensity: 0.8 };
  // Minimal project so layerGeom applies motion effects (shake, zoom pulse) exactly as on the timeline.
  const proj = { width: SAMPLE_W, height: SAMPLE_H } as Project;
  const ctx = target.getContext('2d')!;
  const t0 = performance.now();
  let raf = 0;
  const tick = () => {
    const t = (performance.now() - t0) / 1000;
    // Static effects ease in and out so the change is visible; moving ones run at full strength.
    if (!MOVING.has(id)) clip.effect.intensity = 0.9 * (0.5 - 0.5 * Math.cos(t * 2.4));
    const geom = layerGeom(clip, undefined, proj, t);
    c.render([{ id: 'preview', source: pair.from, sourceKey: pair.key, texW: SAMPLE_W, texH: SAMPLE_H, rotation: 0, geom, clip }], SAMPLE_W, SAMPLE_H, '#000000');
    ctx.drawImage(canvas!, 0, 0, target.width, target.height);
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(raf);
}
