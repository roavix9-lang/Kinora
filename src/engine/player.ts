import { store } from '../store';
import { toast } from '../ui/dom';
import { Clip, clipEnd, hasSound } from '../types';
import { AudioEngine } from './audio';
import { stemsReady } from './isolate';
import { Compositor } from './compositor';
import { FrameReader } from './frames';
import { buildLayers } from './scene';
import { setStickerLoadedHandler } from './sticker';
import { setFontLoadedHandler } from './text';

/** Seconds around the playhead in which decoders are kept alive / pre-warmed. */
const KEEP_WINDOW = 3;
const PREROLL = 1;

export class Player {
  readonly comp: Compositor;
  readonly audio = new AudioEngine();
  private readers = new Map<string, { reader: FrameReader; mediaId: string; used: number }>();
  private dirty = true;
  private lastGc = 0;
  /** Output-pixels per project-pixel for the preview canvas. */
  private outScale = 1;
  fpsMeter = { frames: 0, last: performance.now(), value: 0 };

  constructor(readonly canvas: HTMLCanvasElement) {
    this.comp = new Compositor(canvas);
    store.on('project', () => {
      this.invalidate();
      // Only edits that change what is heard reschedule audio; markers, colour, text etc.
      // would otherwise cut the sound for a moment.
      const sig = this.audioSignature();
      if (store.playing && sig !== this.lastAudioSig) this.restartAudioSoon();
      this.lastAudioSig = sig;
    });
    store.on('time', () => this.invalidate());
    store.on('media', () => this.invalidate());
    setFontLoadedHandler(() => this.invalidate());
    setStickerLoadedHandler(() => this.invalidate());
    requestAnimationFrame(this.tick);
  }

  invalidate() { this.dirty = true; }

  /** Drops all decoders so new settings (e.g. hardware decoding) take effect. */
  resetDecoders() {
    for (const { reader } of this.readers.values()) reader.dispose();
    this.readers.clear();
    this.invalidate();
  }

  /** Sizes the backing store to the on-screen box, capped at project resolution. */
  fit(boxW: number, boxH: number) {
    const p = store.viewProject;
    const dpr = window.devicePixelRatio || 1;
    const s = Math.min(boxW / p.width, boxH / p.height);
    const cssW = Math.max(1, Math.floor(p.width * s));
    const cssH = Math.max(1, Math.floor(p.height * s));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    const q = store.previewFull ? 1 : Math.min(1, (s * dpr));
    this.outScale = q;
    this.comp.resize(Math.max(2, Math.round(p.width * q)), Math.max(2, Math.round(p.height * q)));
    this.invalidate();
    return { cssW, cssH, scale: s };
  }

  // ---- transport -------------------------------------------------------------

  async play() {
    if (store.playing) return;
    if (store.viewTime >= store.viewDuration - 1e-3) store.setViewTime(0);
    store.playing = true;
    this.lastAudioSig = this.audioSignature();
    store.emit('playing');
    if (!store.preview && !this.warnedSilent && !this.hasAudible()) {
      this.warnedSilent = true;
      toast('This timeline has no sound: photos and silent videos have no audio. Add music in the Audio tab.');
    }
    await this.audio.start(store.viewTime);
  }

  pause() {
    this.playUntil = null;
    if (!store.playing) return;
    store.playing = false;
    this.audio.stop();
    store.emit('playing');
    this.invalidate();
  }

  toggle() {
    if (store.playing) { this.pause(); return; }
    const pv = store.preview;
    if (pv) {
      // A library preview replays its own part once it has reached the end.
      const end = pv.to ?? store.viewDuration;
      if (store.viewTime < pv.from || store.viewTime >= end - 1e-3) this.playPreview(pv.from, pv.to ?? undefined);
      else { this.playUntil = pv.to; void this.play(); }
      return;
    }
    void this.play();
  }

  seek(t: number) {
    store.setViewTime(t);
    if (store.playing) void this.audio.start(store.viewTime);
  }

  step(frames: number) {
    this.pause();
    const f = 1 / store.viewProject.fps;
    this.seek(Math.round(store.viewTime / f + frames) * f);
  }

  /** Timeline time where playback stops by itself (animation previews). */
  private playUntil: number | null = null;

  /** Plays the library preview from `from`, stopping at `to` (or its end). */
  playPreview(from: number, to?: number) {
    this.pause();
    this.seek(from);
    this.playUntil = to ?? null;
    void this.play();
  }

