import {
  ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input, InputAudioTrack, InputVideoTrack,
} from 'mediabunny';
import { store } from '../store';
import { MediaItem, MediaKind, uid } from '../types';
import { toast } from '../ui/dom';
import { computePeaks, toMono } from '../wasm/dsp';

export interface Demuxed {
  input: Input;
  video: InputVideoTrack | null;
  audio: InputAudioTrack | null;
}

const demuxed = new Map<string, Demuxed>();
/** Fully decoded audio for media whose audio codec WebCodecs can't handle here. */
const fallbackAudio = new Map<string, AudioBuffer>();

export const getDemuxed = (mediaId: string) => demuxed.get(mediaId) ?? null;

export const hasAudioSource = (mediaId: string) => !!demuxed.get(mediaId)?.audio || fallbackAudio.has(mediaId);

/**
 * Decoded audio for [start, end) seconds of a media file, in presentation order.
 * Streams through WebCodecs when possible, otherwise slices the fallback buffer.
 */
export async function* audioBuffers(mediaId: string, start: number, end: number): AsyncGenerator<{ buffer: AudioBuffer; timestamp: number }> {
  const track = demuxed.get(mediaId)?.audio;
  if (track) {
    yield* new AudioBufferSink(track).buffers(start, end);
    return;
  }
  const full = fallbackAudio.get(mediaId);
  if (!full) return;
  const rate = full.sampleRate;
  const s0 = Math.max(0, Math.floor(start * rate));
  const s1 = Math.min(full.length, Math.ceil(end * rate));
  if (s1 <= s0) return;
  const slice = new AudioBuffer({ length: s1 - s0, numberOfChannels: full.numberOfChannels, sampleRate: rate });
  for (let ch = 0; ch < full.numberOfChannels; ch++) slice.copyToChannel(full.getChannelData(ch).subarray(s0, s1), ch);
  yield { buffer: slice, timestamp: s0 / rate };
}

/** Decodes a whole file's audio with the browser's built-in decoder (AAC/MP3/etc. everywhere). */
async function decodeWithWebAudio(item: MediaItem): Promise<AudioBuffer | null> {
  try {
    const ctx = new OfflineAudioContext(2, 1, 48000);
    return await ctx.decodeAudioData(await item.file.arrayBuffer());
  } catch {
    return null;
  }
}

function peaksFromBuffer(item: MediaItem, buf: AudioBuffer) {
  const bucket = Math.max(1, Math.round(buf.sampleRate / PEAKS_PER_SECOND));
  const p = computePeaks(toMono(buf), bucket);
  let max = 0;
  for (let i = 0; i < p.length; i++) max = Math.max(max, p[i]);
  if (max > 0) for (let i = 0; i < p.length; i++) p[i] /= max;
  item.peaks = p;
  item.peakScale = max;
}

const PEAKS_PER_SECOND = 50;
const IMAGE_DEFAULT_DURATION = 5;

function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'aac', 'm4a', 'ogg', 'oga', 'flac', 'opus'].includes(ext)) return 'audio';
  if (['mp4', 'mov', 'm4v', 'webm', 'mkv', 'ts', 'mts'].includes(ext)) return 'video';
  return null;
}

/** `restore` (one per file) re-creates saved media with its old id, so saved projects still point at it. */
export async function importFiles(files: Iterable<File>, restore?: Partial<MediaItem>[]): Promise<MediaItem[]> {
  const items: MediaItem[] = [];
  let n = 0;
  for (let file of files) {
    const saved = restore?.[n++];
    const kind = kindOf(file);
    // "Copy media to project": keep our own copy of the bytes instead of a reference to the file on disk.
    if (kind && store.copyMedia) file = new File([await file.arrayBuffer()], file.name, { type: file.type, lastModified: file.lastModified });
    if (!kind) continue;
    const item: MediaItem = {
      id: uid('med'), kind, name: file.name, file, duration: kind === 'image' ? IMAGE_DEFAULT_DURATION : 0,
      width: 0, height: 0, rotation: 0, hasAudio: false, hasVideo: kind !== 'audio', codec: '', fps: 0,
      thumbs: [], thumbInterval: 1, peaksPerSecond: PEAKS_PER_SECOND, status: 'loading',
      ...(saved ? { id: saved.id!, name: saved.name ?? file.name, folderId: saved.folderId, deleted: saved.deleted } : {}),
    };
    store.media.set(item.id, item);
    items.push(item);
  }
  store.emit('media');
  // Probe sequentially so one big 4K file does not starve the others of decoder slots.
  for (const item of items) {
    try {
      if (item.kind === 'image') await probeImage(item);
      else await probeAV(item);
      item.status = 'ready';
    } catch (err) {
      console.error('[kinora] import failed', item.name, err);
      item.status = 'error';
      item.error = err instanceof Error ? err.message : String(err);
    }
    store.emit('media', 'project');
  }
  return items;
}

