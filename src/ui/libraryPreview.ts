import { addLookLayer, addSticker, addTemplateToTimeline, addText, applyCrossTransition } from '../actions';
import { TEXT_PRESETS } from '../catalog';
import { Player } from '../engine/player';
import { addTemplateMusic, loadSamples, loadTemplateMedia, loadTemplateSamples, sampleMedia, slotSample } from '../engine/sampleMedia';
import { STICKERS, StickerDef } from '../stickers';
import { newProject, store } from '../store';
import { buildTemplateProject, templateDuration, TEMPLATES, TemplateDef } from '../templates';
import { Clip, defaultText, makeClip, MediaItem, Project, TextStyle } from '../types';

// Library preview, as in CapCut: clicking an item in the left panel shows it in the player
// without adding it to the timeline. The + button or dragging it to the timeline adds it.
// Clicking the timeline (tracks or ruler) goes back to it; playback carries on either way
// until the user pauses or plays something else.

let player: Player | null = null;

export function initLibraryPreview(p: Player) {
  player = p;
  // The library re-renders often (e.g. “Added” badges); keep the highlight on the right item.
  let queued = false;
  new MutationObserver(() => {
    if (queued || !store.preview) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; markActive(); });
  }).observe(document.querySelector('.left-panel') ?? document.body, { childList: true, subtree: true });
  document.addEventListener('pointerdown', (e) => {
    if (!store.preview) return;
    // Toolbar buttons, the inspector etc. leave the preview alone (and playing).
    if ((e.target as HTMLElement).closest('.tl-body')) leavePreview(true);
  }, true);
  // Anything added to the timeline ends the preview, so the player shows the result.
  let clips = clipCount();
  store.on('project', () => {
    const n = clipCount();
    if (n > clips) leavePreview(true);
    clips = n;
  });
}

const clipCount = () => store.project.tracks.reduce((n, t) => n + t.clips.length, 0);

/** Back to the timeline; `keepPlaying` continues playback there if the preview was playing. */
function leavePreview(keepPlaying = false) {
  if (!store.preview || !player) return;
  const was = store.playing;
  player.pause();
  store.clearPreview();
  markActive(null);
  if (keepPlaying && was) void player.play();
}

/** Highlights the library item being previewed (items carry their preview key in data-pkey). */
function markActive(_el?: HTMLElement | null) {
  const key = store.preview?.key;
  document.querySelectorAll<HTMLElement>('.lp-content [data-pkey]').forEach((x) => x.classList.toggle('previewing', x.dataset.pkey === key));
}

/** Shows `project` in the player; `from`/`to` bound what plays (and autoplay plays it once). */
function open(key: string, project: Project, el: HTMLElement | null, opts: { from?: number; to?: number; autoplay?: boolean } = {}) {
  if (!player) return;
  player.pause();
  store.setPreview(key, project, opts.from ?? 0, opts.to ?? null);
  markActive(el);
  if (opts.autoplay) player.playPreview(opts.from ?? 0, opts.to);
}

/** Empty project with the timeline's canvas settings. */
function base(): Project {
  const p = newProject();
  const src = store.project;
  Object.assign(p, { width: src.width, height: src.height, fps: src.fps, ratio: src.ratio, background: src.background });
  return p;
}

const timelineHasVisuals = () => store.project.tracks.some((t) => t.kind !== 'audio' && t.clips.length);

/**
 * Overlay items (text, stickers, effects, filters) preview on top of your own video at the
 * playhead, like CapCut; with an empty timeline they play on a blank canvas.
 */
function overlay(key: string, clip: Clip, el: HTMLElement | null) {
  const DUR = 3;
  let p: Project, from = 0;
  if (timelineHasVisuals()) {
    p = structuredClone(store.project);
    from = store.currentTime;
  } else p = base();
  clip.start = from;
  clip.duration = DUR;
  store.placeClip(p, clip);
  open(key, p, el, { from, to: from + DUR, autoplay: true });
}

