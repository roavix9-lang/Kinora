// Builds the animation library (Animation › In / Out / Combo) into pack-gz/animations and adds
// it to pack-gz/manifest.json. Each animation is a few keyframes (see src/engine/anims.ts);
// the catalog row repeats them so tiles can play a preview before anything is downloaded.
// Usage: node cloud/animations.mjs  →  then node cloud/seed.mjs and upload pack-gz/animations.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pack = path.join(here, '..', 'pack-gz');
const VERSION = 1;

// ---- In: start somewhere else, end at rest --------------------------------------------------
const IN = [
  ['fade-in', 'Fade in', 0.5, [{ t: 0, o: 0 }, { t: 1, e: 'linear' }]],
  ['zoom-in', 'Zoom in', 0.5, [{ t: 0, s: 0.4, o: 0 }, { t: 1 }]],
  ['zoom-out', 'Zoom out', 0.5, [{ t: 0, s: 1.6, o: 0 }, { t: 1 }]],
  ['slide-left', 'Slide left', 0.5, [{ t: 0, x: 0.6, o: 0 }, { t: 1 }]],
  ['slide-right', 'Slide right', 0.5, [{ t: 0, x: -0.6, o: 0 }, { t: 1 }]],
  ['slide-up', 'Slide up', 0.5, [{ t: 0, y: 0.5, o: 0 }, { t: 1 }]],
  ['slide-down', 'Slide down', 0.5, [{ t: 0, y: -0.5, o: 0 }, { t: 1 }]],
  ['rotate', 'Rotate', 0.6, [{ t: 0, r: -90, s: 0.5, o: 0 }, { t: 1 }]],
  ['spin', 'Spin', 0.7, [{ t: 0, r: -360, s: 0.2, o: 0 }, { t: 1 }]],
  ['bounce', 'Bounce in', 0.7, [{ t: 0, s: 0.3, o: 0 }, { t: 0.6, s: 1.12, e: 'out' }, { t: 0.8, s: 0.95, e: 'inout' }, { t: 1, e: 'inout' }]],
  ['pop-up', 'Pop up', 0.45, [{ t: 0, s: 0.6, y: 0.08, o: 0 }, { t: 1, e: 'back' }]],
  ['drop', 'Drop', 0.8, [{ t: 0, y: -0.7 }, { t: 1, e: 'bounce' }]],
  ['rise', 'Rise', 0.7, [{ t: 0, y: 0.3, o: 0 }, { t: 1 }]],
  ['blur-in', 'Blur in', 0.6, [{ t: 0, b: 1.5, s: 1.1, o: 0 }, { t: 1 }]],
  ['swing-in', 'Swing in', 0.7, [{ t: 0, r: 25, x: -0.15, o: 0 }, { t: 0.6, r: -8, x: 0 }, { t: 1, e: 'inout' }]],
  ['shake-in', 'Shake', 0.6, [{ t: 0, x: -0.06 }, { t: 0.2, x: 0.05, e: 'inout' }, { t: 0.4, x: -0.04, e: 'inout' }, { t: 0.6, x: 0.03, e: 'inout' }, { t: 0.8, x: -0.015, e: 'inout' }, { t: 1, e: 'inout' }]],
  ['flip', 'Flip', 0.5, [{ t: 0, sx: 0 }, { t: 1, e: 'back' }]],
  ['stretch', 'Stretch', 0.6, [{ t: 0, sx: 1.6, sy: 0.4, o: 0 }, { t: 0.6, sx: 0.9, sy: 1.1 }, { t: 1, e: 'inout' }]],
  ['squeeze', 'Squeeze', 0.55, [{ t: 0, sx: 0.2, sy: 1.4, o: 0 }, { t: 1, e: 'back' }]],
  ['zoom-blur', 'Zoom blur', 0.5, [{ t: 0, s: 1.8, b: 1.4, o: 0 }, { t: 1 }]],
  ['tilt-in', 'Tilt in', 0.6, [{ t: 0, r: -20, y: 0.2, o: 0 }, { t: 1, e: 'back' }]],
  ['elastic', 'Elastic', 0.9, [{ t: 0, s: 0.2 }, { t: 1, e: 'elastic' }]],
  ['rush-in', 'Rush in', 0.55, [{ t: 0, x: 1, b: 1.2 }, { t: 0.7, x: -0.03, b: 0 }, { t: 1, e: 'inout' }]],
  ['fall', 'Fall', 0.7, [{ t: 0, y: -0.6, r: 30, o: 0 }, { t: 1 }]],
];

