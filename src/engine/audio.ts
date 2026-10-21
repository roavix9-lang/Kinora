import { store } from '../store';
import { Clip, clipEnd, hasSound, Track } from '../types';
import { audioGain } from './layout';
import { audioBuffers, hasAudioSource } from './media';

const LOOKAHEAD = 1.0; // seconds of audio scheduled ahead of the clock

/**
 * Real-time audio playback: decodes clip audio with WebCodecs (via mediabunny's
 * AudioBufferSink) and schedules it on a Web Audio clock that also drives video.
 */
export class AudioEngine {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  private master = this.ctx.createGain();
  private generation = 0;
  private nodes = new Set<AudioBufferSourceNode>();
  private gains = new Map<string, GainNode>();
  private anchorCtx = 0;
  private anchorT = 0;

  /** Left/right analysers on the master bus, for the player's level meter. */
  private meters: AnalyserNode[] = [];
  private meterBuf = new Float32Array(1024);

  constructor() {
    // Mix to stereo so mono clips light both meter columns.
    this.master.channelCount = 2;
    this.master.channelCountMode = 'explicit';
    this.master.connect(this.ctx.destination);
    const split = this.ctx.createChannelSplitter(2);
    this.master.connect(split);
    for (let ch = 0; ch < 2; ch++) {
      const a = this.ctx.createAnalyser();
      a.fftSize = 1024;
      split.connect(a, ch);
      this.meters.push(a);
    }
  }

  /** Current loudness per channel (RMS, 0..1 linear). */
  levels(): [number, number] {
    const out: number[] = this.meters.map((a) => {
      a.getFloatTimeDomainData(this.meterBuf);
      let sum = 0;
      for (const v of this.meterBuf) sum += v * v;
      return Math.sqrt(sum / this.meterBuf.length);
    });
    return [out[0], out[1]];
  }

  setMasterVolume(v: number) { this.master.gain.value = v; }

  /** Timeline time according to the audio clock. */
  timeNow() { return this.anchorT + (this.ctx.currentTime - this.anchorCtx); }

  async start(t: number) {
    this.stop();
    const gen = this.generation;
    this.anchorCtx = this.ctx.currentTime + 0.05;
    this.anchorT = t;
    if (this.ctx.state !== 'running') {
      await this.ctx.resume().catch(() => {});
      if (gen !== this.generation) return;
      this.anchorCtx = this.ctx.currentTime + 0.05;
    }
    for (const track of store.viewProject.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (clipEnd(clip) <= t || clip.muted) continue;
        const media = clip.mediaId ? store.media.get(clip.mediaId) : undefined;
        if (!hasSound(clip, media)) continue;
        void this.playClip(clip, track, t, gen);
      }
    }
  }

  private async playClip(clip: Clip, _track: Track, t0: number, gen: number) {
    if (!clip.mediaId || !hasAudioSource(clip.mediaId)) return;
    const tlStart = Math.max(t0, clip.start);
    // Wait until the clip is close to the playhead before decoding.
    while (gen === this.generation && this.ctxTimeFor(tlStart) - this.ctx.currentTime > LOOKAHEAD + 0.5) await sleep(100);
    if (gen !== this.generation) return;

    const gain = this.ctx.createGain();
    gain.gain.value = audioGain(clip, tlStart);
    gain.connect(this.master);
    this.gains.set(clip.id, gain);

    const srcStart = clip.in + (tlStart - clip.start) * clip.speed;
    const srcEnd = clip.in + clip.duration * clip.speed;
    const ctxStart = this.ctxTimeFor(tlStart);
    const ctxEnd = this.ctxTimeFor(clipEnd(clip));
    const schedule = (buffer: AudioBuffer, timestamp: number) => {
      let when = ctxStart + (timestamp - srcStart) / clip.speed;
      let offset = 0;
      if (when < ctxStart) { offset = (ctxStart - when) * clip.speed; when = ctxStart; }
      const now = this.ctx.currentTime;
      if (when < now) { offset += (now - when) * clip.speed; when = now; }
      if (offset >= buffer.duration) return when;
      const node = this.ctx.createBufferSource();
      node.buffer = buffer;
      node.playbackRate.value = clip.speed;
      node.connect(gain);
      node.start(when, offset);
      node.stop(ctxEnd);
      node.onended = () => this.nodes.delete(node);
      this.nodes.add(node);
      return when;
    };

    // Decoders emit ~20 ms chunks. Coalescing them into larger buffers means far fewer
    // nodes and seams, which keeps playback gapless under load.
    let pending: AudioBuffer[] = [];
    let pendingTs = 0;
    let pendingLen = 0;
    let first = true;
    const flush = () => {
      if (!pending.length) return null;
      const ref = pending[0];
      const merged = pending.length === 1 ? ref : new AudioBuffer({ length: pendingLen, numberOfChannels: ref.numberOfChannels, sampleRate: ref.sampleRate });
      if (pending.length > 1) {
        for (let ch = 0; ch < ref.numberOfChannels; ch++) {
          const out = merged.getChannelData(ch);
          let o = 0;
          for (const b of pending) { out.set(b.getChannelData(ch), o); o += b.length; }
        }
      }
      const when = schedule(merged, pendingTs);
      pending = [];
      pendingLen = 0;
      first = false;
      return when;
    };

    try {
      for await (const { buffer, timestamp } of audioBuffers(clip.mediaId, srcStart, srcEnd)) {
        if (gen !== this.generation) break;
        const ref = pending[0];
        const expected = ref ? pendingTs + pendingLen / ref.sampleRate : timestamp;
        // Only merge contiguous chunks with identical format.
        if (ref && (buffer.sampleRate !== ref.sampleRate || buffer.numberOfChannels !== ref.numberOfChannels || Math.abs(timestamp - expected) > 0.002)) flush();
        if (!pending.length) pendingTs = timestamp;
        pending.push(buffer);
        pendingLen += buffer.length;
        // Start fast (small first batch), then schedule in half-second blocks.
        if (pendingLen / buffer.sampleRate >= (first ? 0.12 : 0.5)) {
          const when = flush();
          while (when !== null && gen === this.generation && when - this.ctx.currentTime > LOOKAHEAD) await sleep(50);
        }
      }
      if (gen === this.generation) flush();
    } catch (err) {
      console.warn('[kinora] audio decode error', err);
    }
  }

  private ctxTimeFor(t: number) { return this.anchorCtx + (t - this.anchorT); }

  /** Re-applies volume / fade envelopes; called every animation frame while playing. */
  updateGains(t: number) {
    for (const [id, g] of this.gains) {
      const found = store.findViewClip(id);
      const v = found && !found.track.muted ? audioGain(found.clip, t) : 0;
      g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015);
    }
  }

  stop() {
    this.generation++;
    for (const n of this.nodes) { try { n.stop(); } catch { /* already stopped */ } n.disconnect(); }
    this.nodes.clear();
    for (const g of this.gains.values()) g.disconnect();
    this.gains.clear();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