export function previewMedia(m: MediaItem, el: HTMLElement) {
  if (m.status !== 'ready') return;
  const p = base();
  // An empty "Original" canvas takes the media's own shape.
  if (m.kind !== 'audio' && !timelineHasVisuals() && m.width && m.height) {
    const s = Math.min(1, 1920 / Math.max(m.width, m.height));
    p.width = Math.round((m.width * s) / 2) * 2;
    p.height = Math.round((m.height * s) / 2) * 2;
  }
  const type = m.kind === 'image' ? 'image' : m.kind === 'audio' ? 'audio' : 'video';
  const clip = makeClip(type, { mediaId: m.id, name: m.name, duration: m.duration, in: 0, start: 0 });
  store.placeClip(p, clip);
  open(`media:${m.id}`, p, el, { autoplay: true });
}

export function previewText(style: Partial<TextStyle>, name: string, el: HTMLElement) {
  overlay(`text:${name}`, makeClip('text', { name, text: defaultText(style) }), el);
}

export function previewSticker(def: StickerDef, el: HTMLElement) {
  const clip = makeClip('sticker', { name: def.name, sticker: { id: def.id, color: def.color ?? '#ffffff' } });
  clip.transform.scale = 0.8;
  overlay(`sticker:${def.id}`, clip, el);
}

export async function previewLook(type: 'effect' | 'filter', id: string, name: string, el: HTMLElement) {
  const clip = makeClip(type, { name });
  clip[type] = { id, intensity: type === 'effect' ? 0.6 : 1 };
  if (timelineHasVisuals()) { overlay(`${type}:${id}`, clip, el); return; }
  // Nothing to apply it to yet: show it on a sample photo.
  await loadSamples();
  const m = sampleMedia(0);
  if (!m) return;
  const p = base();
  store.placeClip(p, makeClip('image', { mediaId: m.id, name: m.name, start: 0, duration: 3 }));
  clip.start = 0; clip.duration = 3;
  store.placeClip(p, clip);
  open(`${type}:${id}`, p, el, { autoplay: true });
}

export async function previewTransition(name: string, el: HTMLElement) {
  await loadSamples();
  const a = sampleMedia(0), b = sampleMedia(1);
  if (!a || !b) return;
  const p = base();
  const main = p.tracks.find((t) => t.main)!;
  const ca = makeClip('image', { mediaId: a.id, name: a.name, start: 0, duration: 2 });
  const cb = makeClip('image', { mediaId: b.id, name: b.name, start: 2, duration: 2 });
  cb.crossIn = { type: name, duration: 0.8 };
  main.clips.push(ca, cb);
  open(`transition:${name}`, p, el, { from: 1, to: 3.2, autoplay: true });
}

export async function previewTemplate(t: TemplateDef, el: HTMLElement) {
  await Promise.all([loadSamples(), loadTemplateSamples(t), t.music ? loadTemplateMedia(t.music.file) : null]);
  const p = buildTemplateProject(t, t.slots.map((_, i) => slotSample(t, i)));
  addTemplateMusic(p, t, 0, templateDuration(t));
  open(`template:${t.id}`, p, el, { autoplay: true });
}

// ---- drag to the timeline -------------------------------------------------------------

export interface LibItem { kind: 'text' | 'sticker' | 'effect' | 'filter' | 'transition' | 'template'; id: string; name?: string }
const LIB_TYPE = 'kinora/lib';

export function libDrag(el: HTMLElement, item: LibItem) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer!.setData(LIB_TYPE, JSON.stringify(item));
    e.dataTransfer!.effectAllowed = 'copy';
  });
}

/** Adds a dragged library item at timeline time `t`. Returns false if `dt` holds none. */
export function dropLibItem(dt: DataTransfer | null, t: number): boolean {
  const raw = dt?.getData(LIB_TYPE);
  if (!raw) return false;
  const item = JSON.parse(raw) as LibItem;
  // The add actions place things at the playhead; point it at the drop spot.
  store.currentTime = Math.max(0, t);
  switch (item.kind) {
    case 'text': {
      const p = item.id === '' ? null : TEXT_PRESETS[+item.id];
      addText(p?.style ?? {}, p?.name ?? 'Text');
      break;
    }
    case 'sticker': { const s = STICKERS.find((x) => x.id === item.id); if (s) addSticker(s); break; }
    case 'effect': case 'filter': addLookLayer(item.kind, item.id, item.name ?? item.id); break;
    case 'transition': applyCrossTransition(item.id, item.name ?? item.id); break;
    case 'template': { const tp = TEMPLATES.find((x) => x.id === item.id); if (tp) addTemplateToTimeline(tp); break; }
  }
  store.emit('time');
  return true;
}
