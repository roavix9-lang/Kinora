import { store } from '../store';

// Photos used by filter / effect / transition thumbnails (bundled in public/samples,
// Unsplash License; see public/samples/CREDITS.md).

export const SAMPLE_W = 192;
export const SAMPLE_H = 108;

const SOURCES = ['samples/person-1.jpg?v=2', 'samples/person-2.jpg?v=2'];

const frames: (HTMLCanvasElement | null)[] = [null, null];
let started = false;

function blank() {
  const c = document.createElement('canvas');
  c.width = SAMPLE_W;
  c.height = SAMPLE_H;
  const x = c.getContext('2d')!;
  x.fillStyle = '#26262b';
  x.fillRect(0, 0, SAMPLE_W, SAMPLE_H);
  return c;
}

/** Draws a photo to fill the sample frame (crop to cover). */
function toFrame(img: HTMLImageElement) {
  const c = blank();
  const x = c.getContext('2d')!;
  const s = Math.max(SAMPLE_W / img.naturalWidth, SAMPLE_H / img.naturalHeight);
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, (SAMPLE_W - w) / 2, (SAMPLE_H - h) / 2, w, h);
  return c;
}

function load() {
  if (started) return;
  started = true;
  SOURCES.forEach((src, i) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      frames[i] = toFrame(img);
      // Thumbnail panels refresh on 'media'; redraw them now that the photo is ready.
      store.emit('media');
    };
    img.src = `${import.meta.env.BASE_URL}${src}`;
  });
}

const placeholder = blank();

/** The two pictures [from, to] used for previews, and a key that changes once they load. */
export function samplePair(): { key: string; from: HTMLCanvasElement; to: HTMLCanvasElement } {
  load();
  return {
    key: `photos-${frames[0] ? 1 : 0}${frames[1] ? 1 : 0}`,
    from: frames[0] ?? placeholder,
    to: frames[1] ?? frames[0] ?? placeholder,
  };
}
