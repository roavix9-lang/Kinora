/// <reference lib="webworker" />
// Voice isolation off the main thread: Demucs (htdemucs, MIT) via onnxruntime-web,
// WebGPU when available, WASM otherwise. Input/output: 44.1 kHz stereo Float32Arrays.
import * as ort from 'onnxruntime-web';
import { DemucsProcessor } from 'demucs-web';

const ORT_VERSION = '1.30.0';
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
// Threads need cross-origin isolation (SharedArrayBuffer); fall back to one thread without it.
if (!self.crossOriginIsolated) ort.env.wasm.numThreads = 1;

type In = { type: 'separate'; id: number; model: ArrayBuffer; left: Float32Array; right: Float32Array };

let processor: DemucsProcessor | null = null;

self.onmessage = async (e: MessageEvent<In>) => {
  const msg = e.data;
  if (msg.type !== 'separate') return;
  try {
    if (!processor) {
      processor = new DemucsProcessor({
        ort,
        onProgress: ({ progress }: { progress: number }) => self.postMessage({ type: 'progress', id: msg.id, progress }),
      });
      await processor.loadModel(msg.model);
    }
    const r = await processor.separate(msg.left, msg.right);
    // "Music" = everything except the voice.
    const n = r.vocals.left.length;
    const ml = new Float32Array(n), mr = new Float32Array(n);
    for (const k of ['drums', 'bass', 'other'] as const) {
      const t = r[k];
      for (let i = 0; i < n; i++) { ml[i] += t.left[i]; mr[i] += t.right[i]; }
    }
    const out = { type: 'done', id: msg.id, vl: r.vocals.left, vr: r.vocals.right, ml, mr };
    self.postMessage(out, [out.vl.buffer, out.vr.buffer, ml.buffer, mr.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
