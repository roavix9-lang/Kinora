// Kinora DSP core, compiled to WebAssembly with AssemblyScript.
// All buffers are planar Float32 arrays living in linear memory; the JS side
// owns the layout and passes byte offsets.

export const HEAP_BASE: usize = __heap_base;

/** dst[i] = (a[i] + b[i]) * 0.5 */
export function downmix(dst: usize, a: usize, b: usize, len: i32): void {
  for (let i = 0; i < len; i++) {
    const o = <usize>i << 2;
    store<f32>(dst + o, (load<f32>(a + o) + load<f32>(b + o)) * 0.5);
  }
}

/** Writes the peak absolute amplitude of each `bucket`-sized window into dst. Returns the bucket count. */
export function peaks(src: usize, len: i32, bucket: i32, dst: usize): i32 {
  if (bucket < 1) bucket = 1;
  let n = 0;
  for (let start = 0; start < len; start += bucket) {
    const end = min(start + bucket, len);
    let m: f32 = 0;
    for (let i = start; i < end; i++) {
      const v = abs<f32>(load<f32>(src + (<usize>i << 2)));
      if (v > m) m = v;
    }
    store<f32>(dst + (<usize>n << 2), m);
    n++;
  }
  return n;
}

/**
 * Mixes `src` into `dst` with linear-interpolated resampling.
 * dst[i] += src[srcStart + i * rate] * gain * envelope(i)
 * The envelope applies a linear fade over the first `fadeIn` and last `fadeOut`
 * samples of the clip, where `clipOffset` is the position of dst[0] inside the
 * clip and `clipLen` is the clip's total length in output samples.
 */
export function mixResample(
  dst: usize, dstLen: i32,
  src: usize, srcLen: i32,
  srcStart: f64, rate: f64, gain: f32,
  clipOffset: i32, clipLen: i32, fadeIn: i32, fadeOut: i32,
): void {
  for (let i = 0; i < dstLen; i++) {
    const pos = srcStart + <f64>i * rate;
    if (pos < 0) continue;
    const i0 = <i32>pos;
    if (i0 >= srcLen) break;
    const frac = <f32>(pos - <f64>i0);
    const s0 = load<f32>(src + (<usize>i0 << 2));
    const s1 = i0 + 1 < srcLen ? load<f32>(src + (<usize>(i0 + 1) << 2)) : s0;
    let env: f32 = gain;
    const k = clipOffset + i;
    if (fadeIn > 0 && k < fadeIn) env *= <f32>k / <f32>fadeIn;
    const rem = clipLen - k;
    if (fadeOut > 0 && rem < fadeOut) env *= <f32>max(rem, 0) / <f32>fadeOut;
    const o = <usize>i << 2;
    store<f32>(dst + o, load<f32>(dst + o) + (s0 + (s1 - s0) * frac) * env);
  }
}

/** Soft limiter: transparent below the knee, smoothly saturating above it. */
export function limit(buf: usize, len: i32): void {
  const knee: f32 = 0.8;
  for (let i = 0; i < len; i++) {
    const o = <usize>i << 2;
    const v = load<f32>(buf + o);
    const a = abs<f32>(v);
    if (a > knee) {
      const over = (a - knee) / (1 - knee);
      const shaped = knee + (1 - knee) * (over / (1 + over));
      store<f32>(buf + o, v < 0 ? -shaped : shaped);
    }
  }
}