// ---- Out: start at rest, leave --------------------------------------------------------------
const OUT = [
  ['fade-out', 'Fade out', 0.5, [{ t: 0 }, { t: 1, o: 0, e: 'linear' }]],
  ['zoom-in-out', 'Zoom in', 0.5, [{ t: 0 }, { t: 1, s: 1.6, o: 0, e: 'in' }]],
  ['zoom-out-out', 'Zoom out', 0.5, [{ t: 0 }, { t: 1, s: 0.4, o: 0, e: 'in' }]],
  ['slide-left-out', 'Slide left', 0.5, [{ t: 0 }, { t: 1, x: -0.6, o: 0, e: 'in' }]],
  ['slide-right-out', 'Slide right', 0.5, [{ t: 0 }, { t: 1, x: 0.6, o: 0, e: 'in' }]],
  ['slide-up-out', 'Slide up', 0.5, [{ t: 0 }, { t: 1, y: -0.5, o: 0, e: 'in' }]],
  ['slide-down-out', 'Slide down', 0.5, [{ t: 0 }, { t: 1, y: 0.5, o: 0, e: 'in' }]],
  ['rotate-out', 'Rotate', 0.6, [{ t: 0 }, { t: 1, r: 90, s: 0.5, o: 0, e: 'in' }]],
  ['spin-out', 'Spin', 0.7, [{ t: 0 }, { t: 1, r: 360, s: 0.2, o: 0, e: 'in' }]],
  ['blur-out', 'Blur out', 0.6, [{ t: 0 }, { t: 1, b: 1.5, s: 1.1, o: 0, e: 'in' }]],
  ['pop-out', 'Pop out', 0.45, [{ t: 0 }, { t: 0.35, s: 1.1, e: 'out' }, { t: 1, s: 0, o: 0, e: 'in' }]],
  ['sink', 'Sink', 0.7, [{ t: 0 }, { t: 1, y: 0.3, o: 0, e: 'in' }]],
  ['fall-away', 'Fall away', 0.8, [{ t: 0 }, { t: 1, y: 0.8, r: 20, o: 0, e: 'backin' }]],
  ['flip-out', 'Flip', 0.5, [{ t: 0 }, { t: 1, sx: 0, e: 'backin' }]],
  ['squeeze-out', 'Squeeze', 0.55, [{ t: 0 }, { t: 1, sx: 0.2, sy: 1.4, o: 0, e: 'backin' }]],
  ['zoom-blur-out', 'Zoom blur', 0.5, [{ t: 0 }, { t: 1, s: 1.8, b: 1.4, o: 0, e: 'in' }]],
  ['tilt-out', 'Tilt out', 0.6, [{ t: 0 }, { t: 1, r: 20, y: 0.2, o: 0, e: 'backin' }]],
  ['rush-out', 'Rush out', 0.55, [{ t: 0 }, { t: 0.3, x: 0.03, e: 'out' }, { t: 1, x: -1, b: 1.2, e: 'in' }]],
  ['shrink', 'Shrink', 0.5, [{ t: 0 }, { t: 1, s: 0, e: 'backin' }]],
];

