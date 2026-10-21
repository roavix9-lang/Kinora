import { nestedDuration } from './engine/templateClips';
import { applyRatio, originalRatio, sizeFor, store } from './store';
import { TemplateDef, templateDuration } from './templates';
import { Clip, clipEnd, defaultText, makeClip, MediaItem, TextStyle, uid } from './types';
import { StickerDef } from './stickers';
import { fmtTime, toast } from './ui/dom';

const MIN_CLIP = 1 / 30;

/** Adds media at the playhead (main track appends at its end, like CapCut). */
export function addMediaToTimeline(m: MediaItem, at?: number, trackId?: string) {
  if (m.status !== 'ready') { toast(m.status === 'error' ? `Can't use ${m.name}: ${m.error}` : 'Still processing…'); return; }
  const type = m.kind === 'image' ? 'image' : m.kind === 'audio' ? 'audio' : 'video';
  const clip = makeClip(type, { mediaId: m.id, name: m.name, duration: m.duration, in: 0 });
  store.commit((p) => {
    // "Original" ratio: the first visual clip decides the canvas shape, as in CapCut.
    const firstVisual = type !== 'audio' && p.ratio === 'original' && !originalRatio(p, store.media);
    if (firstVisual) queueMicrotask(() => { applyRatio(store.project, 'original', store.media); store.emit('project', 'view'); });
    const preferred = trackId ? p.tracks.find((t) => t.id === trackId) : undefined;
    if (at === undefined) {
      if (type !== 'audio' && !preferred) {
        // First visuals go on the main track, appended at its end.
        const main = p.tracks.find((t) => t.main)!;
        clip.start = store.mainTrackEnd();
        main.clips.push(clip);
        return;
      }
      clip.start = store.currentTime;
    } else clip.start = Math.max(0, at);
    store.placeClip(p, clip, preferred);
  });
  store.select(clip.id);
  toast(`Added “${m.name}” to the timeline`, 'ok');
}

export function addText(style: Partial<TextStyle>, name = 'Text') {
  const clip = makeClip('text', { name, start: store.currentTime, duration: 3, text: defaultText(style) });
  store.commit((p) => { store.placeClip(p, clip); });
  store.select(clip.id);
  toast(`Text “${name}” added at ${store.currentTime.toFixed(1)}s`, 'ok');
}

export function addSticker(def: StickerDef) {
  const clip = makeClip('sticker', {
    name: def.name, start: store.currentTime, duration: 3,
    sticker: { id: def.id, color: def.color ?? '#ffffff' },
  });
  clip.transform.scale = 0.8;
  store.commit((p) => { store.placeClip(p, clip); });
  store.select(clip.id);
  toast(`Sticker “${def.name}” added`, 'ok');
}

/** Splits the selected clip (or every clip under the playhead if none selected). */
export function splitAtPlayhead() {
  const t = store.currentTime;
  const sel = store.selected;
  const targets: Clip[] = [];
  for (const tr of store.project.tracks) {
    if (tr.locked) continue;
    for (const c of tr.clips) {
      if (t > c.start + MIN_CLIP && t < clipEnd(c) - MIN_CLIP && (!sel || c.id === sel.id)) targets.push(c);
    }
  }
  if (!targets.length) { toast('Move the playhead over a clip to split'); return; }
  toast(targets.length > 1 ? `Split ${targets.length} clips` : `Split “${targets[0].name}”`);
  store.commit((p) => {
    for (const tr of p.tracks) {
      const add: Clip[] = [];
      for (const c of tr.clips) {
        if (!targets.some((x) => x.id === c.id)) continue;
        const left = t - c.start;
        const right: Clip = { ...structuredClone(c), id: uid('clip'), start: t, duration: c.duration - left, in: c.in + left * c.speed };
        // The cut created by a split has no transition; the left half keeps any incoming one.
        right.crossIn = undefined;
        c.duration = left;
        // Out-transition / fade stays with the right half, in-transition with the left.
        right.transitionIn = { ...right.transitionIn, type: 'none' };
        right.fadeIn = 0;
        c.transitionOut = { ...c.transitionOut, type: 'none' };
        c.fadeOut = 0;
        add.push(right);
      }
      tr.clips.push(...add);
    }
  });
}

