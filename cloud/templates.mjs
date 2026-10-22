// Builds the built-in templates into pack-gz/templates and updates pack-gz/manifest.json.
// Each template shows its own sample photos / clips (R2: template-media/…) until the user
// replaces them, and comes with a CC0 song (R2: template-music/<id>.m4a, from Freesound).
// Slot lengths are written in beats of the song, so cuts land on the beat.
// Covers (templates/<id>.webp) and hover previews (templates/<id>.mp4) are rendered by the app.
// Usage: node cloud/templates.mjs  →  then node cloud/seed.mjs and upload pack-gz/templates.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pack = path.join(here, '..', 'pack-gz');
const VERSION = 5;

const photo = (code) => `template-media/${code}.webp`;
const clip = (code) => `template-media/${code}.mp4`;
const isClip = (code) => code.startsWith('V');
const KEN_BURNS = ['combo-zoom-slow', 'combo-pan-left', 'combo-drift', 'combo-pull-back', 'combo-pan-right', 'combo-pan-up'];

/** Slots from media codes; `beats` is one number or one per slot. Photos get a slow Ken Burns move. */
function slots(codes, beats, extra = () => ({})) {
  return codes.map((code, i) => ({
    beats: Array.isArray(beats) ? beats[i] : beats,
    sample: isClip(code) ? clip(code) : photo(code),
    ...(isClip(code) ? {} : { combo: KEN_BURNS[i % KEN_BURNS.length] }),
    ...extra(i, code),
  }));
}

const title = (content, style, o = {}) => ({ start: 0.3, dur: 3, content, style, y: -0.28, anim: 'in-blur-in', animOut: 'out-fade', ...o });