// ---- Combo: across the clip (loop = repeat every `dur` seconds) -----------------------------
const COMBO = [
  ['zoom-slow', 'Zoom slow', 4, false, [{ t: 0 }, { t: 1, s: 1.18, e: 'linear' }]],
  ['pull-back', 'Pull back', 4, false, [{ t: 0, s: 1.2 }, { t: 1, e: 'linear' }]],
  ['pan-left', 'Pan left', 4, false, [{ t: 0, s: 1.15, x: 0.05 }, { t: 1, s: 1.15, x: -0.05, e: 'linear' }]],
  ['pan-right', 'Pan right', 4, false, [{ t: 0, s: 1.15, x: -0.05 }, { t: 1, s: 1.15, x: 0.05, e: 'linear' }]],
  ['pan-up', 'Pan up', 4, false, [{ t: 0, s: 1.15, y: 0.05 }, { t: 1, s: 1.15, y: -0.05, e: 'linear' }]],
  ['drift', 'Drift', 4, false, [{ t: 0, s: 1.1, x: -0.03, y: 0.02 }, { t: 1, s: 1.18, x: 0.03, y: -0.02, e: 'linear' }]],
  ['zoom-in-and-out', 'Zoom in & out', 3, false, [{ t: 0 }, { t: 0.5, s: 1.15, e: 'inout' }, { t: 1, e: 'inout' }]],
  ['spin-in-out', 'Spin in & out', 3, false, [{ t: 0, s: 0, r: -180 }, { t: 0.25, e: 'back' }, { t: 0.75 }, { t: 1, s: 0, r: 180, e: 'backin' }]],
  ['punch-zoom', 'Punch zoom', 0.6, true, [{ t: 0, s: 1.1 }, { t: 0.45, e: 'out' }, { t: 1 }]],
  ['pulse', 'Pulse', 0.8, true, [{ t: 0 }, { t: 0.5, s: 1.06, e: 'inout' }, { t: 1, e: 'inout' }]],
  ['heartbeat', 'Heartbeat', 1, true, [{ t: 0 }, { t: 0.12, s: 1.08 }, { t: 0.24, e: 'inout' }, { t: 0.36, s: 1.06 }, { t: 0.55, e: 'inout' }, { t: 1 }]],
  ['wobble', 'Wobble', 1.2, true, [{ t: 0 }, { t: 0.25, r: 4, e: 'inout' }, { t: 0.75, r: -4, e: 'inout' }, { t: 1, e: 'inout' }]],
  ['swing', 'Swing', 1.6, true, [{ t: 0, r: -6 }, { t: 0.5, r: 6, e: 'inout' }, { t: 1, r: -6, e: 'inout' }]],
  ['float', 'Float', 2, true, [{ t: 0 }, { t: 0.5, y: -0.02, e: 'inout' }, { t: 1, e: 'inout' }]],
  ['shake', 'Shake', 0.5, true, [{ t: 0 }, { t: 0.15, x: 0.012, y: -0.008 }, { t: 0.35, x: -0.01, y: 0.01 }, { t: 0.55, x: 0.008, y: 0.006 }, { t: 0.75, x: -0.012, y: -0.006 }, { t: 1 }]],
  ['jelly', 'Jelly', 1, true, [{ t: 0 }, { t: 0.3, sx: 1.08, sy: 0.93, e: 'inout' }, { t: 0.55, sx: 0.95, sy: 1.06, e: 'inout' }, { t: 0.8, sx: 1.02, sy: 0.98, e: 'inout' }, { t: 1, e: 'inout' }]],
  ['rock', 'Rock', 2, true, [{ t: 0 }, { t: 0.25, r: 3, x: 0.015, e: 'inout' }, { t: 0.75, r: -3, x: -0.015, e: 'inout' }, { t: 1, e: 'inout' }]],
  ['breathe', 'Breathe', 3, true, [{ t: 0 }, { t: 0.5, s: 1.04, e: 'inout' }, { t: 1, e: 'inout' }]],
  ['rotate-loop', 'Rotate', 4, true, [{ t: 0 }, { t: 1, r: 360, e: 'linear' }]],
  ['bounce-loop', 'Bounce', 0.9, true, [{ t: 0, sx: 1.04, sy: 0.96 }, { t: 0.45, y: -0.04, sx: 0.98, sy: 1.03, e: 'out' }, { t: 0.9, sx: 1.04, sy: 0.96, e: 'in' }, { t: 1, sx: 1.04, sy: 0.96 }]],
];

const defs = [
  ...IN.map(([id, name, dur, keys]) => ({ id: `in-${id}`, name, kind: 'in', dur, keys })),
  ...OUT.map(([id, name, dur, keys]) => ({ id: `out-${id.replace(/-out$/, '')}`, name, kind: 'out', dur, keys })),
  ...COMBO.map(([id, name, dur, loop, keys]) => ({ id: `combo-${id}`, name, kind: 'combo', dur, ...(loop ? { loop } : {}), keys })),
];

fs.mkdirSync(path.join(pack, 'animations'), { recursive: true });
const manifestPath = path.join(pack, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).filter((a) => a.kind !== 'animations');
const sortOf = { in: 0, out: 1000, combo: 2000 };
defs.forEach((d, i) => {
  const file = `animations/${d.id}.json.gz`;
  fs.writeFileSync(path.join(pack, file), zlib.gzipSync(JSON.stringify(d), { level: 9 }));
  manifest.push({
    kind: 'animations', id: d.id, name: d.name, category: d.kind === 'in' ? 'In' : d.kind === 'out' ? 'Out' : 'Combo',
    sort: sortOf[d.kind] + i, file, thumb: null, version: VERSION,
    meta: { dur: d.dur, ...(d.loop ? { loop: true } : {}), keys: d.keys },
  });
});
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(`animations: ${defs.length} (${IN.length} in, ${OUT.length} out, ${COMBO.length} combo)`);
