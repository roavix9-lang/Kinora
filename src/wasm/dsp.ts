import wasmUrl from './kinora.wasm?url';

interface DspExports {
  memory: WebAssembly.Memory;
  HEAP_BASE: WebAssembly.Global;
  downmix(dst: number, a: number, b: number, len: number): void;
  peaks(src: number, len: number, bucket: number, dst: number): number;
  mixResample(
    dst: number, dstLen: number, src: number, srcLen: number,
    srcStart: number, rate: number, gain: number,
    clipOffset: number, clipLen: number, fadeIn: number, fadeOut: number,
  ): void;
  limit(buf: number, len: number): void;
}

let wasm: DspExports | null = null;

export async function initDsp(): Promise<boolean> {
  try {
    // Small modules get inlined as data: URLs by Vite, which may lack the
    // application/wasm MIME type that instantiateStreaming requires.
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {
      env: { abort: () => { throw new Error('wasm abort'); } },
    });
    wasm = instance.exports as unknown as DspExports;
    return true;
  } catch (err) {
    console.warn('[kinora] WebAssembly DSP unavailable, using JS fallback', err);
    return false;
  }
}

export const dspBackend = () => (wasm ? 'WebAssembly' : 'JavaScript');

/** Bump allocator over WASM linear memory; reset after every call. */
class Arena {
  private top = 0;
  constructor(private w: DspExports) { this.reset(); }
  reset() { this.top = ((this.w.HEAP_BASE.value as number) + 15) & ~15; }
  alloc(floats: number): number {
    const ptr = this.top;
    this.top += ((floats * 4 + 15) & ~15);
    const need = this.top - this.w.memory.buffer.byteLength;
    if (need > 0) this.w.memory.grow(Math.ceil(need / 65536));
    return ptr;
  }
  view(ptr: number, len: number) { return new Float32Array(this.w.memory.buffer, ptr, len); }
}

let arena: Arena | null = null;
const getArena = () => (arena ??= new Arena(wasm!));

/** Mono mixdown of an AudioBuffer's channels. */
export function toMono(buf: AudioBuffer): Float32Array {
  const len = buf.length;
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const a = buf.getChannelData(0);
  const b = buf.getChannelData(1);
  if (!wasm) {
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = (a[i] + b[i]) * 0.5;
    return out;
  }
  const ar = getArena();
  ar.reset();
  const pa = ar.alloc(len); ar.view(pa, len).set(a);
  const pb = ar.alloc(len); ar.view(pb, len).set(b);
  const pd = ar.alloc(len);
  wasm.downmix(pd, pa, pb, len);
  return ar.view(pd, len).slice();
}

/** Max-abs peak per bucket. */
export function computePeaks(samples: Float32Array, bucket: number): Float32Array {
  const len = samples.length;
  const count = Math.ceil(len / Math.max(1, bucket));
  if (!wasm) {
    const out = new Float32Array(count);
    for (let n = 0, s = 0; s < len; s += bucket, n++) {
      let m = 0;
      for (let i = s, e = Math.min(s + bucket, len); i < e; i++) { const v = Math.abs(samples[i]); if (v > m) m = v; }
      out[n] = m;
    }
    return out;
  }
  const ar = getArena();
  ar.reset();
  const ps = ar.alloc(len); ar.view(ps, len).set(samples);
  const pd = ar.alloc(count);
  const n = wasm.peaks(ps, len, bucket, pd);
  return ar.view(pd, n).slice();
}

export interface MixJob {
  src: Float32Array;
  /** First destination sample this job writes to. */
  dstOffset: number;
  srcStart: number;
  rate: number;
  gain: number;
  clipOffset: number;
  clipLen: number;
  fadeIn: number;
  fadeOut: number;
}

/** Mixes resampled sources into `dst` (in place), then soft-limits. */
export function mixInto(dst: Float32Array, jobs: MixJob[]) {
  const dstLen = dst.length;
  if (!wasm) {
    for (const j of jobs) {
      const n = dstLen - j.dstOffset;
      for (let i = 0; i < n; i++) {
        const pos = j.srcStart + i * j.rate;
        if (pos < 0) continue;
        const i0 = pos | 0;
        if (i0 >= j.src.length) break;
        const f = pos - i0;
        const s0 = j.src[i0];
        const s1 = i0 + 1 < j.src.length ? j.src[i0 + 1] : s0;
        let env = j.gain;
        const k = j.clipOffset + i;
        if (j.fadeIn > 0 && k < j.fadeIn) env *= k / j.fadeIn;
        const rem = j.clipLen - k;
        if (j.fadeOut > 0 && rem < j.fadeOut) env *= Math.max(rem, 0) / j.fadeOut;
        dst[j.dstOffset + i] += (s0 + (s1 - s0) * f) * env;
      }
    }
    for (let i = 0; i < dstLen; i++) {
      const v = dst[i], a = Math.abs(v);
      if (a > 0.8) { const o = (a - 0.8) / 0.2; const s = 0.8 + 0.2 * (o / (1 + o)); dst[i] = v < 0 ? -s : s; }
    }
    return;
  }
  const ar = getArena();
  ar.reset();
  const pd = ar.alloc(dstLen);
  ar.view(pd, dstLen).set(dst);
  for (const j of jobs) {
    const ps = ar.alloc(j.src.length);
    ar.view(ps, j.src.length).set(j.src);
    wasm.mixResample(pd + j.dstOffset * 4, dstLen - j.dstOffset, ps, j.src.length, j.srcStart, j.rate, j.gain, j.clipOffset, j.clipLen, j.fadeIn, j.fadeOut);
  }
  wasm.limit(pd, dstLen);
  dst.set(ar.view(pd, dstLen));
}