// music: Freesound id (all CC0 1.0), artist, track title, BPM, where the song starts (s).
const T = [
  {
    id: 'golden-hour', name: 'Golden hour', category: 'Cinematic', featured: true,
    music: { fs: 814843, artist: 'Seth_Makes_Sounds', title: 'Wonders', bpm: 107, from: 18 },
    slots: slots(['B10', 'B6', 'M18', 'B9', 'M9', 'M12'], 4),
    transition: 'fade', transitionDur: 0.6, filter: 'golden', filterAmt: 0.8,
    effectLayer: { id: 'light-leak', amount: 0.45 },
    texts: [
      title('golden hour', { font: 'Playfair Display', size: 66, italic: true, bold: false, color: '#fff1d0', shadow: true }),
      title('chasing the light', { font: 'Montserrat', size: 24, bold: false, color: '#fff1d0', letterSpacing: 6 }, { start: 0.9, dur: 2.6, y: -0.2, anim: 'in-fade-in' }),
    ],
  },
  {
    id: 'dance-night', name: 'Dance night', category: 'Trending', featured: true,
    music: { fs: 593792, artist: 'szegvari', title: 'Neon City', bpm: 128, from: 2 },
    slots: slots(['V7', 'V8', 'V6', 'V8'], 8, () => ({ combo: 'combo-punch-zoom' })),
    transition: 'GlitchMemories', transitionDur: 0.3, filter: 'cyber', filterAmt: 0.45,
    effectLayer: { id: 'neon-glow', amount: 0.35 },
    texts: [title('DANCE NIGHT', { font: 'Monoton', size: 61, color: '#ff4fd8', shadowColor: '#ff4fd8', shadowBlur: 0.35 }, { anim: 'in-zoom-blur', animOut: 'out-zoom-blur', dur: 2.4 })],
  },
  {
    id: 'city-walk', name: 'City walk', category: 'Vlog',
    music: { fs: 634685, artist: 'Cloud-10', title: 'Smoke', bpm: 90, from: 0 },
    slots: slots(['V12', 'B2', 'M17', 'M19', 'V15'], [6, 3, 3, 3, 6]),
    transition: 'wipeLeft', transitionDur: 0.4, filter: 'teal-orange', filterAmt: 0.55,
    texts: [
      title('city walk', { font: 'Space Grotesk', size: 53, color: '#111111', background: '#ffffff' }, { anim: 'in-slide-left', animOut: 'out-slide-left' }),
      title('a day downtown', { font: 'Space Grotesk', size: 23, bold: false, color: '#ffffff', shadow: true }, { start: 0.7, dur: 2.6, y: -0.2, anim: 'in-fade-in' }),
    ],
  },
  {
    id: 'glow-up', name: 'Glow up', category: 'Beauty',
    music: { fs: 686610, artist: 'Seth_Makes_Sounds', title: 'Bubblegum Pop Song', bpm: 115, from: 13 },
    slots: slots(['M14', 'B12', 'V17', 'B4', 'V3'], [4, 4, 10, 4, 10], (i) => (i === 0 ? {} : { anim: 'in-pop-up' })),
    transition: 'Overexposure', transitionDur: 0.4, filter: 'vivid', filterAmt: 0.45,
    effectLayer: { id: 'sparkle', amount: 0.55 },
    texts: [title('GLOW UP', { font: 'Bebas Neue', size: 94, color: '#ffd76a', shadowColor: '#ffb800', shadowBlur: 0.3, letterSpacing: 4 }, { anim: 'in-bounce', animOut: 'out-pop' })],
    stickers: [{ start: 0.5, dur: 2.6, id: 'sparkle', color: '#ffe08a', x: 0.28, y: -0.36, scale: 0.5 }],
  },
  {
    id: 'monochrome', name: 'Monochrome', category: 'Retro',
    music: { fs: 819108, artist: 'jcmbo369', title: 'Soft slow piano', bpm: 72, from: 4 },
    slots: slots(['W1', 'B11', 'W5', 'W9', 'M2', 'M6'], 3),
    transition: 'fadegrayscale', transitionDur: 0.8, filter: 'noir', filterAmt: 1,
    effectLayer: { id: 'old-film', amount: 0.3 },
    texts: [title('MONOCHROME', { font: 'Cinzel', size: 46, color: '#ffffff', letterSpacing: 12, bold: false }, { dur: 3.4, y: 0.32 })],
  },
  {
    id: 'soft-love', name: 'Soft love', category: 'Love',
    music: { fs: 584095, artist: 'Bigvegie', title: 'OpusKey Piano', bpm: 80, from: 3 },
    slots: slots(['B12', 'M10', 'W12', 'M7', 'W14'], 4, (i) => (i === 2 ? { transition: 'heart' } : {})),
    transition: 'Dreamy', transitionDur: 0.8, filter: 'dreamy', filterAmt: 0.65,
    effectLayer: { id: 'bokeh', amount: 0.45 },
    texts: [title('you & me', { font: 'Great Vibes', size: 82, color: '#ffd6e4', shadowColor: '#ff7aa8', shadowBlur: 0.25, bold: false }, { dur: 3.2, y: 0.3 })],
    stickers: [{ start: 0.6, dur: 2.8, id: 'heart', color: '#ff7aa8', x: 0.3, y: 0.2, scale: 0.35 }],
  },
  {
    id: 'beach-days', name: 'Beach days', category: 'Travel', featured: true,
    music: { fs: 607304, artist: 'szegvari', title: 'Beach Dance', bpm: 120, from: 0 },
    slots: slots(['V16', 'M18', 'M9', 'B10'], [8, 4, 4, 4]),
    transition: 'LinearBlur', transitionDur: 0.4, filter: 'sunset', filterAmt: 0.6,
    texts: [title('beach days', { font: 'Pacifico', size: 72, color: '#ffffff', shadow: true, bold: false }, { anim: 'in-drop', animOut: 'out-sink', y: -0.3 })],
  },
  {
    id: 'portrait-reel', name: 'Portrait reel', category: 'Trending', featured: true,
    music: { fs: 593834, artist: 'szegvari', title: 'Sahara Dance', bpm: 115, from: 2 },
    slots: slots(['M21', 'W13', 'B12', 'B1', 'B4', 'W7', 'M14', 'M25', 'B7', 'W14', 'B9', 'M7', 'B13', 'M6', 'B10', 'W12', 'M10', 'B2', 'M17', 'W1', 'B6', 'M4', 'B11', 'M18'], 1,
      () => ({ combo: 'combo-punch-zoom' })),
    filter: 'clean', filterAmt: 0.5,
    texts: [
      title('24 FACES', { font: 'Archivo Black', size: 66, color: '#ffffff', strokeColor: '#000000', strokeWidth: 5 }, { start: 0, dur: 2, anim: 'in-zoom-out', animOut: 'out-zoom-in', y: 0 }),
    ],
  },
  {
    id: 'smile', name: 'Smile', category: 'Vlog',
    music: { fs: 575759, artist: 'code_box', title: 'Rabbit Bop', bpm: 98, from: 0 },
    slots: slots(['V20', 'V21', 'V17', 'V1'], 5),
    transition: 'CrossZoom', transitionDur: 0.5, filter: 'warm', filterAmt: 0.55,
    texts: [title('keep smiling', { font: 'Fredoka', size: 61, color: '#ffe14d', strokeColor: '#3a2a00', strokeWidth: 4 }, { anim: 'in-bounce', animOut: 'out-shrink', y: 0.32 })],
    stickers: [{ start: 0.5, dur: 2.6, id: 'face-smile', color: '#ffd400', x: 0.3, y: 0.22, scale: 0.4 }],
  },
  {
    id: 'fashion-week', name: 'Fashion week', category: 'Fashion', featured: true,
    music: { fs: 500268, artist: 'LilMati', title: 'European Fashion Background', bpm: 94, from: 0 },
    slots: slots(['W13', 'M21', 'M25', 'W7', 'B13', 'M4', 'M8'], 3, () => ({ anim: 'in-stretch' })),
    transition: 'wipeUp', transitionDur: 0.3, filter: 'cine-cool', filterAmt: 0.55,
    texts: [
      title('FASHION WEEK', { font: 'Bebas Neue', size: 82, color: '#ffffff', letterSpacing: 8 }, { anim: 'in-rush-in', animOut: 'out-rush', y: 0.3 }),
      title('SS26', { font: 'Montserrat', size: 24, color: '#ffffff', letterSpacing: 11, bold: false }, { start: 0.8, dur: 2.5, y: 0.38, anim: 'in-fade-in' }),
    ],
  },
  {
    id: 'afro-beauty', name: 'Afro beauty', category: 'Beauty', featured: true,
    music: { fs: 788623, artist: 'kontraamusic', title: 'Kemet', bpm: 101.5, from: 9 },
    slots: slots(['B1', 'V3', 'B4', 'B12', 'V2', 'M14', 'B7'], [4, 8, 4, 4, 8, 4, 4]),
    transition: 'DreamyZoom', transitionDur: 0.5, filter: 'portra', filterAmt: 0.6,
    texts: [
      title('AFRO BEAUTY', { font: 'Playfair Display', size: 61, color: '#ffe3b8', letterSpacing: 4, shadow: true }, { dur: 3.4 }),
      title('wear your crown', { font: 'Dancing Script', size: 44, color: '#ffffff', bold: false }, { start: 1, dur: 2.6, y: -0.19, anim: 'in-rise' }),
    ],
  },
  {
    id: 'bookish', name: 'Bookish', category: 'Vlog',
    music: { fs: 699063, artist: 'deadrobotmusic', title: 'In The Clouds', bpm: 132, from: 0 },
    slots: slots(['V15', 'M10', 'B9', 'W12'], [10, 6, 6, 6]),
    transition: 'fade', transitionDur: 0.6, filter: 'kodak-gold', filterAmt: 0.6,
    texts: [title('currently reading', { font: 'Caveat', size: 61, color: '#ffffff', shadow: true }, { anim: 'in-fade-in', y: 0.3, dur: 3.4 })],
  },
  {
    id: 'night-out', name: 'Night out', category: 'Celebration',
    music: { fs: 607298, artist: 'szegvari', title: 'New York Club', bpm: 115, from: 0 },
    slots: slots(['V14', 'B2', 'V6', 'M21', 'V7'], [6, 4, 6, 4, 6], (i, code) => (isClip(code) ? {} : { combo: 'combo-punch-zoom' })),
    transition: 'LinearBlur', transitionDur: 0.35, filter: 'night', filterAmt: 0.55,
    texts: [title('NIGHT OUT', { font: 'Righteous', size: 72, color: '#ffffff', shadowColor: '#00e5ff', shadowBlur: 0.35 }, { anim: 'in-flip', animOut: 'out-flip' })],
  },
  {
    id: 'retro-film', name: 'Retro film', category: 'Retro',
    music: { fs: 699241, artist: 'LulSayer', title: 'Synthwave Loop', bpm: 95, from: 0 },
    slots: slots(['M17', 'M4', 'M8', 'M19', 'M12', 'B13'], 4),
    transition: 'FilmBurn', transitionDur: 0.6, filter: '70s', filterAmt: 0.75,
    effectLayer: { id: 'super8', amount: 0.55 },
    texts: [title("summer '86", { font: 'Abril Fatface', size: 66, color: '#ffcf70', shadow: true, bold: false }, { anim: 'in-swing-in', y: 0.3 })],
  },
  {
    id: 'birthday', name: 'Birthday', category: 'Celebration', featured: true,
    music: { fs: 614130, artist: 'Touda', title: 'Arcade Aroma', bpm: 105.5, from: 0 },
    slots: slots(['V21', 'M8', 'M12', 'V20', 'B13'], [6, 4, 4, 6, 4]),
    transition: 'CrossZoom', transitionDur: 0.45, filter: 'vivid', filterAmt: 0.4,
    effectLayer: { id: 'confetti', amount: 0.7 },
    texts: [title('HAPPY\nBIRTHDAY', { font: 'Lilita One', size: 77, color: '#ffffff', strokeColor: '#ff3d8b', strokeWidth: 7, lineHeight: 1 }, { anim: 'in-elastic', animOut: 'out-pop', dur: 3.2, y: -0.25 })],
    stickers: [
      { start: 0.6, dur: 2.6, id: 'star', color: '#ffd400', x: -0.3, y: -0.4, scale: 0.3 },
      { start: 0.8, dur: 2.4, id: 'sparkle', color: '#ffffff', x: 0.32, y: -0.1, scale: 0.35 },
    ],
  },
  {
    id: 'brand-intro', name: 'Brand intro', category: 'Business',
    music: { fs: 561190, artist: 'code_box', title: 'Tropicorp Advertisement', bpm: 110, from: 0 },
    slots: slots(['V1', 'W12', 'V15', 'B7'], [6, 4, 6, 4]),
    transition: 'wipeLeft', transitionDur: 0.4, filter: 'clean', filterAmt: 0.6,
    texts: [
      title('YOUR BRAND', { font: 'Montserrat', size: 61, color: '#ffffff', letterSpacing: 3 }, { anim: 'in-slide-up', animOut: 'out-slide-up', y: 0.3 }),
      title('est. 2026', { font: 'Montserrat', size: 24, color: '#ffffff', bold: false, letterSpacing: 7 }, { start: 0.8, dur: 2.5, y: 0.37, anim: 'in-fade-in' }),
    ],
  },
  {
    id: 'main-character', name: 'Main character', category: 'Cinematic', featured: true,
    music: { fs: 716385, artist: 'MusicByMisterbates', title: 'Above The Sky', bpm: 120, from: 3 },
    slots: slots(['V2', 'V14', 'V12', 'V16'], 6),
    transition: 'fade', transitionDur: 0.8, filter: 'blockbuster', filterAmt: 0.8,
    texts: [title('MAIN CHARACTER', { font: 'Cinzel', size: 44, color: '#ffffff', letterSpacing: 9 }, { dur: 3.4, y: 0.33 })],
  },
  {
    id: 'slow-days', name: 'Slow days', category: 'Vlog',
    music: { fs: 827095, artist: 'Johnmode', title: '1990s acoustic guitar tune', bpm: 100, from: 3 },
    slots: slots(['B6', 'M9', 'M12', 'M19', 'B10'], 4),
    transition: 'fade', transitionDur: 0.7, filter: 'kodak-gold', filterAmt: 0.65,
    texts: [title('slow days', { font: 'Shadows Into Light', size: 72, color: '#ffffff', shadow: true }, { anim: 'in-rise', y: 0.3, dur: 3.4 })],
  },
  // ---- second set: built around the effects, filters and animation libraries ----------------
  {
    id: 'vhs-tape', name: 'VHS tape', category: 'Retro', featured: true,
    music: { fs: 623421, artist: 'szegvari', title: 'Retrowave 90s', bpm: 110, from: 0 },
    slots: slots(['M8', 'V3', 'M4', 'V21', 'M19'], [4, 8, 4, 8, 4], (i) => ({ effect: i % 2 ? 'crt' : 'tape-damage', effectAmt: 0.5 })),
    transition: 'GlitchMemories', transitionDur: 0.35, filter: '80s', filterAmt: 0.7,
    effectLayer: { id: 'scan-tear', amount: 0.35 },
    texts: [
      title('PLAY', { font: 'Press Start 2P', size: 40, color: '#ffffff', shadow: true }, { start: 0, dur: 2.2, y: -0.4, anim: 'in-fade-in', animOut: 'out-fade' }),
      title('REC  00:00:01', { font: 'Roboto Mono', size: 30, color: '#ff3b3b' }, { start: 0, dur: 12, y: 0.42, anim: 'in-fade-in' }),
    ],
  },
  {
    id: 'glitch-pop', name: 'Glitch pop', category: 'Trending', featured: true,
    music: { fs: 703568, artist: 'tenxsound', title: 'Dark Time', bpm: 140, from: 14 },
    slots: slots(['V8', 'V6', 'V17', 'V7'], 8, (i) => ({ effect: ['rgb-shake', 'block-glitch', 'chroma-pulse', 'digital-noise'][i], effectAmt: 0.55, combo: 'combo-shake' })),
    transition: 'StripDatamoshGlitch', transitionDur: 0.3, filter: 'matrix', filterAmt: 0.35,
    texts: [title('GLITCH', { font: 'Anton', size: 110, color: '#ffffff', shadowColor: '#ff00e6', shadowBlur: 0.08, shadowX: 0.04, shadowY: 0 }, { anim: 'in-shake-in', animOut: 'out-zoom-blur', dur: 2.4, y: 0 })],
  },
  {
    id: 'dreamscape', name: 'Dreamscape', category: 'Cinematic',
    music: { fs: 632109, artist: 'BassmanJourney', title: 'Cinematic Ambient', bpm: 70, from: 12 },
    slots: slots(['M25', 'W7', 'M21', 'W14', 'M7'], 4, (i) => ({ combo: i % 2 ? 'combo-float' : 'combo-drift', effect: 'bloom', effectAmt: 0.45 })),
    transition: 'Dreamy', transitionDur: 1, filter: 'lavender', filterAmt: 0.6,
    effectLayers: [{ id: 'soft-glow', amount: 0.5 }, { id: 'fireflies', amount: 0.35 }],
    texts: [title('dreamscape', { font: 'Playfair Display', size: 72, italic: true, bold: false, color: '#efe6ff', shadowColor: '#a78bfa', shadowBlur: 0.3 }, { dur: 3.6, anim: 'in-blur-in', animOut: 'out-blur' })],
  },
  {
    id: 'comic-strip', name: 'Comic strip', category: 'Trending',
    music: { fs: 435872, artist: 'Teacoma', title: 'Easy Hip-Hop Beat', bpm: 94, from: 10 },
    slots: slots(['M12', 'M8', 'B13', 'M19', 'M4'], 4, (i) => ({ effect: i % 2 ? 'toon' : 'halftone', effectAmt: 0.7, anim: 'in-pop-up' })),
    transition: 'wipeRight', transitionDur: 0.3, filter: 'vivid', filterAmt: 0.6,
    texts: [title('POW!', { font: 'Bangers', size: 120, color: '#ffe600', strokeColor: '#111111', strokeWidth: 7, letterSpacing: 2 }, { start: 0.2, dur: 2, anim: 'in-elastic', animOut: 'out-pop', y: -0.3 })],
    stickers: [
      { start: 2.8, dur: 2.2, id: 'shout', color: '#ffffff', x: 0.25, y: -0.3, scale: 0.45 },
      { start: 5.5, dur: 2.2, id: 'face-shock', color: '#ffd400', x: -0.28, y: 0.3, scale: 0.4 },
      { start: 8.2, dur: 2.2, id: 'exclaim', color: '#ff3b3b', x: 0.3, y: 0.25, scale: 0.4 },
    ],
  },
  {
    id: 'sketchbook', name: 'Sketchbook', category: 'Retro',
    music: { fs: 462723, artist: 'Garuda1982', title: 'Acoustic guitar melody', bpm: 96, from: 1 },
    slots: slots(['W12', 'W1', 'B7', 'M10', 'W14'], 4, (i) => ({ effect: ['pencil', 'watercolor', 'pencil', 'watercolor', 'emboss'][i], effectAmt: 0.8 })),
    transition: 'crosshatch', transitionDur: 0.8, filter: 'high-key', filterAmt: 0.4,
    texts: [title('sketchbook', { font: 'Caveat', size: 90, color: '#2b2b2b', background: '#fffdf4' }, { anim: 'in-swing-in', animOut: 'out-fade', y: 0.33 })],
  },
  {
    id: 'neon-nights', name: 'Neon nights', category: 'Celebration', featured: true,
    music: { fs: 550337, artist: 'Wax_vibe', title: 'Synthwave', bpm: 120, from: 10 },
    slots: slots(['B2', 'V7', 'M21', 'V6', 'M25'], [4, 8, 4, 8, 4], (i, code) => (isClip(code) ? { effect: 'strobe', effectAmt: 0.3 } : { combo: 'combo-pulse' })),
    transition: 'ZoomInCircles', transitionDur: 0.45, filter: 'cyber', filterAmt: 0.55,
    effectLayer: { id: 'neon-glow', amount: 0.45 },
    texts: [title('neon nights', { font: 'Monoton', size: 60, color: '#4df3ff', shadowColor: '#00d0ff', shadowBlur: 0.35 }, { anim: 'in-flip', animOut: 'out-flip', y: 0.3 })],
  },
  {
    id: 'winter-mood', name: 'Winter mood', category: 'Travel',
    music: { fs: 582038, artist: 'Bigvegie', title: 'MorningDue Piano', bpm: 76, from: 13 },
    slots: slots(['W14', 'W7', 'M6', 'W13', 'W12'], 4),
    transition: 'fade', transitionDur: 0.9, filter: 'nordic', filterAmt: 0.75,
    effectLayer: { id: 'snow', amount: 0.6 },
    texts: [title('winter mood', { font: 'Cinzel', size: 60, color: '#eaf6ff', letterSpacing: 8, shadow: true }, { anim: 'in-fall', animOut: 'out-sink', dur: 3.4 })],
  },
  {
    id: 'rainy-day', name: 'Rainy day', category: 'Vlog',
    music: { fs: 629176, artist: 'holizna', title: 'Lofi Vinyl E-Piano', bpm: 95, from: 0 },
    slots: slots(['M6', 'V12', 'W7', 'V15', 'M10'], [4, 8, 4, 8, 4]),
    transition: 'WaterDrop', transitionDur: 0.8, filter: 'moody', filterAmt: 0.7,
    effectLayer: { id: 'rain', amount: 0.55 },
    texts: [title('rainy days', { font: 'Shadows Into Light', size: 80, color: '#ffffff', shadow: true }, { anim: 'in-rise', animOut: 'out-fade', y: 0.3, dur: 3.4 })],
  },
  {
    id: 'party-mode', name: 'Party mode', category: 'Celebration',
    music: { fs: 607299, artist: 'szegvari', title: 'Dance Pharao', bpm: 124, from: 0 },
    slots: slots(['V6', 'V21', 'V8', 'V7', 'M8'], [8, 8, 8, 8, 4], (i, code) => ({ combo: isClip(code) ? 'combo-punch-zoom' : 'combo-bounce-loop', ...(i === 2 ? { effect: 'strobe', effectAmt: 0.35 } : {}) })),
    transition: 'cube', transitionDur: 0.4, filter: 'vivid', filterAmt: 0.5,
    effectLayer: { id: 'disco', amount: 0.4 },
    texts: [title('PARTY MODE', { font: 'Bangers', size: 100, color: '#ffffff', strokeColor: '#7c3aed', strokeWidth: 6, letterSpacing: 3 }, { anim: 'in-bounce', animOut: 'out-shrink', y: -0.3 })],
    stickers: [{ start: 0.5, dur: 2.8, id: 'fire', color: '#ff7a00', x: 0.3, y: -0.4, scale: 0.35 }],
  },
  {
    id: 'heartbeat', name: 'Heartbeat', category: 'Love',
    music: { fs: 560894, artist: 'Bigvegie', title: 'Timeflow', bpm: 80, from: 7 },
    slots: slots(['B9', 'B12', 'M7', 'B4', 'M18'], 4, () => ({ combo: 'combo-heartbeat' })),
    transition: 'heart', transitionDur: 0.9, filter: 'pastel', filterAmt: 0.6,
    effectLayers: [{ id: 'bokeh', amount: 0.4 }, { id: 'heartbeat', amount: 0.3 }],
    texts: [title('my heart', { font: 'Great Vibes', size: 90, color: '#ffe0ec', shadowColor: '#ff4f8b', shadowBlur: 0.3, bold: false }, { anim: 'in-pop-up', animOut: 'out-fade', y: 0.3, dur: 3.4 })],
    stickers: [{ start: 0.7, dur: 2.6, id: 'face-love', color: '#ffd400', x: 0.3, y: 0.15, scale: 0.35 }, { start: 6, dur: 3, id: 'heart', color: '#ff4f8b', x: -0.3, y: -0.35, scale: 0.3 }],
  },
  {
    id: 'split-screen', name: 'Split screen', category: 'Trending',
    music: { fs: 564794, artist: 'Johnnie_Holiday', title: 'Deep House', bpm: 120, from: 0 },
    slots: slots(['V17', 'B13', 'V3', 'M14', 'V20'], [8, 4, 8, 4, 8], (i) => ({ effect: ['split-3', 'mirror-quad', 'split-4', 'kaleidoscope', 'split-3'][i], effectAmt: 1 })),
    transition: 'GridFlip', transitionDur: 0.5, filter: 'clean', filterAmt: 0.5,
    texts: [title('SPLIT', { font: 'Archivo Black', size: 90, color: '#ffffff', background: '#111111', letterSpacing: 6 }, { anim: 'in-squeeze', animOut: 'out-squeeze', y: 0, dur: 2.2 })],
  },
  {
    id: 'starry-night', name: 'Starry night', category: 'Cinematic',
    music: { fs: 456102, artist: 'BurghRecords', title: 'Cinematic Dramatic Buildup', bpm: 80, from: 19 },
    slots: slots(['M2', 'W9', 'M25', 'B2', 'W5'], 4),
    transition: 'fade', transitionDur: 1, filter: 'night', filterAmt: 0.6,
    effectLayers: [{ id: 'stars', amount: 0.6 }, { id: 'god-rays', amount: 0.3 }],
    texts: [title('under the stars', { font: 'Cinzel', size: 52, color: '#fff4d6', letterSpacing: 6, shadowColor: '#ffd36b', shadowBlur: 0.3 }, { anim: 'in-blur-in', animOut: 'out-blur', dur: 3.6, y: 0.32 })],
  },
  {
    id: 'film-noir', name: 'Film noir', category: 'Cinematic',
    music: { fs: 770969, artist: 'nicpressley', title: 'Jazz Chords Gm', bpm: 84, from: 5 },
    slots: slots(['B11', 'W5', 'W1', 'M2', 'V2'], [4, 4, 4, 4, 8]),
    transition: 'burn', transitionDur: 0.8, filter: 'noir', filterAmt: 1,
    effectLayers: [{ id: 'old-film', amount: 0.45 }, { id: 'focus', amount: 0.35 }],
    texts: [title('NOIR', { font: 'Abril Fatface', size: 130, color: '#ffffff', bold: false, letterSpacing: 12 }, { anim: 'in-zoom-out', animOut: 'out-fade', dur: 3.2, y: 0 })],
  },
  {
    id: 'hype-reel', name: 'Hype reel', category: 'Trending', featured: true,
    music: { fs: 507747, artist: 'Magmi.Soundtracks', title: 'Hybrid Action Music', bpm: 128, from: 3 },
    slots: slots(['V3', 'V8', 'V6', 'V17', 'V20'], 6, (i) => ({ combo: 'combo-punch-zoom', ...(i % 2 ? { effect: 'zoom-blur', effectAmt: 0.35 } : { effect: 'motion-blur', effectAmt: 0.3 }), anim: 'in-rush-in' })),
    transition: 'CrossZoom', transitionDur: 0.35, filter: 'teal-orange', filterAmt: 0.6,
    effectLayer: { id: 'lens-flare', amount: 0.4 },
    texts: [title('HYPE', { font: 'Anton', size: 150, color: '#ffffff', strokeColor: '#ff2d2d', strokeWidth: 5, letterSpacing: 6 }, { start: 0, dur: 2, anim: 'in-zoom-blur', animOut: 'out-zoom-blur', y: 0 })],
  },
  {
    id: 'lofi-study', name: 'Lo-fi study', category: 'Vlog',
    music: { fs: 708776, artist: 'TheWandermiles', title: 'Lofi Hip Hop Loop', bpm: 85, from: 0 },
    slots: slots(['M10', 'V15', 'B9', 'W12'], [6, 8, 6, 6]),
    transition: 'fade', transitionDur: 0.7, filter: 'fade', filterAmt: 0.6,
    effectLayer: { id: 'dither', amount: 0.2 },
    texts: [title('study with me', { font: 'Roboto Mono', size: 46, color: '#f4efe6', background: '#2b2620' }, { anim: 'in-slide-up', animOut: 'out-slide-down', y: 0.35, dur: 3.6 })],
  },
  {
    id: 'eight-bit', name: '8-bit', category: 'Retro',
    music: { fs: 656141, artist: 'josefpres', title: '8 bit game loop', bpm: 120, from: 0 },
    slots: slots(['M19', 'M17', 'M12', 'M4', 'B13'], 4, () => ({ effect: 'pixel-8bit', effectAmt: 0.6, anim: 'in-drop' })),
    transition: 'pixelize', transitionDur: 0.5, filter: 'vivid', filterAmt: 0.5,
    effectLayer: { id: 'crt', amount: 0.35 },
    texts: [title('LEVEL UP', { font: 'Press Start 2P', size: 48, color: '#ffe600', strokeColor: '#000000', strokeWidth: 4 }, { anim: 'in-bounce', animOut: 'out-shrink', y: -0.32 })],
    stickers: [{ start: 0.6, dur: 2.6, id: 'star', color: '#ffe600', x: 0.3, y: -0.2, scale: 0.3 }],
  },
  {
    id: 'scanner', name: 'Scanner', category: 'Trending',
    music: { fs: 615546, artist: 'Projecteur', title: 'Cosmic dark synthwave', bpm: 100, from: 0 },
    slots: slots(['M4', 'M21', 'W7', 'V2'], [4, 4, 4, 8], (i) => ({ effect: ['thermal', 'night-vision', 'x-ray', 'duotone'][i], effectAmt: 0.85 })),
    transition: 'TVStatic', transitionDur: 0.4, filter: 'cine-cool', filterAmt: 0.4,
    effectLayer: { id: 'signal-loss', amount: 0.25 },
    texts: [title('SCANNING…', { font: 'Roboto Mono', size: 50, color: '#7CFF6B', letterSpacing: 6 }, { anim: 'in-fade-in', animOut: 'out-fade', y: 0.38, dur: 3 })],
  },
  {
    id: 'summer-glow', name: 'Summer glow', category: 'Travel',
    music: { fs: 395037, artist: 'Kodack', title: 'Simple relaxing guitar loop', bpm: 90, from: 0 },
    slots: slots(['M18', 'V16', 'M9', 'B10', 'B6'], [4, 8, 4, 4, 4]),
    transition: 'DreamyZoom', transitionDur: 0.6, filter: 'sunset', filterAmt: 0.6,
    effectLayers: [{ id: 'god-rays', amount: 0.35 }, { id: 'light-leak', amount: 0.35 }],
    texts: [title('summer glow', { font: 'Satisfy', size: 90, color: '#fff3c4', shadowColor: '#ff9d2e', shadowBlur: 0.3 }, { anim: 'in-rise', animOut: 'out-fade', y: -0.3, dur: 3.4 })],
  },
];

