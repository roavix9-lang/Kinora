export type MediaKind = 'video' | 'audio' | 'image';
/** 'effect' / 'filter' are adjustment layers: they process everything drawn below them. */
export type ClipType = 'video' | 'image' | 'audio' | 'text' | 'sticker' | 'effect' | 'filter' | 'template';
export type TrackKind = 'video' | 'audio' | 'text' | 'effect';

export interface Transform {
  /** Offset of the layer centre from the canvas centre, as a fraction of canvas width / height. */
  x: number;
  y: number;
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
  flipX: boolean;
}

export interface Adjust {
  brightness: number; // -1..1
  contrast: number; // -1..1
  saturation: number; // -1..1
  exposure: number; // -1..1
  temperature: number; // -1..1
  tint: number; // -1..1
  hue: number; // degrees -180..180
  vignette: number; // 0..1
  sharpen: number; // 0..1
  highlight?: number; // -1..1
  shadow?: number; // -1..1
  whites?: number; // -1..1
  blacks?: number; // -1..1
  brilliance?: number; // -1..1
  clarity?: number; // 0..1
  particles?: number; // 0..1 (film grain)
  fade?: number; // 0..1
}

/** Adjust › Basic › LUT (separate from the Filters look). */
export interface LutSetting { id: string; intensity: number; protectSkin: boolean }

/** Curve control points, x/y in 0..1, sorted by x, first x = 0 and last x = 1. */
export type CurvePoints = [number, number][];
export interface Curves { enabled: boolean; luma: CurvePoints; r: CurvePoints; g: CurvePoints; b: CurvePoints }

/** Colour wheel: [r, g, b] offset (-1..1) plus luminance l (-1..1). */
/** r, g, b colour push; l = brightness (right arc); s = saturation (left arc), optional for older projects. */
export type Wheel = [number, number, number, number, number?];
/** mode: 'primary' = lift/gamma/gain; 'log' = narrower tone ranges (CapCut's Log wheels). */
export interface ColorWheels { enabled: boolean; intensity: number; shadows: Wheel; mid: Wheel; high: Wheel; offset: Wheel; mode?: 'primary' | 'log' }

export type MaskShape = 'split' | 'filmstrip' | 'circle' | 'rectangle' | 'star' | 'heart';
/** Limits a clip's adjustments to an area (layer-relative: x/y centre and w/h in 0..1). */
/** x/y: centre in layer UV (0..1, y down). w/h/feather: units of the layer's short side. round: rectangle corners 0..1. */
export interface AdjustMask { enabled: boolean; type: MaskShape; x: number; y: number; w: number; h: number; rotation: number; feather: number; invert: boolean; round?: number }

export interface ChromaKey {
  enabled: boolean;
  color: string;
  similarity: number; // 0..1
  smoothness: number; // 0..1
}

export interface Look {
  id: string;
  intensity: number; // 0..1
}

export interface Transition {
  type: string;
  duration: number; // seconds
}

export interface TextStyle {
  content: string;
  font: string;
  size: number; // px at 1080p reference height
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  strokeColor: string;
  strokeWidth: number;
  background: string; // '' = none
  shadow: boolean;
  letterSpacing: number;
  lineHeight: number;
  /** Words drawn in `highlightColor` instead of `color` (auto-highlighted caption keywords). */
  highlightWords?: string[];
  highlightColor?: string;
  /** Custom shadow / glow (preset styles). Blur and offsets are fractions of the font size. */
  shadowColor?: string;
  shadowBlur?: number;
  shadowX?: number;
  shadowY?: number;
  /** Vertical text: characters stacked in columns, aligned to the top, middle or bottom. */
  vertical?: 'top' | 'middle' | 'bottom';
}

export interface Clip {
  id: string;
  type: ClipType;
  mediaId?: string;
  name: string;
  /** Timeline position, seconds. */
  start: number;
  /** Timeline duration, seconds (already accounts for speed). */
  duration: number;
  /** Source in-point, seconds. */
  in: number;
  speed: number;
  volume: number; // 0..2
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  transform: Transform;
  adjust: Adjust;
  chroma: ChromaKey;
  filter: Look;
  effect: Look;
  transitionIn: Transition;
  transitionOut: Transition;
  /** Combo animation (library id) across the clip; replaces In/Out while set. */
  combo?: Transition;
  text?: TextStyle;
  sticker?: StickerRef;
  /** Adjust tab extras (all optional; absent = neutral). */
  adjustOn?: boolean;
  lut?: LutSetting;
  hsl?: number[][];
  hslOn?: boolean;
  curves?: Curves;
  wheels?: ColorWheels;
  adjMask?: AdjustMask;
  /** Markers, as seconds from the clip's start. */
  markers?: number[];
  /** Deactivated (CapCut V): stays on the timeline but isn't seen or heard. */
  disabled?: boolean;
  /** Isolate voice: 'remove' plays the music only, 'keep' plays the voice only. */
  isolate?: 'remove' | 'keep';
  /** Extract audio: the audio clip taken out of this video (the video is then silent). */
  extractedTo?: string;
  /** Template clip: which template, and the media chosen for each slot (null = sample placeholder). */
  template?: { id: string; media: (string | null)[] };
  /** GL transition from the clip that ends where this one starts (same track), centred on the cut. */
  crossIn?: { type: string; duration: number };
  /** Set on clips created by Captions, so templates / SRT export / regenerate can find them. */
  caption?: boolean;
}