/**
 * Points an existing media item at a different file (CapCut's "Link to media").
 * Clips keep referencing the same id; ones that now run past the new file's end are shortened.
 */
export async function relinkMedia(item: MediaItem, file: File): Promise<boolean> {
  const kind = kindOf(file);
  if (!kind) throw new Error('Unsupported file type');
  demuxed.get(item.id)?.input.dispose();
  demuxed.delete(item.id);
  fallbackAudio.delete(item.id);
  Object.assign(item, {
    kind, name: file.name, file, duration: kind === 'image' ? IMAGE_DEFAULT_DURATION : 0, width: 0, height: 0, rotation: 0,
    hasAudio: false, hasVideo: kind !== 'audio', codec: '', fps: 0, thumbs: [], thumbInterval: 1,
    peaks: undefined, poster: undefined, bitmap: undefined, status: 'loading', error: undefined,
  } satisfies Partial<MediaItem>);
  store.emit('media', 'project');
  try {
    if (kind === 'image') await probeImage(item);
    else await probeAV(item);
    item.status = 'ready';
  } catch (err) {
    item.status = 'error';
    item.error = err instanceof Error ? err.message : String(err);
  }
  if (item.status === 'ready' && kind !== 'image') {
    for (const tl of store.timelines) {
      const p = tl.id === store.activeTimelineId ? store.project : tl.project;
      for (const t of p.tracks) for (const c of t.clips) {
        if (c.mediaId !== item.id) continue;
        c.in = Math.min(c.in, Math.max(0, item.duration - 0.1));
        c.duration = Math.min(c.duration, (item.duration - c.in) / c.speed);
      }
    }
  }
  store.emit('media', 'project');
  return item.status === 'ready';
}

async function probeImage(item: MediaItem) {
  const bmp = await createImageBitmap(item.file);
  item.bitmap = bmp;
  item.width = bmp.width;
  item.height = bmp.height;
  const resized = async (longest: number) => {
    const s = Math.min(1, longest / Math.max(bmp.width, bmp.height));
    return createImageBitmap(bmp, {
      resizeWidth: Math.max(1, Math.round(bmp.width * s)),
      resizeHeight: Math.max(1, Math.round(bmp.height * s)),
      resizeQuality: 'high',
    });
  };
  item.poster = await resized(640);
  item.thumbs = [await resized(320)];
  item.thumbInterval = Infinity;
}

