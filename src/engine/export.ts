import {
  AudioBufferSource, AudioCodec, BufferTarget, CanvasSource, getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec, Mp4OutputFormat, Output, StreamTarget, Target, VideoCodec, WebMOutputFormat,
} from 'mediabunny';
import { store } from '../store';
import { Clip, clipEnd, hasSound, Project } from '../types';
import { mixInto, MixJob } from '../wasm/dsp';
import { Compositor } from './compositor';
import { FrameReader } from './frames';
import { hasAudioSource } from './media';
import { clipAudioBuffers } from './isolate';
import { buildLayers, videoRequests } from './scene';

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  container: 'mp4' | 'webm';
  codec: VideoCodec | 'auto';
  /** Bits per pixel per frame; ~0.1 is visually transparent for H.264. */
  bpp: number;
  includeAudio: boolean;
  /** Stream straight to disk via the File System Access API when available. */
  fileHandle?: FileSystemFileHandle;
  /** Timeline to render; defaults to the open one. */
  project?: Project;
  onProgress: (p: { frame: number; total: number; fps: number; stage: string }) => void;
  signal: AbortSignal;
}

export interface ExportResult { blob?: Blob; codec: string; bytes: number; seconds: number }

const SAMPLE_RATE = 48000;
const AUDIO_BLOCK = 5; // seconds per mix block

export const VIDEO_CODECS: { id: VideoCodec; name: string }[] = [
  { id: 'avc', name: 'H.264' },
  { id: 'hevc', name: 'HEVC (H.265)' },
  { id: 'av1', name: 'AV1' },
  { id: 'vp9', name: 'VP9' },
];

export async function supportedCodecs(container: 'mp4' | 'webm', width: number, height: number, bitrate: number) {
  const list: VideoCodec[] = container === 'mp4' ? ['avc', 'hevc', 'av1', 'vp9'] : ['vp9', 'av1', 'vp8'];
  const ok: VideoCodec[] = [];
  for (const c of list) {
    if (await getFirstEncodableVideoCodec([c], { width, height, bitrate })) ok.push(c);
  }
  return ok;
}

export async function exportProject(o: ExportOptions): Promise<ExportResult> {
  const p = o.project ?? store.project;
  const duration = projectDuration(p);
  if (duration <= 0) throw new Error('Timeline is empty');
  const t0 = performance.now();
  const bitrate = Math.round(o.width * o.height * o.fps * o.bpp);
  // Audio-only timelines (e.g. exporting a single audio item) produce an audio file.
  const visual = hasVisual(p);

  let codec: VideoCodec | null = null;
  if (visual) {
    const candidates: VideoCodec[] = o.codec === 'auto'
      ? (o.container === 'mp4' ? ['avc', 'hevc', 'av1', 'vp9'] : ['vp9', 'av1', 'vp8'])
      : [o.codec];
    codec = await getFirstEncodableVideoCodec(candidates, { width: o.width, height: o.height, bitrate });
    if (!codec) throw new Error(`No WebCodecs encoder available for ${o.width}×${o.height} in this browser`);
  }

  let writable: FileSystemWritableFileStream | null = null;
  let target: Target;
  if (o.fileHandle) {
    writable = await o.fileHandle.createWritable();
    target = new StreamTarget(writable as unknown as WritableStream, { chunked: true });
  } else {
    target = new BufferTarget();
  }
  const format = o.container === 'mp4' ? new Mp4OutputFormat({ fastStart: o.fileHandle ? false : 'in-memory' }) : new WebMOutputFormat();
  const output = new Output({ format, target });

  const canvas = visual ? new OffscreenCanvas(o.width, o.height) : null;
  const comp = canvas ? new Compositor(canvas) : null;
  const videoSource = canvas && codec ? new CanvasSource(canvas, {
    codec, bitrate, keyFrameInterval: 2, hardwareAcceleration: 'prefer-hardware', latencyMode: 'quality',
  }) : null;
  if (videoSource) output.addVideoTrack(videoSource, { frameRate: o.fps });

  const soundClips = o.includeAudio || !visual ? collectSoundClips(p) : [];
  if (!visual && !soundClips.length) throw new Error('Nothing to export: this clip has no audible sound');
  let audioSource: AudioBufferSource | null = null;
  if (soundClips.length) {
    const ac: AudioCodec[] = o.container === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'];
    const audioCodec = await getFirstEncodableAudioCodec(ac, { numberOfChannels: 2, sampleRate: SAMPLE_RATE, bitrate: 192e3 });
    if (audioCodec) {
      audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: 192e3 });
      output.addAudioTrack(audioSource);
    }
  }

  const readers = new Map<string, FrameReader>();
  try {
    await output.start();

    if (audioSource) {
      o.onProgress({ frame: 0, total: 1, fps: 0, stage: 'Mixing audio' });
      await renderAudio(soundClips, duration, audioSource, o.signal);
    }

    const total = Math.max(1, Math.round(duration * o.fps));
    const outScale = o.height / p.height;
    for (let i = 0; comp && videoSource && i < total; i++) {
      if (o.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = i / o.fps;
      // Decode every video frame this output frame needs (both sides during a transition).
      const samples = new Map<string, Awaited<ReturnType<FrameReader['frameAt']>>>();
      const needed = new Set<string>();
      for (const { clip, src } of videoRequests(p, t)) {
        let r = readers.get(clip.id);
        if (!r) { r = new FrameReader(clip.mediaId!); readers.set(clip.id, r); }
        samples.set(clip.id, await r.frameAt(src));
        needed.add(clip.id);
      }
      // Release decoders of clips that are well behind the playhead.
      for (const [id, r] of readers) {
        if (needed.has(id)) continue;
        const found = store.findClipIn(p, id);
        if (!found || clipEnd(found) + 3 < t) { r.dispose(); readers.delete(id); }
      }
      const { layers, frames } = buildLayers(comp, p, t, outScale, (clip) => samples.get(clip.id) ?? null);
      comp.render(layers, p.width, p.height, p.background);
      frames.forEach((f) => f.close());
      await videoSource.add(t, 1 / o.fps, { keyFrame: i % (o.fps * 2) === 0 });
      if (i % 5 === 0 || i === total - 1) {
        const secs = (performance.now() - t0) / 1000;
        o.onProgress({ frame: i + 1, total, fps: (i + 1) / Math.max(secs, 1e-3), stage: 'Encoding video' });
      }
    }

    o.onProgress({ frame: total, total, fps: 0, stage: 'Finalizing' });
    await output.finalize();
    const seconds = (performance.now() - t0) / 1000;
    if (target instanceof BufferTarget) {
      const buf = target.buffer!;
      const type = visual ? (o.container === 'mp4' ? 'video/mp4' : 'video/webm') : (o.container === 'mp4' ? 'audio/mp4' : 'audio/webm');
      const blob = new Blob([buf], { type });
      return { blob, codec: codec ?? 'audio', bytes: buf.byteLength, seconds };
    }
    const file = await o.fileHandle!.getFile();
    return { codec: codec ?? 'audio', bytes: file.size, seconds };
  } catch (err) {
    await output.cancel().catch(() => {});
    if (writable) await writable.abort().catch(() => {});
    throw err;
  } finally {
    readers.forEach((r) => r.dispose());
    comp?.dispose();
  }
}

