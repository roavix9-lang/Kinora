import { store } from '../store';
import { Clip } from '../types';
import { toast } from '../ui/dom';
import { audioBuffers } from './media';

// Isolate voice (CapCut): splits a file's audio once into "vocals" and "music" with an AI
// model running in the browser, then plays / exports the part the clip asks for. Results are
// kept in IndexedDB so a file is only processed once, even across reloads.

const RATE = 44100;
const MODEL_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
const MODEL_CACHE = 'kinora-models-v1';

interface Stems { vocals: AudioBuffer; music: AudioBuffer }
const stems = new Map<string, Stems>();
const jobs = new Map<string, Promise<Stems | null>>();
const progress = new Map<string, number>();
const listeners = new Set<() => void>();
export const onIsolateChanged = (fn: () => void) => { listeners.add(fn); };
const changed = () => listeners.forEach((fn) => fn());

export const isolateProgress = (mediaId: string) => progress.get(mediaId);
export const stemsReady = (mediaId: string) => stems.has(mediaId);

// ---- storage ----------------------------------------------------------------------

let dbp: Promise<IDBDatabase> | null = null;
function db() {
  dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('kinora-stems', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('stems');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
type Saved = { vl: Float32Array; vr: Float32Array; ml: Float32Array; mr: Float32Array };
async function load(mediaId: string): Promise<Saved | undefined> {
  const d = await db();
  return new Promise((resolve) => {
    const r = d.transaction('stems').objectStore('stems').get(mediaId);
    r.onsuccess = () => resolve(r.result as Saved | undefined);
    r.onerror = () => resolve(undefined);
  });
}
async function save(mediaId: string, s: Saved) {
  const d = await db();
  await new Promise<void>((resolve) => {
    const t = d.transaction('stems', 'readwrite');
    t.objectStore('stems').put(s, mediaId);
    t.oncomplete = () => resolve();
    t.onerror = () => resolve();
  });
}

const toBuffer = (l: Float32Array, r: Float32Array) => {
  const b = new AudioBuffer({ length: l.length, numberOfChannels: 2, sampleRate: RATE });
  b.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
  b.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
  return b;
};

// ---- processing ---------------------------------------------------------------------

/** The file's whole soundtrack as 44.1 kHz stereo. */
async function decodeAll(mediaId: string): Promise<{ left: Float32Array; right: Float32Array } | null> {
  const m = store.media.get(mediaId);
  if (!m) return null;
  const parts: AudioBuffer[] = [];
  for await (const { buffer } of audioBuffers(mediaId, 0, m.duration + 1)) parts.push(buffer);
  if (!parts.length) return null;
  const srcRate = parts[0].sampleRate;
  const total = parts.reduce((n, b) => n + b.length, 0);
  const off = new OfflineAudioContext(2, Math.ceil((total / srcRate) * RATE), RATE);
  const joined = off.createBuffer(2, total, srcRate);
  let o = 0;
  for (const b of parts) {
    for (let ch = 0; ch < 2; ch++) joined.getChannelData(ch).set(b.getChannelData(Math.min(ch, b.numberOfChannels - 1)), o);
    o += b.length;
  }
  const src = off.createBufferSource();
  src.buffer = joined;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return { left: out.getChannelData(0).slice(), right: out.getChannelData(1).slice() };
}

/** The AI model, downloaded once and kept in Cache Storage for offline use. */
async function modelBytes(): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try { cache = await caches.open(MODEL_CACHE); } catch { /* storage blocked */ }
  const hit = await cache?.match(MODEL_URL);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed (HTTP ${res.status})`);
  await cache?.put(MODEL_URL, res.clone());
  return res.arrayBuffer();
}

let worker: Worker | null = null;
let nextId = 1;

/** Separates a file into vocals + music (cached). Resolves null if it couldn't. */
export function ensureStems(mediaId: string): Promise<Stems | null> {
  const have = stems.get(mediaId);
  if (have) return Promise.resolve(have);
  const running = jobs.get(mediaId);
  if (running) return running;
  const job = (async () => {
    try {
      const saved = await load(mediaId);
      if (saved) {
        const s = { vocals: toBuffer(saved.vl, saved.vr), music: toBuffer(saved.ml, saved.mr) };
        stems.set(mediaId, s);
        return s;
      }
      progress.set(mediaId, 0); changed();
      const firstRun = !(await caches.open(MODEL_CACHE).then((c) => c.match(MODEL_URL)).catch(() => undefined));
      toast(firstRun ? 'Isolating voice… the first time downloads the AI model (about 170 MB).' : 'Isolating voice…');
      const [audio, model] = await Promise.all([decodeAll(mediaId), modelBytes()]);
      if (!audio) throw new Error('This clip has no sound');
      worker ??= new Worker(new URL('./isolate.worker.ts', import.meta.url), { type: 'module' });
      const id = nextId++;
      const result = await new Promise<Saved>((resolve, reject) => {
        const w = worker!;
        const onMsg = (e: MessageEvent) => {
          if (e.data.id !== id) return;
          if (e.data.type === 'progress') { progress.set(mediaId, e.data.progress); changed(); return; }
          w.removeEventListener('message', onMsg);
          if (e.data.type === 'done') resolve(e.data as Saved);
          else reject(new Error(e.data.message));
        };
        w.addEventListener('message', onMsg);
        w.postMessage({ type: 'separate', id, model, left: audio.left, right: audio.right }, [model, audio.left.buffer, audio.right.buffer]);
      });
      const s = { vocals: toBuffer(result.vl, result.vr), music: toBuffer(result.ml, result.mr) };
      stems.set(mediaId, s);
      void save(mediaId, result);
      toast('Voice isolated', 'ok');
      return s;
    } catch (err) {
      toast(`Couldn't isolate the voice: ${err instanceof Error ? err.message : String(err)}`, 'error');
      return null;
    } finally {
      jobs.delete(mediaId);
      progress.delete(mediaId);
      changed();
      store.emit('project');
    }
  })();
  jobs.set(mediaId, job);
  return job;
}

