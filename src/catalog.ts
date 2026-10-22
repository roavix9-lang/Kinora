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
  'Poppins', 'Bangers', 'Righteous', 'Abril Fatface', 'Dancing Script', 'Great Vibes', 'Archivo Black', 'Monoton',
  'Press Start 2P', 'Lilita One', 'Satisfy', 'Cinzel', 'Space Grotesk', 'Shadows Into Light', 'Fredoka',
];

export const TEXT_CATEGORIES = ['Trending', 'Basic', 'Bold', 'Neon', 'Retro', 'Elegant', 'Handwritten', 'Labels', 'Subtitles'];

type TextPreset = { name: string; category: string; style: Partial<TextStyle>; css: string };
const T = (name: string, category: string, style: Partial<TextStyle>, css: string): TextPreset => ({ name, category, style, css });

export const TEXT_PRESETS: TextPreset[] = [
  // ---- Trending -----------------------------------------------------------------
  T('Yellow pop', 'Trending', { content: 'WOW!', font: 'Anton', size: 160, color: '#ffe600', strokeColor: '#000', strokeWidth: 12 }, 'font:400 22px Anton;color:#ffe600;-webkit-text-stroke:1.5px #000'),
  T('Comic', 'Trending', { content: 'BOOM!', font: 'Bangers', size: 170, color: '#ff3b3b', strokeColor: '#ffffff', strokeWidth: 10, letterSpacing: 3 }, 'font:400 22px Bangers;color:#ff3b3b;-webkit-text-stroke:1px #fff;letter-spacing:1px'),
  T('Bubble', 'Trending', { content: 'so cute', font: 'Lilita One', size: 140, color: '#ffffff', strokeColor: '#ff5fa2', strokeWidth: 14 }, 'font:400 20px "Lilita One";color:#fff;-webkit-text-stroke:2px #ff5fa2'),
  T('Viral caption', 'Trending', { content: 'wait for it…', font: 'Poppins', size: 80, color: '#111111', background: '#ffffff' }, 'font:700 13px Poppins;color:#111;background:#fff;padding:3px 7px;border-radius:4px'),
  T('Red alert', 'Trending', { content: 'BREAKING', font: 'Archivo Black', size: 96, color: '#ffffff', background: '#e11d48', letterSpacing: 4 }, 'font:400 13px "Archivo Black";color:#fff;background:#e11d48;padding:3px 7px;letter-spacing:1px'),
  T('Gold', 'Trending', { content: 'GOLDEN', font: 'Cinzel', size: 140, color: '#f5c542', shadow: true, letterSpacing: 6 }, 'font:700 18px Cinzel;color:#f5c542;text-shadow:0 0 8px #f5c542;letter-spacing:2px'),
  // ---- Basic --------------------------------------------------------------------
  T('Default', 'Basic', {}, 'font:700 18px Inter;color:#fff'),
  T('Title', 'Basic', { content: 'TITLE', font: 'Bebas Neue', size: 180, letterSpacing: 6 }, 'font:400 22px "Bebas Neue";letter-spacing:2px;color:#fff'),
  T('Shadow', 'Basic', { content: 'Shadow', font: 'Oswald', size: 130, shadow: true }, 'font:700 20px Oswald;color:#fff;text-shadow:2px 2px 0 #000'),
  T('Clean', 'Basic', { content: 'Clean text', font: 'Poppins', size: 96, bold: false }, 'font:400 16px Poppins;color:#fff'),
  T('Modern', 'Basic', { content: 'Modern', font: 'Space Grotesk', size: 120, letterSpacing: 2 }, 'font:700 18px "Space Grotesk";color:#fff'),
  T('Rounded', 'Basic', { content: 'Rounded', font: 'Fredoka', size: 120 }, 'font:600 18px Fredoka;color:#fff'),
  T('Outline', 'Basic', { content: 'OUTLINE', font: 'Anton', size: 150, color: '#ffffff', strokeColor: '#000000', strokeWidth: 10 }, 'font:400 20px Anton;color:#fff;-webkit-text-stroke:1.5px #000'),
  // ---- Bold ---------------------------------------------------------------------
  T('Impact', 'Bold', { content: 'BIG NEWS', font: 'Anton', size: 190, color: '#ffffff', strokeColor: '#000000', strokeWidth: 6, letterSpacing: 2 }, 'font:400 24px Anton;color:#fff;-webkit-text-stroke:1px #000'),
  T('Heavy', 'Bold', { content: 'HEAVY', font: 'Archivo Black', size: 170, color: '#ffffff' }, 'font:400 22px "Archivo Black";color:#fff'),
  T('Black on yellow', 'Bold', { content: 'NOTICE', font: 'Archivo Black', size: 110, color: '#000000', background: '#ffe600', letterSpacing: 3 }, 'font:400 14px "Archivo Black";color:#000;background:#ffe600;padding:3px 7px'),
  T('Sport', 'Bold', { content: 'GAME ON', font: 'Bebas Neue', size: 200, color: '#ffffff', strokeColor: '#1d4ed8', strokeWidth: 12, letterSpacing: 4 }, 'font:400 24px "Bebas Neue";color:#fff;-webkit-text-stroke:1.5px #1d4ed8;letter-spacing:1px'),
  T('Fire', 'Bold', { content: 'HOT', font: 'Bangers', size: 190, color: '#ff7a00', strokeColor: '#7c1d00', strokeWidth: 12, shadow: true }, 'font:400 24px Bangers;color:#ff7a00;-webkit-text-stroke:1.5px #7c1d00;text-shadow:0 0 8px #ff7a00'),
  // ---- Neon ---------------------------------------------------------------------
  T('Neon', 'Neon', { content: 'Neon', font: 'Pacifico', size: 130, color: '#ff4fd8', shadow: true }, 'font:400 20px Pacifico;color:#ff4fd8;text-shadow:0 0 8px #ff4fd8'),
  T('Neon blue', 'Neon', { content: 'OPEN', font: 'Monoton', size: 140, color: '#38bdf8', shadow: true }, 'font:400 20px Monoton;color:#38bdf8;text-shadow:0 0 8px #38bdf8'),
  T('Neon green', 'Neon', { content: 'GAME', font: 'Righteous', size: 150, color: '#39ff14', shadow: true, letterSpacing: 4 }, 'font:400 20px Righteous;color:#39ff14;text-shadow:0 0 8px #39ff14'),
  T('Neon sign', 'Neon', { content: 'Bar', font: 'Satisfy', size: 160, color: '#ff8a3d', shadow: true }, 'font:400 22px Satisfy;color:#ff8a3d;text-shadow:0 0 8px #ff8a3d'),
  T('Cyber', 'Neon', { content: 'CYBER', font: 'Space Grotesk', size: 140, color: '#f0abfc', strokeColor: '#7e22ce', strokeWidth: 6, shadow: true, letterSpacing: 8 }, 'font:700 18px "Space Grotesk";color:#f0abfc;text-shadow:0 0 8px #c026d3;letter-spacing:2px'),
  // ---- Retro --------------------------------------------------------------------
  T('Arcade', 'Retro', { content: 'PLAYER 1', font: 'Press Start 2P', size: 70, color: '#ffe600', strokeColor: '#c2410c', strokeWidth: 8 }, 'font:400 10px "Press Start 2P";color:#ffe600'),
  T('70s', 'Retro', { content: 'groovy', font: 'Righteous', size: 140, color: '#f97316', strokeColor: '#7c2d12', strokeWidth: 10 }, 'font:400 20px Righteous;color:#f97316;-webkit-text-stroke:1px #7c2d12'),
  T('Diner', 'Retro', { content: 'Diner', font: 'Lobster', size: 150, color: '#ef4444', strokeColor: '#ffffff', strokeWidth: 8 }, 'font:400 22px Lobster;color:#ef4444;-webkit-text-stroke:1px #fff'),
  T('Typewriter', 'Retro', { content: 'typewriter', font: 'Roboto Mono', size: 72, bold: false, color: '#e8ffe8' }, 'font:400 14px "Roboto Mono";color:#e8ffe8'),
  T('VHS', 'Retro', { content: 'PLAY ▶', font: 'Roboto Mono', size: 80, color: '#ffffff', shadow: true, letterSpacing: 6 }, 'font:700 13px "Roboto Mono";color:#fff;letter-spacing:2px;text-shadow:2px 0 #f0f,-2px 0 #0ff'),
  // ---- Elegant ------------------------------------------------------------------
  T('Elegant', 'Elegant', { content: 'Elegant', font: 'Playfair Display', size: 120, italic: true, bold: false }, 'font:italic 400 20px "Playfair Display";color:#fff'),
  T('Wedding', 'Elegant', { content: 'Forever', font: 'Great Vibes', size: 170, color: '#fde68a', bold: false }, 'font:400 24px "Great Vibes";color:#fde68a'),
  T('Luxury', 'Elegant', { content: 'LUXURY', font: 'Cinzel', size: 110, color: '#ffffff', letterSpacing: 14 }, 'font:400 15px Cinzel;color:#fff;letter-spacing:3px'),
  T('Magazine', 'Elegant', { content: 'Vogue', font: 'Abril Fatface', size: 170, color: '#ffffff' }, 'font:400 22px "Abril Fatface";color:#fff'),
  T('Serif title', 'Elegant', { content: 'Chapter One', font: 'Playfair Display', size: 110, color: '#f5f5f4' }, 'font:700 17px "Playfair Display";color:#f5f5f4'),
  // ---- Handwritten --------------------------------------------------------------
  T('Handwritten', 'Handwritten', { content: 'hello there', font: 'Caveat', size: 130, bold: false }, 'font:400 22px Caveat;color:#fff'),
  T('Marker', 'Handwritten', { content: 'Marker', font: 'Permanent Marker', size: 120, color: '#7cf7ff', bold: false }, 'font:400 18px "Permanent Marker";color:#7cf7ff'),
  T('Script', 'Handwritten', { content: 'Sweet dreams', font: 'Dancing Script', size: 130, color: '#fbcfe8' }, 'font:700 20px "Dancing Script";color:#fbcfe8'),
  T('Notebook', 'Handwritten', { content: 'note to self', font: 'Shadows Into Light', size: 120, color: '#ffffff', bold: false }, 'font:400 20px "Shadows Into Light";color:#fff'),
  T('Signature', 'Handwritten', { content: 'Signature', font: 'Satisfy', size: 140, color: '#ffffff' }, 'font:400 22px Satisfy;color:#fff'),
  // ---- Labels -------------------------------------------------------------------
  T('Label', 'Labels', { content: 'LABEL', font: 'Montserrat', size: 64, color: '#111111', background: '#ffffff', letterSpacing: 4 }, 'font:700 12px Montserrat;color:#111;background:#fff;padding:3px 8px;letter-spacing:1px'),
  T('Tag', 'Labels', { content: 'NEW', font: 'Poppins', size: 70, color: '#ffffff', background: '#22c55e', letterSpacing: 3 }, 'font:700 12px Poppins;color:#fff;background:#22c55e;padding:3px 8px'),
  T('Location', 'Labels', { content: '📍 Paris, France', font: 'Poppins', size: 64, color: '#ffffff', background: 'rgba(0,0,0,0.55)' }, 'font:600 12px Poppins;color:#fff;background:rgba(0,0,0,.55);padding:3px 8px'),
  T('Name', 'Labels', { content: 'Alex Morgan', font: 'Montserrat', size: 72, color: '#111111', background: '#facc15' }, 'font:700 12px Montserrat;color:#111;background:#facc15;padding:3px 8px'),
  T('Price', 'Labels', { content: '$19.99', font: 'Archivo Black', size: 110, color: '#ffffff', background: '#ef4444' }, 'font:400 15px "Archivo Black";color:#fff;background:#ef4444;padding:3px 8px'),
  // ---- Subtitles ----------------------------------------------------------------
  T('Subtitle', 'Subtitles', { content: 'Subtitle text', font: 'Inter', size: 56, bold: false, background: 'rgba(0,0,0,0.6)' }, 'font:400 13px Inter;color:#fff;background:rgba(0,0,0,.6);padding:2px 6px'),
  T('Bold subtitle', 'Subtitles', { content: 'This is how it works', font: 'Poppins', size: 64, color: '#ffffff', strokeColor: '#000000', strokeWidth: 8 }, 'font:700 13px Poppins;color:#fff;-webkit-text-stroke:1px #000'),
  T('Yellow subtitle', 'Subtitles', { content: 'And then this happened', font: 'Montserrat', size: 62, color: '#ffe600', strokeColor: '#000000', strokeWidth: 8 }, 'font:700 12px Montserrat;color:#ffe600;-webkit-text-stroke:1px #000'),
  T('Boxed subtitle', 'Subtitles', { content: 'Clear and readable', font: 'Inter', size: 60, color: '#111111', background: '#ffffff' }, 'font:600 12px Inter;color:#111;background:#fff;padding:2px 6px'),
  T('Cinema', 'Subtitles', { content: 'I never left.', font: 'Inter', size: 54, color: '#fef9c3', bold: false, shadow: true }, 'font:400 12px Inter;color:#fef9c3;text-shadow:1px 1px 2px #000'),
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