// ---- write ----------------------------------------------------------------------------------
const r2 = (v) => Math.round(v * 100) / 100;
fs.mkdirSync(path.join(pack, 'templates'), { recursive: true });
const manifestPath = path.join(pack, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).filter((a) => a.kind !== 'templates');
for (const f of fs.readdirSync(path.join(pack, 'templates'))) if (f.endsWith('.json.gz')) fs.rmSync(path.join(pack, 'templates', f));
const out = [];
T.forEach((t, i) => {
  const beat = 60 / t.music.bpm;
  const slotsOut = t.slots.map(({ beats, ...s }) => {
    // A sample clip is 6 s long; never ask for more than that.
    let dur = r2(beats * beat);
    while (s.sample.endsWith('.mp4') && dur > 6) dur = r2(dur - beat);
    return { dur, ...s };
  });
  const duration = r2(slotsOut.reduce((n, s) => n + s.dur, 0));
  const def = {
    id: t.id, name: t.name, category: t.category, ratio: '9:16', ...(t.featured ? { featured: true } : {}),
    slots: slotsOut,
    ...(t.transition ? { transition: t.transition, transitionDur: t.transitionDur } : {}),
    ...(t.filter ? { filter: t.filter, filterAmt: t.filterAmt } : {}),
    ...(t.effectLayer ? { effectLayer: t.effectLayer } : {}),
    ...(t.effectLayers ? { effectLayers: t.effectLayers } : {}),
    ...(t.texts ? { texts: t.texts } : {}),
    ...(t.stickers ? { stickers: t.stickers } : {}),
    music: { file: `template-music/${t.id}.m4a`, name: t.music.title, artist: t.music.artist, volume: 0.9, fadeOut: 1.2 },
  };
  const file = `templates/${t.id}.json.gz`;
  fs.writeFileSync(path.join(pack, file), zlib.gzipSync(JSON.stringify(def), { level: 9 }));
  manifest.push({
    kind: 'templates', id: t.id, name: t.name, category: t.category, sort: i, file, thumb: `templates/${t.id}.webp`, version: VERSION,
    meta: {
      ratio: '9:16', slots: slotsOut.length, duration, featured: !!t.featured, preview: `templates/${t.id}.mp4`,
      photos: slotsOut.filter((s) => s.sample.endsWith('.webp')).length, clips: slotsOut.filter((s) => s.sample.endsWith('.mp4')).length,
      music: { title: t.music.title, artist: t.music.artist, license: 'cc0', source: `https://freesound.org/s/${t.music.fs}/` },
    },
  });
  out.push({ id: t.id, duration, music: t.music });
});
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
// For the music trim step: each template's length and where its song starts.
fs.writeFileSync(path.join(pack, 'templates', 'music-cuts.json'), JSON.stringify(out, null, 1));
console.log(`templates: ${T.length}`);
for (const o of out) console.log(`  ${o.id.padEnd(16)} ${o.duration}s`);