export function deleteSelected(ripple = false) {
  const sel = store.selected;
  if (!sel) return;
  toast(`Deleted “${sel.name}”`);
  store.commit((p) => {
    for (const tr of p.tracks) {
      const i = tr.clips.findIndex((c) => c.id === sel.id);
      if (i < 0) continue;
      const [gone] = tr.clips.splice(i, 1);
      if (ripple || store.isMagnetic(tr)) {
        // Magnetic main track: close the gap.
        for (const c of tr.clips) if (c.start >= gone.start) c.start -= gone.duration;
      }
    }
  });
  store.select(null);
}

export function duplicateSelected() {
  const sel = store.selected;
  if (!sel) return;
  const copy: Clip = { ...structuredClone(sel), id: uid('clip'), start: clipEnd(sel) };
  toast(`Duplicated “${sel.name}”`);
  store.commit((p) => {
    const found = store.findClip(sel.id);
    store.placeClip(p, copy, found?.track);
  });
  store.select(copy.id);
}

/** Applies a partial update to a clip as a single undo step. */
export function updateClip(id: string, fn: (c: Clip) => void, checkpoint = true) {
  const found = store.findClip(id);
  if (!found) return;
  if (checkpoint) store.checkpoint();
  fn(found.clip);
  store.normalize();
  store.emit('project');
}

/** Changes speed while keeping the source range, i.e. the timeline duration scales. */
export function setSpeed(id: string, speed: number) {
  updateClip(id, (c) => {
    const srcLen = c.duration * c.speed;
    c.speed = speed;
    c.duration = srcLen / speed;
  });
  resolveOverlap(id);
}

/** Moves a clip to a free track if a length change made it overlap a neighbour. */
export function resolveOverlap(id: string) {
  const found = store.findClip(id);
  if (found && !store.fits(found.track, found.clip.start, found.clip.duration, id)) {
    const c = found.clip;
    found.track.clips = found.track.clips.filter((x) => x.id !== id);
    store.placeClip(store.project, c);
    store.normalize();
    store.emit('project');
  }
}

export function sourceDuration(c: Clip): number {
  const m = c.mediaId ? store.media.get(c.mediaId) : undefined;
  if (c.type === 'template') return nestedDuration(c);
  if (!m || c.type === 'image' || c.type === 'text' || c.type === 'sticker') return Infinity;
  return m.duration;
}

/** Adds an effect or filter as its own layer clip at the playhead (CapCut-style). */
export function addLookLayer(type: 'effect' | 'filter', id: string, name: string) {
  const clip = makeClip(type, { name, start: store.currentTime, duration: 3 });
  clip[type] = { id, intensity: type === 'effect' ? 0.6 : 1 };
  store.commit((p) => { store.placeClip(p, clip); });
  store.select(clip.id);
  toast(`${type === 'effect' ? 'Effect' : 'Filter'} “${name}” added at ${fmtTime(store.currentTime)}`, 'ok');
}

/** The clip that ends exactly where `c` starts on the same track, if any. */
export function previousAdjacent(c: Clip): Clip | null {
  const found = store.findClip(c.id);
  return found?.track.clips.find((x) => x !== c && Math.abs(clipEnd(x) - c.start) < 0.05) ?? null;
}

/**
 * Puts a GL transition on a cut: the selected clip's start if it follows another clip,
 * otherwise the cut between back-to-back clips nearest the playhead.
 */
export function applyCrossTransition(type: string, name: string) {
  let target: { a: Clip; b: Clip } | null = null;
  const sel = store.selected;
  if (sel && (sel.type === 'video' || sel.type === 'image')) {
    const a = previousAdjacent(sel);
    if (a) target = { a, b: sel };
  }
  if (!target) {
    let bestD = Infinity;
    for (const tr of store.project.tracks) {
      if (tr.kind !== 'video' || tr.locked) continue;
      for (const b of tr.clips) {
        const a = tr.clips.find((x) => x !== b && Math.abs(clipEnd(x) - b.start) < 0.05);
        const d = Math.abs(b.start - store.currentTime);
        if (a && d < bestD) { bestD = d; target = { a, b }; }
      }
    }
  }
  if (!target) { toast('Transitions go between two clips. Put two clips back-to-back on a track first.'); return; }
  const { a, b } = target;
  const duration = Math.min(b.crossIn?.duration ?? 0.8, a.duration, b.duration);
  store.commit(() => { b.crossIn = { type, duration }; });
  toast(`“${name}” added at ${fmtTime(b.start)}`, 'ok');
}

