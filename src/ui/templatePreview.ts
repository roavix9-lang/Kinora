import { Compositor } from '../engine/compositor';
import { buildLayers } from '../engine/scene';
import { buildTemplateProject, TemplateDef, templateDuration } from '../templates';
import { loadSamples, onSamplesReady, sampleMedia, samplesReady } from '../engine/sampleMedia';
import { Project } from '../types';

// Template thumbnails and live previews, rendered with the real compositor using the two
// bundled sample photos (registered as hidden media so the renderer can find them).

/** Template filled with the sample photos (alternating), for previews. */
function sampleProject(t: TemplateDef): Project | null {
  if (!samplesReady()) { void loadSamples(); return null; }
  return buildTemplateProject(t, t.slots.map((_, i) => sampleMedia(i)));
}

const renderers = new Map<string, { comp: Compositor; canvas: HTMLCanvasElement }>();

/** Preview size for a template's ratio, ~`long` px on the long edge. */
export function previewSize(t: TemplateDef, long = 384): [number, number] {
  const [a, b] = t.ratio.split(':').map(Number);
  const r = a / b;
  return r >= 1 ? [long, Math.round(long / r)] : [Math.round(long * r), long];
}

function renderer(w: number, h: number) {
  const key = `${w}x${h}`;
  let r = renderers.get(key);
  if (!r) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    r = { comp: new Compositor(canvas), canvas };
    renderers.set(key, r);
  }
  return r;
}

const projects = new Map<string, Project>();
function projectFor(t: TemplateDef) {
  let p = projects.get(t.id);
  if (!p) {
    const built = sampleProject(t);
    if (!built) return null;
    p = built;
    projects.set(t.id, p);
  }
  return p;
}

function drawFrame(t: TemplateDef, time: number, w: number, h: number): HTMLCanvasElement | null {
  const p = projectFor(t);
  if (!p) return null;
  const { comp, canvas } = renderer(w, h);
  const { layers, frames } = buildLayers(comp, p, time, h / p.height, () => null);
  comp.render(layers, p.width, p.height, p.background);
  frames.forEach((f) => f.close());
  return canvas;
}

const stills = new Map<string, string>();

/** Cover image (a frame ~1 s in, where the title shows). Null until the photos load. */
export function templateStill(t: TemplateDef): string | null {
  const hit = stills.get(t.id);
  if (hit) return hit;
  const [w, h] = previewSize(t);
  const c = drawFrame(t, Math.min(1.1, templateDuration(t) * 0.3), w, h);
  if (!c) return null;
  const url = c.toDataURL('image/jpeg', 0.85);
  stills.set(t.id, url);
  return url;
}

/** Plays the template in a loop into `target`; returns a stop function. */
export function playTemplate(target: HTMLCanvasElement, t: TemplateDef): () => void {
  const ctx = target.getContext('2d')!;
  const total = templateDuration(t);
  const [w, h] = previewSize(t);
  const t0 = performance.now();
  let raf = 0;
  const tick = () => {
    const time = ((performance.now() - t0) / 1000) % total;
    const c = drawFrame(t, time, w, h);
    if (c) ctx.drawImage(c, 0, 0, target.width, target.height);
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(raf);
}

/** Drop cached covers (e.g. after web fonts finish loading). */
export function refreshTemplateStills() { stills.clear(); }

export { loadSamples, onSamplesReady };