  /** Plays [from, to] of the timeline once, e.g. to show an animation that was just picked. */
  playRange(from: number, to: number) {
    store.clearPreview();
    this.pause();
    this.seek(from);
    // Stop a frame early so the clip is still on screen at the end.
    this.playUntil = to - 1 / store.project.fps;
    void this.play();
  }

  private warnedSilent = false;

  private hasAudible() {
    return store.project.tracks.some((t) => !t.muted && t.clips.some((c) => {
      const m = c.mediaId ? store.media.get(c.mediaId) : undefined;
      return !c.muted && c.volume > 0 && hasSound(c, m);
    }));
  }

  private lastAudioSig = '';

  /** Everything that decides which sound plays when (volume is applied live each frame). */
  private audioSignature() {
    const parts: string[] = [];
    for (const t of store.viewProject.tracks) {
      for (const c of t.clips) {
        if (!c.mediaId || c.type === 'image') continue;
        parts.push(`${c.id}|${c.mediaId}|${c.start}|${c.duration}|${c.in}|${c.speed}|${c.muted ? 1 : 0}|${t.muted ? 1 : 0}|${c.isolate ?? ''}${c.isolate && stemsReady(c.mediaId) ? '+' : ''}`);
      }
    }
    return parts.join(';');
  }

  private audioTimer = 0;
  private restartAudioSoon() {
    clearTimeout(this.audioTimer);
    this.audioTimer = window.setTimeout(() => { if (store.playing) void this.audio.start(store.viewTime); }, 120);
  }

  // ---- render loop -----------------------------------------------------------

  private tick = () => {
    requestAnimationFrame(this.tick);
    if (store.playing) {
      const t = this.audio.timeNow();
      const end = this.playUntil ?? store.viewDuration;
      if (t >= end) {
        store.setViewTime(end);
        this.pause();
      } else if (t >= store.viewTime - 0.25) {
        // The audio clock starts slightly in the future; hold the playhead until it catches up.
        if (store.preview) store.preview.time = Math.max(0, t);
        else store.currentTime = Math.max(0, t);
        store.emit('time');
      }
      this.audio.updateGains(store.viewTime);
      this.prewarm(store.viewTime);
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.draw(store.viewTime);
    this.gcReaders();
  };

  private reader(clip: Clip): FrameReader | null {
    if (!clip.mediaId) return null;
    const hit = this.readers.get(clip.id);
    if (hit && hit.mediaId === clip.mediaId) { hit.used = performance.now(); return hit.reader; }
    hit?.reader.dispose();
    try {
      const reader = new FrameReader(clip.mediaId);
      reader.onFrame = () => this.invalidate();
      this.readers.set(clip.id, { reader, mediaId: clip.mediaId, used: performance.now() });
      return reader;
    } catch {
      return null;
    }
  }

  /** Starts decoders for clips about to enter so the cut lands on time. */
  private prewarm(t: number) {
    for (const track of store.viewProject.tracks) {
      if (track.kind !== 'video' || track.hidden) continue;
      for (const c of track.clips) {
        if (c.type === 'video' && c.start > t && c.start - t < PREROLL) this.reader(c)?.request(c.in, true);
      }
    }
  }

  draw(t: number) {
    const p = store.viewProject;
    const playing = store.playing;
    const { layers, frames } = buildLayers(this.comp, p, t, this.outScale, (clip, src) => this.reader(clip)?.request(src, playing) ?? null);
    this.comp.render(layers, p.width, p.height, p.background);
    for (const f of frames) f.close();
    const m = this.fpsMeter;
    m.frames++;
    const now = performance.now();
    if (now - m.last > 1000) { m.value = Math.round((m.frames * 1000) / (now - m.last)); m.frames = 0; m.last = now; }
  }

  private gcReaders() {
    const now = performance.now();
    if (now - this.lastGc < 1000) return;
    this.lastGc = now;
    const t = store.viewTime;
    for (const [id, { reader, used }] of this.readers) {
      const found = store.findViewClip(id);
      const near = found && found.clip.start - KEEP_WINDOW < t && clipEnd(found.clip) + KEEP_WINDOW > t;
      // Clips inside template clips aren't on the main timeline; keep them while they're drawn.
      if (!near && now - used > KEEP_WINDOW * 1000) { reader.dispose(); this.readers.delete(id); }
    }
  }
}