export function projectDuration(p: Project) {
  let d = 0;
  for (const t of p.tracks) for (const c of t.clips) d = Math.max(d, clipEnd(c));
  return d;
}

export const hasVisual = (p: Project) => p.tracks.some((t) => t.kind !== 'audio' && t.clips.length > 0);

function collectSoundClips(p: Project): Clip[] {
  const out: Clip[] = [];
  for (const track of p.tracks) {
    if (track.muted) continue;
    for (const c of track.clips) {
      const m = c.mediaId ? store.media.get(c.mediaId) : undefined;
      if (!c.muted && c.volume > 0 && hasSound(c, m) && hasAudioSource(c.mediaId!)) out.push(c);
    }
  }
  return out;
}

/** Mixes all sound clips block by block in WebAssembly and feeds the encoder. */
async function renderAudio(clips: Clip[], duration: number, source: AudioBufferSource, signal: AbortSignal) {
  const totalSamples = Math.ceil(duration * SAMPLE_RATE);
  for (let b0 = 0; b0 < totalSamples; b0 += AUDIO_BLOCK * SAMPLE_RATE) {
    if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const len = Math.min(AUDIO_BLOCK * SAMPLE_RATE, totalSamples - b0);
    const tA = b0 / SAMPLE_RATE;
    const tB = (b0 + len) / SAMPLE_RATE;
    const left = new Float32Array(len);
    const right = new Float32Array(len);
    const jobsL: MixJob[] = [];
    const jobsR: MixJob[] = [];

    for (const c of clips) {
      const s = Math.max(tA, c.start);
      const e = Math.min(tB, clipEnd(c));
      if (e <= s) continue;
      const srcA = c.in + (s - c.start) * c.speed;
      const srcB = c.in + (e - c.start) * c.speed;
      const chunks: AudioBuffer[] = [];
      let firstTs = -1;
      for await (const wb of clipAudioBuffers(c, srcA, srcB + 0.05)) {
        if (firstTs < 0) firstTs = wb.timestamp;
        chunks.push(wb.buffer);
      }
      if (!chunks.length) continue;
      const rate = chunks[0].sampleRate;
      const n = chunks.reduce((a, x) => a + x.length, 0);
      const chL = new Float32Array(n);
      const chR = new Float32Array(n);
      let off = 0;
      for (const ch of chunks) {
        chL.set(ch.getChannelData(0), off);
        chR.set(ch.getChannelData(Math.min(1, ch.numberOfChannels - 1)), off);
        off += ch.length;
      }
      const base: Omit<MixJob, 'src'> = {
        dstOffset: Math.round((s - tA) * SAMPLE_RATE),
        srcStart: (srcA - firstTs) * rate,
        rate: (c.speed * rate) / SAMPLE_RATE,
        gain: c.volume,
        clipOffset: Math.round((s - c.start) * SAMPLE_RATE),
        clipLen: Math.round(c.duration * SAMPLE_RATE),
        fadeIn: Math.round(c.fadeIn * SAMPLE_RATE),
        fadeOut: Math.round(c.fadeOut * SAMPLE_RATE),
      };
      jobsL.push({ ...base, src: chL });
      jobsR.push({ ...base, src: chR });
    }

    mixInto(left, jobsL);
    mixInto(right, jobsR);
    const buf = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
    buf.copyToChannel(left, 0);
    buf.copyToChannel(right, 1);
    await source.add(buf);
  }
}
