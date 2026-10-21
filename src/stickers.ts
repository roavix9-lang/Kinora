/**
 * Vector sticker library. Every sticker is an SVG so it rasterises crisply at any
 * output size (including 4K). `{{c}}` is replaced by the user-chosen colour for
 * recolourable stickers.
 */
export interface StickerDef {
  id: string;
  name: string;
  category: string;
  w: number;
  h: number;
  /** Default fill colour; present only when the sticker can be recoloured. */
  color?: string;
  body: string;
}

// The sticker library is served from R2 (see src/engine/assets.ts); downloaded stickers register here.
export const STICKER_CATEGORIES = ['Shapes', 'Arrows', 'Badges', 'Social', 'Speech', 'Emotes'];

export const STICKERS: StickerDef[] = [];

export function registerSticker(def: StickerDef) {
  const at = STICKERS.findIndex((s) => s.id === def.id);
  if (at >= 0) STICKERS[at] = def; else STICKERS.push(def);
}

export const stickerById = (id: string) => STICKERS.find((s) => s.id === id);

export function stickerSvg(def: StickerDef, color?: string): string {
  const body = def.body.replaceAll('{{c}}', color ?? def.color ?? '#ffffff');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${def.w} ${def.h}" width="${def.w}" height="${def.h}">${body}</svg>`;
}

export const stickerDataUrl = (def: StickerDef, color?: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(stickerSvg(def, color))}`;