/** Adds a template as one clip at the end of the main track (slots start as sample photos). */
export function addTemplateToTimeline(t: TemplateDef) {
  const clip = makeClip('template', {
    name: t.name, duration: templateDuration(t),
    template: { id: t.id, media: t.slots.map(() => null) },
  });
  store.commit((p) => {
    // An empty "Original" canvas takes the template's shape, as CapCut does.
    if (p.ratio === 'original' && !p.tracks.some((tr) => tr.kind === 'video' && tr.clips.length)) {
      [p.width, p.height] = sizeFor(t.ratio, Math.min(p.width, p.height));
      p.ratio = t.ratio;
    }
    const main = p.tracks.find((tr) => tr.main)!;
    clip.start = store.mainTrackEnd();
    main.clips.push(clip);
  });
  // The slot strip stays closed until the user clicks “N clips to be replaced”.
  store.templateStripOpen = false;
  store.select(clip.id);
  toast(`“${t.name}” added. Replace the ${t.slots.length} clips with your own.`, 'ok');
}

/** Puts a media item into one slot of a template clip and refits the clip's length. */
export function replaceTemplateSlot(clipId: string, slot: number, mediaId: string) {
  updateClip(clipId, (c) => {
    if (!c.template) return;
    c.template.media[slot] = mediaId;
  });
  const found = store.findClip(clipId);
  if (!found) return;
  const d = nestedDuration(found.clip);
  if (Math.abs(d - found.clip.duration) > 1e-3) {
    found.clip.in = 0;
    found.clip.duration = d;
    store.normalize();
    store.emit('project');
  }
}

/**
 * Delete left / right (CapCut Q / W): trims the selected clip, or every clip under the
 * playhead if none is selected, so the part before / after the playhead is removed.
 */
export function deleteSide(side: 'left' | 'right') {
  const t = store.currentTime;
  const sel = store.selected;
  const hit = (c: Clip) => c.start + MIN_CLIP < t && t < clipEnd(c) - MIN_CLIP;
  const ids: string[] = [];
  for (const tr of store.project.tracks) {
    if (tr.locked) continue;
    for (const c of tr.clips) if ((sel ? c.id === sel.id : true) && hit(c)) ids.push(c.id);
  }
  if (!ids.length) { toast(sel ? 'Move the playhead inside the selected clip first.' : 'No clip under the playhead.'); return; }
  store.commit((p) => {
    for (const tr of p.tracks) for (const c of tr.clips) {
      if (!ids.includes(c.id)) continue;
      const cut = t - c.start;
      if (side === 'left') {
        c.in += cut * c.speed;
        c.start = t;
        c.duration -= cut;
        c.markers = c.markers?.map((m) => m - cut).filter((m) => m >= 0);
      } else {
        c.duration = cut;
        c.markers = c.markers?.filter((m) => m <= cut);
      }
    }
  });
}

/** Add marker (CapCut M): on the selected clip at the playhead, else on the timeline. Again at the same spot removes it. */
export function toggleMarker() {
  const t = store.currentTime;
  const near = 0.5 / store.project.fps;
  const sel = store.selected;
  store.commit((p) => {
    const c = sel ? p.tracks.flatMap((tr) => tr.clips).find((x) => x.id === sel.id) : undefined;
    if (c && c.start <= t && t <= clipEnd(c)) {
      const off = t - c.start;
      const list = c.markers ?? [];
      c.markers = list.some((m) => Math.abs(m - off) < near) ? list.filter((m) => Math.abs(m - off) >= near) : [...list, off].sort((a, b) => a - b);
    } else {
      const list = p.markers ?? [];
      p.markers = list.some((m) => Math.abs(m - t) < near) ? list.filter((m) => Math.abs(m - t) >= near) : [...list, t].sort((a, b) => a - b);
    }
  });
}
