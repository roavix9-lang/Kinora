import { store } from '../store';
import { MediaItem } from '../types';

// The two bundled sample photos as hidden media items. Template previews use them, and
// template clips show them in slots the user hasn't replaced yet.

const PHOTOS = ['samples/person-1-full.jpg?v=1', 'samples/person-2-full.jpg?v=1'];
const samples: MediaItem[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export const sampleId = (i: number) => `__sample_${i % PHOTOS.length}`;
export const samplesReady = () => samples.length === PHOTOS.length && samples.every(Boolean);
export const sampleMedia = (i: number): MediaItem | undefined => samples[i % PHOTOS.length];
export function onSamplesReady(fn: () => void) { listeners.add(fn); }

export function loadSamples(): Promise<void> {
  loading ??= Promise.all(PHOTOS.map(async (src, i) => {
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}${src}`;
    await img.decode();
    const bitmap = await createImageBitmap(img);
    const thumbH = 160;
    const thumb = await createImageBitmap(bitmap, { resizeHeight: thumbH, resizeWidth: Math.round((bitmap.width / bitmap.height) * thumbH), resizeQuality: 'high' });
    const item: MediaItem = {
      id: sampleId(i), kind: 'image', name: `Sample ${i + 1}`, file: new File([], `sample-${i}.jpg`),
      duration: 5, width: bitmap.width, height: bitmap.height, rotation: 0, hasAudio: false, hasVideo: true,
      codec: '', fps: 0, thumbs: [thumb], poster: thumb, thumbInterval: Infinity, peaksPerSecond: 50, bitmap,
      status: 'ready', deleted: true, sample: true,
    };
    store.media.set(item.id, item);
    samples[i] = item;
  })).then(() => {
    listeners.forEach((fn) => fn());
    // Template clips on the timeline / in the player can draw now.
    store.emit('media');
  });
  return loading;
}
