import { MediaItem } from '../types';

// What importing a file works out (size, codec, timeline thumbnails, poster, waveform) is kept
// in IndexedDB, keyed by the file itself. Reopening a project then restores it in a moment
// instead of decoding every video again.

const DB_NAME = 'kinora-media-cache';
const STORE = 'analysis';

interface Saved {
  kind: MediaItem['kind'];
  duration: number;
  width: number;
  height: number;
  rotation: number;
  hasAudio: boolean;
  hasVideo: boolean;
  codec: string;
  fps: number;
  thumbInterval: number;
  peaksPerSecond: number;
  peaks?: Float32Array;
  peakScale?: number;
  thumbs: Blob[];
  poster?: Blob;
}

let dbp: Promise<IDBDatabase> | null = null;
function db() {
  dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

/** Same id and same bytes (size + modified time): a replaced file is analysed again. */
const keyOf = (m: MediaItem) => `${m.id}|${m.file.size}|${m.file.lastModified}`;

async function get(key: string): Promise<Saved | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as Saved | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function toBlob(bmp: ImageBitmap) {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  return c.convertToBlob({ type: 'image/webp', quality: 0.75 });
}

/** Stores a freshly imported item's analysis (best effort; never blocks the import). */
export async function saveAnalysis(m: MediaItem) {
  if (m.sample || m.kind === 'image' || m.status !== 'ready') return;
  try {
    const saved: Saved = {
      kind: m.kind, duration: m.duration, width: m.width, height: m.height, rotation: m.rotation,
      hasAudio: m.hasAudio, hasVideo: m.hasVideo, codec: m.codec, fps: m.fps,
      thumbInterval: m.thumbInterval, peaksPerSecond: m.peaksPerSecond, peaks: m.peaks, peakScale: m.peakScale,
      thumbs: await Promise.all(m.thumbs.map(toBlob)),
      poster: m.poster ? await toBlob(m.poster) : undefined,
    };
    const d = await db();
    d.transaction(STORE, 'readwrite').objectStore(STORE).put(saved, keyOf(m));
  } catch { /* storage full or unavailable: it's only a speed-up */ }
}

/** Fills an item from its saved analysis; false when there is none. */
export async function restoreAnalysis(m: MediaItem): Promise<boolean> {
  if (m.kind === 'image') return false;
  try {
    const s = await get(keyOf(m));
    if (!s) return false;
    const thumbs = await Promise.all(s.thumbs.map((b) => createImageBitmap(b)));
    Object.assign(m, {
      kind: s.kind, duration: s.duration, width: s.width, height: s.height, rotation: s.rotation,
      hasAudio: s.hasAudio, hasVideo: s.hasVideo, codec: s.codec, fps: s.fps,
      thumbInterval: s.thumbInterval, peaksPerSecond: s.peaksPerSecond, peaks: s.peaks, peakScale: s.peakScale,
      thumbs, poster: s.poster ? await createImageBitmap(s.poster) : undefined,
    });
    return true;
  } catch {
    return false;
  }
}

/** Forgets a media item's analysis (e.g. after relinking it to another file). */
export async function dropAnalysis(m: MediaItem) {
  try { (await db()).transaction(STORE, 'readwrite').objectStore(STORE).delete(keyOf(m)); } catch { /* ignore */ }
}
