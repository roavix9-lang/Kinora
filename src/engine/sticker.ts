import { stickerById, stickerDataUrl } from '../stickers';
import { StickerRef } from '../types';

/** Longest side of a sticker at scale 1, in pixels at the 1080p reference height. */
export const STICKER_BASE = 420;

interface Raster { canvas: OffscreenCanvas | HTMLCanvasElement; width: number; height: number; key: string }

const images = new Map<string, HTMLImageElement>();
const rasters = new Map<string, Raster>();
let onLoaded: (() => void) | null = null;

export function setStickerLoadedHandler(fn: () => void) { onLoaded = fn; }

function image(url: string): HTMLImageElement | null {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.onload = () => onLoaded?.();
    img.src = url;
    images.set(url, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

/** Logical size (project px) for a sticker at scale 1. */
export function stickerSize(ref: StickerRef, projectH: number): [number, number] {
  const def = stickerById(ref.id);
  if (!def) return [100, 100];
  const k = (STICKER_BASE * projectH) / 1080 / Math.max(def.w, def.h);
  return [def.w * k, def.h * k];
}

/** Rasterises the sticker so its longest side is `px` pixels; vector source keeps it sharp at 4K. */
export function renderSticker(ref: StickerRef, px: number): Raster | null {
  const def = stickerById(ref.id);
  if (!def) return null;
  px = Math.max(8, Math.min(4096, Math.round(px)));
  const key = `${ref.id}|${ref.color}|${px}`;
  const hit = rasters.get(key);
  if (hit) return hit;
  const img = image(stickerDataUrl(def, ref.color));
  if (!img) return null;
  const k = px / Math.max(def.w, def.h);
  const w = Math.max(1, Math.round(def.w * k));
  const h = Math.max(1, Math.round(def.h * k));
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(img, 0, 0, w, h);
  const r = { canvas, width: w, height: h, key };
  rasters.set(key, r);
  if (rasters.size > 120) rasters.delete(rasters.keys().next().value!);
  return r;
}
