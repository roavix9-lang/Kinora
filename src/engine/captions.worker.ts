/// <reference lib="webworker" />
// Speech-to-text worker: runs Whisper locally via Transformers.js (WebGPU when available,
// otherwise WebAssembly). Audio never leaves the device; the model is downloaded once
// from Hugging Face and cached by the browser.
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

export interface WorkerRequest {
  audio: Float32Array; // 16 kHz mono
  windows: { start: number; end: number }[]; // seconds, each ≤ 30 s
  model: string;
  language: string; // 'auto' or a Whisper language name, e.g. 'english'
  tasks: ('transcribe' | 'translate')[];
}

export type WorkerMessage =
  | { type: 'download'; progress: number }
  | { type: 'ready'; device: string }
  | { type: 'progress'; progress: number }
  | { type: 'result'; segments: Record<string, Segment[]> }
  | { type: 'error'; message: string };

export interface Segment { text: string; start: number; end: number }

const RATE = 16000;
let loaded: { model: string; asr: Promise<AutomaticSpeechRecognitionPipeline>; device: string } | null = null;
const post = (m: WorkerMessage) => (self as DedicatedWorkerGlobalScope).postMessage(m);

async function hasWebGPU() {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function load(model: string) {
  if (loaded?.model === model) return loaded;
  const device = (await hasWebGPU()) ? 'webgpu' : 'wasm';
  const asr = pipeline('automatic-speech-recognition', model, {
    device,
    // fp32 encoder + 4-bit decoder is the recommended WebGPU mix; 8-bit for WASM.
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: (p) => { if (p.status === 'progress_total') post({ type: 'download', progress: p.progress }); },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  loaded = { model, asr, device };
  return loaded;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { audio, windows, model, language, tasks } = e.data;
  try {
    const l = await load(model);
    const asr = await l.asr;
    post({ type: 'ready', device: l.device });
    const out: Record<string, Segment[]> = {};
    const steps = windows.length * tasks.length;
    let done = 0;
    for (const task of tasks) {
      const segs: Segment[] = [];
      for (const w of windows) {
        const slice = audio.subarray(Math.floor(w.start * RATE), Math.ceil(w.end * RATE));
        const res = await asr(slice, {
          return_timestamps: true,
          task,
          ...(language !== 'auto' ? { language } : {}),
        });
        const r = Array.isArray(res) ? res[0] : res;
        for (const c of r.chunks ?? [{ text: r.text, timestamp: [0, w.end - w.start] as [number, number] }]) {
          const text = c.text.trim();
          if (!text) continue;
          const start = w.start + (c.timestamp[0] ?? 0);
          const end = w.start + (c.timestamp[1] ?? (w.end - w.start));
          segs.push({ text, start, end: Math.max(end, start + 0.2) });
        }
        post({ type: 'progress', progress: ++done / steps });
      }
      out[task] = segs;
    }
    post({ type: 'result', segments: out });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
