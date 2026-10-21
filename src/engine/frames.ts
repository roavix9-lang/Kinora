import { VideoSample, VideoSampleSink } from 'mediabunny';
import { store } from '../store';
import { getDemuxed } from './media';

/** How far ahead (seconds) a sequential read may decode forward before a hard seek is cheaper. */
const SEQUENTIAL_WINDOW = 2.5;

/**
 * Frame-accurate WebCodecs reader for one clip.
 *
 * Two access modes:
 *  - sequential (playback / export): a long-lived decode iterator that only moves forward;
 *  - random (scrubbing): one-shot `getSample` seeks, which decode from the previous key frame.
 */
export class FrameReader {
  current: VideoSample | null = null;
  /** Called after an asynchronous request() lands a new frame. */
  onFrame: (() => void) | null = null;
  private sink: VideoSampleSink;
  private iter: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private lookahead: VideoSample | null = null;
  private running: Promise<void> | null = null;
  private wanted: { t: number; seq: boolean } | null = null;
  private disposed = false;

  constructor(mediaId: string) {
    const d = getDemuxed(mediaId);
    if (!d?.video) throw new Error('No decodable video track');
    this.sink = new VideoSampleSink(d.video, { hardwareAcceleration: store.hwDecode ? 'prefer-hardware' : 'prefer-software' });
  }

  /** Non-blocking: schedules a decode toward `t` and returns whatever frame is ready now. */
  request(t: number, sequential: boolean): VideoSample | null {
    if (!this.covers(t)) {
      this.wanted = { t, seq: sequential };
      if (!this.running) this.running = this.pump();
    }
    return this.current;
  }

  /** Blocking variant used by export: resolves once the frame covering `t` is decoded. */
  async frameAt(t: number): Promise<VideoSample | null> {
    while (this.running) await this.running;
    if (!this.covers(t)) await this.advance(t, true);
    return this.current;
  }

  private covers(t: number) {
    const c = this.current;
    if (!c) return false;
    const end = c.timestamp + Math.max(c.duration, 1 / 240);
    return t >= c.timestamp - 1e-4 && t < end - 1e-4;
  }

  private async pump() {
    try {
      while (this.wanted && !this.disposed) {
        const { t, seq } = this.wanted;
        this.wanted = null;
        const before = this.current;
        await this.advance(t, seq);
        if (this.current !== before) this.onFrame?.();
      }
    } catch (err) {
      console.warn('[kinora] decode error', err);
    } finally {
      this.running = null;
    }
  }

  private async advance(t: number, sequential: boolean) {
    const cur = this.current;
    const canStep = sequential && this.iter && cur && t >= cur.timestamp && t - cur.timestamp < SEQUENTIAL_WINDOW;
    if (canStep) {
      for (;;) {
        let next = this.lookahead;
        this.lookahead = null;
        if (!next) {
          const r = await this.iter!.next();
          if (r.done || this.disposed) { r.value && (r.value as VideoSample).close(); return; }
          next = r.value;
        }
        if (next.timestamp <= t + 1e-4) {
          this.replace(next);
          continue;
        }
        this.lookahead = next;
        return;
      }
    }
    await this.resetIter();
    if (sequential) {
      this.iter = this.sink.samples(Math.max(0, t));
      const r = await this.iter.next();
      if (!r.done && !this.disposed) this.replace(r.value);
    } else {
      const s = await this.sink.getSample(Math.max(0, t));
      if (s && !this.disposed) this.replace(s);
      else s?.close();
    }
  }

  private replace(s: VideoSample) {
    if (this.current && this.current !== s) this.current.close();
    this.current = s;
  }

  private async resetIter() {
    this.lookahead?.close();
    this.lookahead = null;
    if (this.iter) {
      const it = this.iter;
      this.iter = null;
      await it.return(undefined).catch(() => {});
    }
  }

  dispose() {
    this.disposed = true;
    this.wanted = null;
    void this.resetIter();
    this.current?.close();
    this.current = null;
  }
}
