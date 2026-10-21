import { newProject, sizeFor, store } from './store';
import { defaultText, makeClip, MediaItem, Project, TextStyle, uid } from './types';

// Built-in templates: a fixed edit (slot lengths, transitions, effects, a grade, titles,
// stickers) that the user fills with their own clips. Using one opens a new timeline.

export interface TemplateSlot {
  dur: number;
  /** Clip effect (effects library / basic effects). */
  effect?: string;
  /** Intro animation for this clip (fade, zoom-in, slide-left, …). */
  anim?: string;
  /** GL transition into this slot (overrides the template default). */
  transition?: string;
}

export interface TemplateText {
  start: number;
  dur: number;
  content: string;
  style: Partial<TextStyle>;
  y?: number;
  anim?: string;
  animOut?: string;
}

export interface TemplateSticker { start: number; dur: number; id: string; color?: string; x: number; y: number; scale: number }

export interface TemplateDef {
  id: string;
  name: string;
  category: string;
  ratio: string;
  featured?: boolean;
  slots: TemplateSlot[];
  transition?: string;
  transitionDur?: number;
  filter?: string;
  filterAmt?: number;
  /** Effect layer over the whole edit (or a time range). */
  effectLayer?: { id: string; amount?: number; start?: number; dur?: number };
  texts?: TemplateText[];
  stickers?: TemplateSticker[];
}

export const TEMPLATE_CATEGORIES = ['Vlog', 'Travel', 'Trending', 'Celebration', 'Fitness', 'Food', 'Retro', 'Cinematic', 'Love', 'Business'];


// The template library is served from R2 (see src/engine/assets.ts); downloaded templates register here.
export const TEMPLATES: TemplateDef[] = [];

export function registerTemplate(def: TemplateDef) {
  const at = TEMPLATES.findIndex((t) => t.id === def.id);
  if (at >= 0) TEMPLATES[at] = def; else TEMPLATES.push(def);
}

export const templateDuration = (t: TemplateDef) => t.slots.reduce((n, s) => n + s.dur, 0);

/** Scale that makes media fill (cover) the canvas instead of fitting inside it. */
function coverScale(m: MediaItem, p: Project) {
  if (!m.width || !m.height) return 1;
  const rotated = m.rotation % 180 !== 0;
  const mw = rotated ? m.height : m.width, mh = rotated ? m.width : m.height;
  return Math.max(p.width / mw, p.height / mh) / Math.min(p.width / mw, p.height / mh);
}

/** Builds a timeline from a template and one media item per slot. */
export function buildTemplateProject(t: TemplateDef, media: (MediaItem | undefined)[]): Project {
  const p = newProject();
  p.name = t.name;
  [p.width, p.height] = sizeFor(t.ratio, 1080);
  p.ratio = t.ratio;
  p.resolution = 1080;
  const main = p.tracks.find((tr) => tr.main)!;
  let at = 0;
  let prevDur = 0;
  t.slots.forEach((slot, i) => {
    const m = media[i];
    if (!m) return;
    const isVideo = m.kind === 'video';
    const dur = isVideo ? Math.min(slot.dur, m.duration) : slot.dur;
    const clip = makeClip(isVideo ? 'video' : 'image', { mediaId: m.id, name: m.name, start: at, duration: dur });
    clip.transform.scale = coverScale(m, p);
    if (slot.effect) clip.effect = { id: slot.effect, intensity: 0.7 };
    if (slot.anim) clip.transitionIn = { type: slot.anim, duration: Math.min(0.5, dur / 2) };
    const tr = slot.transition ?? t.transition;
    if (i > 0 && tr && main.clips.length) clip.crossIn = { type: tr, duration: Math.min(t.transitionDur ?? 0.5, dur * 0.8, prevDur * 0.8) };
    main.clips.push(clip);
    at += dur;
    prevDur = dur;
  });
  const total = at;
  if (!total) return p;

  const fxTrack = () => {
    const tr = { id: uid('trk'), kind: 'effect' as const, clips: [] as ReturnType<typeof makeClip>[], muted: false, hidden: false, locked: false };
    p.tracks.unshift(tr);
    return tr;
  };
  if (t.filter) {
    const c = makeClip('filter', { name: 'Filter', start: 0, duration: total });
    c.filter = { id: t.filter, intensity: t.filterAmt ?? 1 };
    fxTrack().clips.push(c);
  }
  if (t.effectLayer) {
    const start = Math.min(t.effectLayer.start ?? 0, total - 0.1);
    const c = makeClip('effect', { name: 'Effect', start, duration: Math.min(t.effectLayer.dur ?? total, total - start) });
    c.effect = { id: t.effectLayer.id, intensity: t.effectLayer.amount ?? 0.7 };
    fxTrack().clips.push(c);
  }
  for (const tx of t.texts ?? []) {
    if (tx.start >= total) continue;
    const c = makeClip('text', {
      name: tx.content.split('\n')[0], start: tx.start, duration: Math.min(tx.dur, total - tx.start),
      text: defaultText({ ...tx.style, content: tx.content }),
    });
    c.transform.y = tx.y ?? 0;
    if (tx.anim) c.transitionIn = { type: tx.anim, duration: 0.5 };
    if (tx.animOut) c.transitionOut = { type: tx.animOut, duration: 0.4 };
    store.placeClip(p, c);
  }
  for (const st of t.stickers ?? []) {
    if (st.start >= total) continue;
    const c = makeClip('sticker', { name: 'Sticker', start: st.start, duration: Math.min(st.dur, total - st.start), sticker: { id: st.id, color: st.color ?? '#ffffff' } });
    Object.assign(c.transform, { x: st.x, y: st.y, scale: st.scale });
    c.transitionIn = { type: 'zoom-in', duration: 0.4 };
    store.placeClip(p, c);
  }
  // Keep the expected visual order (text above effects above video).
  const rank = (k: string) => (k === 'text' ? 0 : k === 'effect' ? 1 : k === 'video' ? 2 : 3);
  p.tracks.sort((a, b) => rank(a.kind) - rank(b.kind));
  return p;
}
