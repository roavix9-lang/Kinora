import { FX } from './engine/fxlib';
import { TextStyle } from './types';

export interface LookDef { id: string; name: string; code: number; swatch: string }

/** Codes map to the switch in the compositor's fragment shader. */
export const FILTERS: LookDef[] = [
  { id: 'none', name: 'None', code: 0, swatch: 'linear-gradient(135deg,#3a3f47,#20242a)' },
  { id: 'vivid', name: 'Vivid', code: 1, swatch: 'linear-gradient(135deg,#ff5f6d,#ffc371)' },
  { id: 'bw', name: 'B&W', code: 2, swatch: 'linear-gradient(135deg,#eee,#333)' },
  { id: 'vintage', name: 'Vintage', code: 3, swatch: 'linear-gradient(135deg,#c9a66b,#6b4f2a)' },
  { id: 'cool', name: 'Cool', code: 4, swatch: 'linear-gradient(135deg,#83e0ff,#2a5f9e)' },
  { id: 'warm', name: 'Warm', code: 5, swatch: 'linear-gradient(135deg,#ffd29a,#d9622b)' },
  { id: 'film', name: 'Film', code: 6, swatch: 'linear-gradient(135deg,#b7c4a3,#4a5240)' },
  { id: 'teal-orange', name: 'Teal & Orange', code: 7, swatch: 'linear-gradient(135deg,#1fa2a6,#ff9a3c)' },
  { id: 'noir', name: 'Noir', code: 8, swatch: 'linear-gradient(135deg,#888,#000)' },
  { id: 'pastel', name: 'Pastel', code: 9, swatch: 'linear-gradient(135deg,#ffd1dc,#c1e1ff)' },
  { id: 'cyber', name: 'Cyber', code: 10, swatch: 'linear-gradient(135deg,#ff2bd6,#22e0ff)' },
  { id: 'golden', name: 'Golden hour', code: 11, swatch: 'linear-gradient(135deg,#ffe29f,#ff7e3c)' },
  { id: 'moody', name: 'Moody', code: 12, swatch: 'linear-gradient(135deg,#4b5d67,#1b1f24)' },
  { id: 'fade', name: 'Faded', code: 13, swatch: 'linear-gradient(135deg,#d7d2cc,#8e9eab)' },
];

export const EFFECTS: LookDef[] = [
  { id: 'none', name: 'None', code: 0, swatch: 'linear-gradient(135deg,#3a3f47,#20242a)' },
  { id: 'blur', name: 'Blur', code: 1, swatch: 'radial-gradient(circle,#9ab 0,#345 70%)' },
  { id: 'glitch', name: 'Glitch', code: 2, swatch: 'linear-gradient(90deg,#f0f 0 33%,#0ff 33% 66%,#ff0 66%)' },
  { id: 'grain', name: 'Film grain', code: 3, swatch: 'repeating-radial-gradient(circle,#777 0 1px,#444 1px 3px)' },
  { id: 'pixelate', name: 'Pixelate', code: 4, swatch: 'conic-gradient(#555 25%,#999 0 50%,#555 0 75%,#999 0)' },
  { id: 'invert', name: 'Invert', code: 5, swatch: 'linear-gradient(135deg,#fff,#00f)' },
  { id: 'mirror', name: 'Mirror', code: 6, swatch: 'linear-gradient(90deg,#456,#9ab 50%,#456)' },
  { id: 'vhs', name: 'VHS', code: 7, swatch: 'repeating-linear-gradient(0deg,#334 0 2px,#556 2px 4px)' },
  { id: 'flash', name: 'Flash', code: 8, swatch: 'radial-gradient(circle,#fff,#889 70%)' },
  { id: 'shake', name: 'Shake', code: 9, swatch: 'linear-gradient(100deg,#567,#234)' },
  { id: 'zoom-pulse', name: 'Zoom pulse', code: 10, swatch: 'radial-gradient(circle,#678 20%,#234 21% 40%,#678 41%)' },
  { id: 'rgb-split', name: 'RGB split', code: 11, swatch: 'linear-gradient(90deg,#f33,#3f3,#33f)' },
  { id: 'edge', name: 'Sketch', code: 12, swatch: 'linear-gradient(135deg,#fafafa,#999)' },
];

export const TRANSITIONS: { id: string; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'fade', name: 'Fade' },
  { id: 'zoom-in', name: 'Zoom in' },
  { id: 'zoom-out', name: 'Zoom out' },
  { id: 'slide-left', name: 'Slide left' },
  { id: 'slide-right', name: 'Slide right' },
  { id: 'slide-up', name: 'Slide up' },
  { id: 'slide-down', name: 'Slide down' },
  { id: 'wipe-left', name: 'Wipe left' },
  { id: 'wipe-right', name: 'Wipe right' },
  { id: 'blur', name: 'Blur' },
  { id: 'spin', name: 'Spin' },
];