export interface StickerRef {
  id: string;
  /** Fill colour for recolourable stickers. */
  color: string;
}

export interface Track {
  id: string;
  kind: TrackKind;
  clips: Clip[];
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  main?: boolean;
  /** 'captions' marks the subtitle track created by the Captions tab. */
  role?: 'captions';
}

export interface Project {
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  /** Canvas ratio choice: 'original' (follows the first clip), 'custom', or a preset key like '16:9'. */
  ratio?: string;
  /** Short-edge resolution in px, or 'adapted' to follow the first video/photo. */
  resolution?: 'adapted' | number;
  /** Visual order: index 0 is the topmost row (rendered last / on top). */
  tracks: Track[];
  /** Timeline markers (seconds), shown on the ruler. */
  markers?: number[];
}

export interface MediaItem {
  /** Real level of the loudest peak (peaks are scaled so the loudest is 1). */
  peakScale?: number;
  /** Song / sound effect from the Audio library (kept in the offline cache, not the media bin). */
  library?: boolean;
  id: string;
  kind: MediaKind;
  name: string;
  file: File;
  duration: number;
  width: number;
  height: number;
  rotation: number;
  hasAudio: boolean;
  hasVideo: boolean;
  codec: string;
  fps: number;
  thumbs: ImageBitmap[];
  /** Larger first-frame still for the media bin. */
  poster?: ImageBitmap;
  thumbInterval: number;
  /** Peak amplitudes, `peaksPerSecond` values per second of source. */
  peaks?: Float32Array;
  peaksPerSecond: number;
  bitmap?: ImageBitmap;
  /** Media-bin folder; undefined = root. */
  folderId?: string;
  /** Removed from the bin; kept in memory so undo can bring its clips back. */
  deleted?: boolean;
  /** Built-in sample photo used only for template previews; never shown in the bin. */
  sample?: boolean;
  status: 'loading' | 'ready' | 'error';
  error?: string;
}

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 10)}`;

export const defaultTransform = (): Transform => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipX: false });
export const defaultAdjust = (): Adjust => ({
  brightness: 0, contrast: 0, saturation: 0, exposure: 0, temperature: 0, tint: 0, hue: 0, vignette: 0, sharpen: 0,
  highlight: 0, shadow: 0, whites: 0, blacks: 0, brilliance: 0, clarity: 0, particles: 0, fade: 0,
});
export const identityCurve = (): CurvePoints => [[0, 0], [1, 1]];
export const defaultCurves = (): Curves => ({ enabled: true, luma: identityCurve(), r: identityCurve(), g: identityCurve(), b: identityCurve() });
export const defaultWheels = (): ColorWheels => ({ enabled: true, intensity: 1, shadows: [0, 0, 0, 0], mid: [0, 0, 0, 0], high: [0, 0, 0, 0], offset: [0, 0, 0, 0] });
/** HSL: 8 colour bands × [hue, saturation, brightness], each -1..1. */
export const defaultHsl = (): number[][] => Array.from({ length: 8 }, () => [0, 0, 0]);
export const defaultMask = (type: MaskShape = 'circle'): AdjustMask => ({ enabled: true, type, x: 0.5, y: 0.5, w: 0.5, h: 0.5, rotation: 0, feather: 0.1, invert: false });
export const defaultChroma = (): ChromaKey => ({ enabled: false, color: '#00ff00', similarity: 0.35, smoothness: 0.1 });
export const noTransition = (): Transition => ({ type: 'none', duration: 0.5 });

export const defaultText = (over: Partial<TextStyle> = {}): TextStyle => ({
  content: 'Default text',
  font: 'Inter',
  size: 96,
  color: '#ffffff',
  bold: true,
  italic: false,
  align: 'center',
  strokeColor: '#000000',
  strokeWidth: 0,
  background: '',
  shadow: false,
  letterSpacing: 0,
  lineHeight: 1.2,
  ...over,
});

export function makeClip(type: ClipType, over: Partial<Clip> = {}): Clip {
  return {
    id: uid('clip'),
    type,
    name: type,
    start: 0,
    duration: 5,
    in: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transform: defaultTransform(),
    adjust: defaultAdjust(),
    chroma: defaultChroma(),
    filter: { id: 'none', intensity: 1 },
    effect: { id: 'none', intensity: 0.6 },
    transitionIn: noTransition(),
    transitionOut: noTransition(),
    ...over,
  };
}

export const clipEnd = (c: Clip) => c.start + c.duration;
/** Source time (seconds into the media file) for a timeline time inside the clip. */
export const sourceTime = (c: Clip, t: number) => c.in + (t - c.start) * c.speed;
export const isVisual = (c: Clip) => c.type !== 'audio';
export const isLayerFx = (c: Clip) => c.type === 'effect' || c.type === 'filter';
export const hasSound = (c: Clip, m?: MediaItem) => c.type === 'audio' || (c.type === 'video' && !!m?.hasAudio);
