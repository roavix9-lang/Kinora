import { store } from '../store';
import type { TemplateDef } from '../templates';
import { makeClip, MediaItem, Project } from '../types';
import { fetchCached } from './assets';
import { importFiles } from './media';

// The two bundled sample photos as hidden media items. Template previews use them, and
// template clips show them in slots the user hasn't replaced yet.
// Templates can also bring their own sample photos / clips and a song (R2 files, kept in the
// offline cache); those load on demand as hidden "tpls-…" media items.

const PHOTOS = ['samples/person-1-full.jpg?v=1', 'samples/person-2-full.jpg?v=1'];
const samples: MediaItem[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export const sampleId = (i: number) => `__sample_${i % PHOTOS.length}`;
export const samplesReady = () => samples.length === PHOTOS.length && samples.every(Boolean);
export const sampleMedia = (i: number): MediaItem | undefined => samples[i % PHOTOS.length];
export function onSamplesReady(fn: () => void) { listeners.add(fn); }

export function loadSamples(): Promise<void> {
  loading ??= Promise.all(PHOTOS.map(async (src, i) => {
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}${src}`;
    await img.decode();
    const bitmap = await createImageBitmap(img);
    const thumbH = 160;
    const thumb = await createImageBitmap(bitmap, { resizeHeight: thumbH, resizeWidth: Math.round((bitmap.width / bitmap.height) * thumbH), resizeQuality: 'high' });
    const item: MediaItem = {
      id: sampleId(i), kind: 'image', name: `Sample ${i + 1}`, file: new File([], `sample-${i}.jpg`),
      duration: 5, width: bitmap.width, height: bitmap.height, rotation: 0, hasAudio: false, hasVideo: true,
      codec: '', fps: 0, thumbs: [thumb], poster: thumb, thumbInterval: Infinity, peaksPerSecond: 50, bitmap,
      status: 'ready', deleted: true, sample: true,
    };
    store.media.set(item.id, item);
    samples[i] = item;
  })).then(() => {
    listeners.forEach((fn) => fn());
    // Template clips on the timeline / in the player can draw now.
    store.emit('media');
  });
  return loading;
}

// ---- per-template samples and music ----------------------------------------------------------

export const templateMediaId = (key: string) => `tpls-${key}`;
const loadingKeys = new Map<string, Promise<MediaItem | undefined>>();

/** A template's sample / song once it's ready to play. */
export function templateMedia(key: string): MediaItem | undefined {
  const m = store.media.get(templateMediaId(key));
  return m?.status === 'ready' ? m : undefined;
}

export function loadTemplateMedia(key: string): Promise<MediaItem | undefined> {
  let job = loadingKeys.get(key);
  if (!job) {
    job = (async () => {
      const blob = await fetchCached(key);
      const name = key.split('/').pop()!;
      const [item] = await importFiles([new File([blob], name, { type: blob.type })], [{ id: templateMediaId(key), name, library: true, deleted: true }]);
      return item?.status === 'ready' ? item : undefined;
    })().catch(() => { loadingKeys.delete(key); return undefined; });
    loadingKeys.set(key, job);
  }
  return job;
}

/** Loads every sample a template's slots show (resolves when all are ready or failed). */
export const loadTemplateSamples = (t: TemplateDef) => Promise.all(t.slots.map((sl) => (sl.sample ? loadTemplateMedia(sl.sample) : undefined)));

/** What slot i shows before it's replaced: the template's own sample, else a bundled photo. */
export function slotSample(t: TemplateDef, i: number): MediaItem | undefined {
  const key = t.slots[i]?.sample;
  return (key ? templateMedia(key) : undefined) ?? sampleMedia(i);
}

/** Adds the template's song as its own audio clip (from `start`, `duration` long). */
export function addTemplateMusic(p: Project, t: TemplateDef, start: number, duration: number) {
  if (!t.music) return;
  const m = t.music;
  const clip = makeClip('audio', { mediaId: templateMediaId(m.file), name: m.name, start, duration });
  clip.volume = m.volume ?? 1;
  clip.fadeOut = Math.min(m.fadeOut ?? 1, duration / 3);
  store.placeClip(p, clip);
  void loadTemplateMedia(m.file);
}

/** Loads template songs / samples the open timeline refers to (e.g. after a reload). */
export function ensureTemplateMedia(p: Project) {
  for (const tr of p.tracks) for (const c of tr.clips) {
    if (c.mediaId?.startsWith('tpls-') && !store.media.has(c.mediaId)) void loadTemplateMedia(c.mediaId.slice(5));
  }
}