async function probeAV(item: MediaItem) {
  const input = new Input({ source: new BlobSource(item.file), formats: ALL_FORMATS });
  if (!(await input.canRead())) {
    // Container mediabunny can't parse: audio files may still decode natively.
    if (item.kind === 'audio') {
      const buf = await decodeWithWebAudio(item);
      if (!buf) throw new Error('Unsupported audio file');
      fallbackAudio.set(item.id, buf);
      item.duration = buf.duration;
      item.hasAudio = true;
      peaksFromBuffer(item, buf);
      return;
    }
    throw new Error('Unsupported container');
  }
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  const videoOk = !!video && (await video.canDecode());
  let audioOk = !!audio && (await audio.canDecode());
  if (video && !videoOk) console.warn(`[kinora] ${item.name}: video codec ${video.codec} not decodable by WebCodecs here`);

  let fallback: AudioBuffer | null = null;
  if (audio && !audioOk) {
    console.warn(`[kinora] ${item.name}: audio codec ${audio.codec} not decodable by WebCodecs, using Web Audio fallback`);
    fallback = await decodeWithWebAudio(item);
    if (fallback) fallbackAudio.set(item.id, fallback);
    else toast(`“${item.name}”: this browser can't decode its ${audio.codec ?? 'audio'} soundtrack, so it will be silent`, 'error');
  }
  if (!videoOk && !audioOk && !fallback) throw new Error('No decodable tracks (codec not supported by this browser)');

  demuxed.set(item.id, { input, video: videoOk ? video : null, audio: audioOk ? audio : null });
  item.duration = await input.computeDuration();
  audioOk ||= !!fallback;
  item.hasAudio = audioOk;
  item.hasVideo = videoOk;
  if (item.kind === 'video' && !videoOk) item.kind = 'audio';

  if (videoOk && video) {
    item.width = video.displayWidth;
    item.height = video.displayHeight;
    item.rotation = video.rotation;
    item.codec = video.codec ?? '';
    try {
      const stats = await video.computePacketStats(120);
      item.fps = Math.round(stats.averagePacketRate * 100) / 100;
    } catch { item.fps = 30; }
    store.emit('media');
    await buildThumbnails(item, video);
  }
  if (fallback) peaksFromBuffer(item, fallback);
  else if (audioOk && audio) {
    if (!item.codec) item.codec = audio.codec ?? '';
    await buildPeaks(item, audio);
  }
}

async function buildThumbnails(item: MediaItem, track: InputVideoTrack) {
  const count = Math.min(60, Math.max(2, Math.ceil(item.duration)));
  const interval = item.duration / count;
  const aspect = item.width / Math.max(1, item.height);
  // Timeline clips are ~60 CSS px tall; 144 px keeps them crisp on 2× displays.
  const height = 144;
  const sink = new CanvasSink(track, { width: Math.round(height * aspect), height, fit: 'fill', poolSize: 0 });
  const first = await track.getFirstTimestamp();
  try {
    const posterH = Math.min(item.height, 480);
    const posterSink = new CanvasSink(track, { width: Math.round(posterH * aspect), height: posterH, fit: 'fill', poolSize: 0 });
    const p = await posterSink.getCanvas(first + Math.min(0.5, item.duration / 4));
    if (p) item.poster = await createImageBitmap(p.canvas);
  } catch { /* poster is cosmetic */ }
  const stamps = Array.from({ length: count }, (_, i) => first + i * interval);
  item.thumbInterval = interval;
  for await (const wrapped of sink.canvasesAtTimestamps(stamps)) {
    if (wrapped) item.thumbs.push(await createImageBitmap(wrapped.canvas));
    else if (item.thumbs.length) item.thumbs.push(item.thumbs[item.thumbs.length - 1]);
    if (item.thumbs.length === 1 || item.thumbs.length % 8 === 0) store.emit('media', 'project');
  }
}

async function buildPeaks(item: MediaItem, track: InputAudioTrack) {
  const sink = new AudioBufferSink(track);
  const chunks: Float32Array[] = [];
  let total = 0;
  const bucket = Math.max(1, Math.round(track.sampleRate / PEAKS_PER_SECOND));
  // Samples left over from the previous chunk that don't fill a whole bucket yet.
  let carry = new Float32Array(0);
  const flush = (samples: Float32Array) => {
    const p = computePeaks(samples, bucket);
    chunks.push(p);
    total += p.length;
  };
  for await (const { buffer } of sink.buffers()) {
    // Reduce each decoded chunk immediately: keeps memory flat for long 4K recordings.
    const mono = toMono(buffer);
    const joined = new Float32Array(carry.length + mono.length);
    joined.set(carry);
    joined.set(mono, carry.length);
    const whole = joined.length - (joined.length % bucket);
    if (whole) flush(joined.subarray(0, whole));
    carry = joined.slice(whole);
  }
  if (carry.length) flush(carry);
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  // Normalise so quiet recordings are still visible.
  let max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, out[i]);
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max;
  item.peaks = out;
  item.peakScale = max;
}

export function thumbAt(item: MediaItem, srcTime: number): ImageBitmap | null {
  if (!item.thumbs.length) return null;
  if (!isFinite(item.thumbInterval)) return item.thumbs[0];
  const i = Math.min(item.thumbs.length - 1, Math.max(0, Math.floor(srcTime / item.thumbInterval)));
  return item.thumbs[i];
}