/**
 * The audio a clip actually plays: the isolated part when "Remove vocal" / "Keep vocal" is on
 * and ready, otherwise the original soundtrack.
 */
export async function* clipAudioBuffers(clip: Clip, start: number, end: number): AsyncGenerator<{ buffer: AudioBuffer; timestamp: number }> {
  const s = clip.isolate && clip.mediaId ? stems.get(clip.mediaId) : undefined;
  if (!s || !clip.mediaId) { yield* audioBuffers(clip.mediaId!, start, end); return; }
  const full = clip.isolate === 'keep' ? s.vocals : s.music;
  const s0 = Math.max(0, Math.floor(start * RATE)), s1 = Math.min(full.length, Math.ceil(end * RATE));
  if (s1 <= s0) return;
  // Hand it out in ~1 s pieces, like the decoder does.
  for (let a = s0; a < s1; a += RATE) {
    const b = Math.min(s1, a + RATE);
    const slice = new AudioBuffer({ length: b - a, numberOfChannels: 2, sampleRate: RATE });
    for (let ch = 0; ch < 2; ch++) slice.copyToChannel(full.getChannelData(ch).subarray(a, b), ch);
    yield { buffer: slice, timestamp: a / RATE };
  }
}

/** Sets a clip's Isolate voice mode, separating the file first if needed. */
export function setIsolate(clipId: string, mode: Clip['isolate']) {
  const found = store.findClip(clipId);
  if (!found) return;
  store.commit(() => { found.clip.isolate = mode; });
  if (mode && found.clip.mediaId) void ensureStems(found.clip.mediaId);
}

/** Loads saved stems for clips that use isolation (after a reload). */
export function initIsolate() {
  const scan = () => {
    for (const t of store.project.tracks) for (const c of t.clips) {
      if (c.isolate && c.mediaId && !stems.has(c.mediaId) && !jobs.has(c.mediaId) && store.media.get(c.mediaId)?.status === 'ready') void ensureStems(c.mediaId);
    }
  };
  store.on('project', scan);
  store.on('media', scan);
}