export const FONTS = [
  'Inter', 'Montserrat', 'Bebas Neue', 'Oswald', 'Playfair Display', 'Pacifico',
  'Lobster', 'Permanent Marker', 'Roboto Mono', 'Anton', 'Caveat',
];

export const TEXT_PRESETS: { name: string; style: Partial<TextStyle>; css: string }[] = [
  { name: 'Default', style: {}, css: 'font:700 18px Inter;color:#fff' },
  { name: 'Title', style: { content: 'TITLE', font: 'Bebas Neue', size: 180, letterSpacing: 6 }, css: 'font:400 22px "Bebas Neue";letter-spacing:2px;color:#fff' },
  { name: 'Subtitle', style: { content: 'Subtitle text', font: 'Inter', size: 56, bold: false, background: 'rgba(0,0,0,0.6)' }, css: 'font:400 13px Inter;color:#fff;background:rgba(0,0,0,.6);padding:2px 6px' },
  { name: 'Outline', style: { content: 'OUTLINE', font: 'Anton', size: 150, color: '#ffffff', strokeColor: '#000000', strokeWidth: 10 }, css: 'font:400 20px Anton;color:#fff;-webkit-text-stroke:1.5px #000' },
  { name: 'Neon', style: { content: 'Neon', font: 'Pacifico', size: 130, color: '#ff4fd8', shadow: true }, css: 'font:400 20px Pacifico;color:#ff4fd8;text-shadow:0 0 8px #ff4fd8' },
  { name: 'Yellow pop', style: { content: 'WOW!', font: 'Anton', size: 160, color: '#ffe600', strokeColor: '#000', strokeWidth: 12 }, css: 'font:400 22px Anton;color:#ffe600;-webkit-text-stroke:1.5px #000' },
  { name: 'Elegant', style: { content: 'Elegant', font: 'Playfair Display', size: 120, italic: true, bold: false }, css: 'font:italic 400 20px "Playfair Display";color:#fff' },
  { name: 'Handwritten', style: { content: 'hello there', font: 'Caveat', size: 130, bold: false }, css: 'font:400 22px Caveat;color:#fff' },
  { name: 'Marker', style: { content: 'Marker', font: 'Permanent Marker', size: 120, color: '#7cf7ff', bold: false }, css: 'font:400 18px "Permanent Marker";color:#7cf7ff' },
  { name: 'Label', style: { content: 'LABEL', font: 'Montserrat', size: 64, color: '#111111', background: '#ffffff', letterSpacing: 4 }, css: 'font:700 12px Montserrat;color:#111;background:#fff;padding:3px 8px;letter-spacing:1px' },
  { name: 'Typewriter', style: { content: 'typewriter', font: 'Roboto Mono', size: 72, bold: false, color: '#e8ffe8' }, css: 'font:400 14px "Roboto Mono";color:#e8ffe8' },
  { name: 'Shadow', style: { content: 'Shadow', font: 'Oswald', size: 130, shadow: true }, css: 'font:700 20px Oswald;color:#fff;text-shadow:2px 2px 0 #000' },
];

export const STICKERS = [
  '😀', '😂', '😍', '🥳', '😎', '🤯', '😭', '👍', '👏', '🙌', '🔥', '✨', '💥', '💯', '❤️', '💔',
  '⭐', '🌈', '☀️', '🌙', '⚡', '🎉', '🎬', '🎵', '📸', '🚀', '🍕', '☕', '🐶', '🐱', '👀', '✅',
  '❌', '⬆️', '➡️', '⬇️', '⬅️', '💬', '❓', '❗',
];

export const lookCode = (list: LookDef[], id: string) => list.find((l) => l.id === id)?.code ?? 0;

/** Every effect: the built-in "Basic" set plus the shader library, with categories. */
export interface EffectItem { id: string; name: string; category: string; moving: boolean }
const BASIC_MOVING = new Set(['glitch', 'grain', 'vhs', 'flash', 'shake', 'zoom-pulse']);
export const allEffects = (): EffectItem[] => [
  ...EFFECTS.filter((e) => e.id !== 'none').map((e) => ({ id: e.id, name: e.name, category: 'Basic', moving: BASIC_MOVING.has(e.id) })),
  ...FX.map((f) => ({ id: f.id, name: f.name, category: f.category, moving: f.moving })),
];
