import { VideoSample } from 'mediabunny';
import { Clip, clipEnd, Project, sourceTime, Track } from '../types';
import { store } from '../store';
import { AnyLayer, Compositor } from './compositor';
import { nestedProject } from './templateClips';
import { layerGeom } from './layout';
import { renderSticker, STICKER_BASE } from './sticker';
import { renderText } from './text';

/** Visual clips active at time t, ordered bottom → top for drawing. */
export function visibleClips(p: Project, t: number): { clip: Clip; track: Track }[] {
  const out: { clip: Clip; track: Track }[] = [];
  for (let i = p.tracks.length - 1; i >= 0; i--) {
    const track = p.tracks[i];
    if (track.kind === 'audio' || track.hidden) continue;
    for (const clip of track.clips) {
      if (!clip.disabled && t >= clip.start && t < clip.start + clip.duration) out.push({ clip, track });
    }
  }
  return out;
}

const PLACEHOLDER = new ImageData(1, 1);

let missing: OffscreenCanvas | null = null;
/** "Media Not Found" card at the project's aspect ratio (cached until the ratio changes). */
function missingFrame(pw: number, ph: number): OffscreenCanvas {
  const k = 1280 / Math.max(pw, ph);
  const w = Math.round(pw * k), hh = Math.round(ph * k);
  if (missing && missing.width === w && missing.height === hh) return missing;
  missing = new OffscreenCanvas(w, hh);
  const ctx = missing.getContext('2d')!;
  ctx.fillStyle = '#4a1214';
  ctx.fillRect(0, 0, w, hh);
  ctx.fillStyle = '#fff';
  ctx.font = `500 ${Math.round(Math.min(w, hh) * 0.06)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Media Not Found', w / 2, hh / 2);
  return missing;
}

/** A GL transition straddling the cut between `a` (outgoing) and `b` (incoming) on one track. */
export interface CutTransition { a: Clip; b: Clip; type: string; start: number; end: number }

/** Back-to-back clip pairs on a track whose incoming clip carries a transition. */
export function trackTransitions(track: Track): CutTransition[] {
  const out: CutTransition[] = [];
  for (const b of track.clips) {
    if (!b.crossIn) continue;
    const a = track.clips.find((c) => c !== b && Math.abs(clipEnd(c) - b.start) < 0.05);
    if (!a) continue;
    // Centred on the cut, never longer than either clip.
    const d = Math.max(0.05, Math.min(b.crossIn.duration, a.duration, b.duration));
    out.push({ a, b, type: b.crossIn.type, start: b.start - d / 2, end: b.start + d / 2 });
  }
  return out;
}

/** Source time for a clip, allowed to run past its in/out points during a transition (clamped to the file). */
function sourceAt(clip: Clip, t: number) {
  const m = clip.mediaId ? store.media.get(clip.mediaId) : undefined;
  const src = sourceTime(clip, t);
  const max = m && clip.type === 'video' ? Math.max(0, m.duration - 0.001) : Infinity;
  return Math.min(max, Math.max(0, src));
}

type DrawItem = { clip: Clip; t: number; src: number } | { x: CutTransition; t: number };

/** What to draw at time t, bottom → top: single clips or transition pairs. */
function drawList(p: Project, t: number): DrawItem[] {
  const out: DrawItem[] = [];
  for (let i = p.tracks.length - 1; i >= 0; i--) {
    const track = p.tracks[i];
    if (track.kind === 'audio' || track.hidden) continue;
    const x = trackTransitions(track).find((tr) => t >= tr.start && t < tr.end);
    for (const clip of track.clips) {
      if (x && (clip === x.a || clip === x.b)) continue;
      if (t >= clip.start && t < clipEnd(clip)) out.push({ clip, t, src: sourceTime(clip, t) });
    }
    if (x) out.push({ x, t });
  }
  return out;
}

/** Every (video clip, source time) the frame at t needs; export pre-decodes these. */
export function videoRequests(p: Project, t: number): { clip: Clip; src: number }[] {
  const reqs: { clip: Clip; src: number }[] = [];
  const add = (c: Clip, src: number) => {
    if (c.type === 'video') reqs.push({ clip: c, src });
    else if (c.type === 'template') {
      // Videos inside a template clip, at the template's local time.
      const nested = nestedProject(c);
      if (nested) reqs.push(...videoRequests(nested, src));
    }
  };
  for (const it of drawList(p, t)) {
    if ('x' in it) for (const c of [it.x.a, it.x.b]) add(c, sourceAt(c, t));
    else add(it.clip, it.src);
  }
  return reqs;
}

/**
 * Builds compositor layers for time t. Video frames are converted to WebCodecs
 * VideoFrames only when the GPU texture is stale; the caller must close `frames`
 * after rendering.
 */
export function buildLayers(
  comp: Compositor,
  p: Project,
  t: number,
  outScale: number,
  getSample: (clip: Clip, srcTime: number) => VideoSample | null,
): { layers: AnyLayer[]; frames: VideoFrame[] } {
  const layers: AnyLayer[] = [];
  const frames: VideoFrame[] = [];

  /** One clip's layer; `gt` is the time used for its geometry/animation. */
  const layerFor = (clip: Clip, gt: number, src: number): AnyLayer | null => {
    const media = clip.mediaId ? store.media.get(clip.mediaId) : undefined;
    const geom = layerGeom(clip, media, p, gt);
    if (clip.type === 'template') {
      const nested = nestedProject(clip);
      if (!nested) return null;
      // Text in the template rasterises at the size it ends up on screen.
      const inner = buildLayers(comp, nested, src, outScale * (geom.h / nested.height), getSample);
      frames.push(...inner.frames);
      return { nested: true, id: clip.id, layers: inner.layers, w: nested.width, h: nested.height, geom, clip };
    }
    if ((clip.type === 'video' || clip.type === 'image') && (!media || media.status === 'error')) {
      // Same red placeholder CapCut shows when a clip's file is gone or unreadable.
      const c = missingFrame(p.width, p.height);
      return { id: clip.id, source: c, sourceKey: c, texW: c.width, texH: c.height, rotation: 0, geom, clip };
    }
    if (clip.type === 'video') {
      const sample = getSample(clip, src);
      if (!sample) return null;
      let source: TexImageSource = PLACEHOLDER;
      if (comp.needsUpload(clip.id, sample)) {
        const f = sample.toVideoFrame();
        frames.push(f);
        source = f;
      }
      return {
        id: clip.id, source, sourceKey: sample, texW: sample.squarePixelWidth, texH: sample.squarePixelHeight,
        rotation: sample.rotation, geom, clip,
      };
    }
    if (clip.type === 'image' && media?.bitmap) {
      return { id: clip.id, source: media.bitmap, sourceKey: media.bitmap, texW: media.width, texH: media.height, rotation: 0, geom, clip };
    }
    if (clip.type === 'text' && clip.text) {
      // Rasterise at final output resolution (including user scale) so text stays sharp at 4K.
      const q = outScale * Math.min(4, Math.max(0.25, clip.transform.scale));
      const r = renderText(clip.text, clip.text.size * (p.height / 1080) * q);
      return { id: clip.id, source: r.canvas as TexImageSource, sourceKey: r.key, texW: r.width, texH: r.height, rotation: 0, geom, clip };
    }
    if (clip.type === 'effect' || clip.type === 'filter') {
      return { id: clip.id, source: PLACEHOLDER, sourceKey: null, texW: p.width, texH: p.height, rotation: 0, geom, clip, post: true };
    }
    if (clip.type === 'sticker' && clip.sticker) {
      // Rasterise the vector at the size it will occupy on the output canvas.
      const q = outScale * Math.min(4, Math.max(0.25, clip.transform.scale));
      const r = renderSticker(clip.sticker, STICKER_BASE * (p.height / 1080) * q);
      if (r) return { id: clip.id, source: r.canvas as TexImageSource, sourceKey: r.key, texW: r.width, texH: r.height, rotation: 0, geom, clip };
    }
    return null;
  };

  for (const it of drawList(p, t)) {
    if ('x' in it) {
      const { a, b, type, start, end } = it.x;
      // Geometry stays at each clip's edge; the frames keep playing past the cut where footage allows.
      layers.push({
        xfade: true,
        from: layerFor(a, Math.min(t, clipEnd(a) - 1e-3), sourceAt(a, t)),
        to: layerFor(b, Math.max(t, b.start), sourceAt(b, t)),
        transition: type,
        progress: (t - start) / (end - start),
      });
    } else {
      const L = layerFor(it.clip, t, it.src);
      if (L) layers.push(L);
    }
  }
  return { layers, frames };
}
