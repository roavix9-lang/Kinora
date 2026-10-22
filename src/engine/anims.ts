// Animation library (Animation › In / Out / Combo). Each animation is a few keyframes served
// from R2 as JSON and registered here once downloaded; layout.ts plays them on any clip.
//
// Keyframe values are offsets from the clip's resting state:
//   s  scale multiplier (sx / sy per axis)   x, y  shift as a fraction of the canvas
//   r  rotation in degrees                   o     opacity multiplier
//   b  blur amount (0..1.5)
// "in" animations end at rest (t = 1), "out" ones start at rest (t = 0), "combo" ones run
// over their whole duration and may loop.

export type AnimKind = 'in' | 'out' | 'combo';
export type Ease = 'linear' | 'in' | 'out' | 'inout' | 'back' | 'backin' | 'bounce' | 'elastic';

export interface AnimKey { t: number; s?: number; sx?: number; sy?: number; x?: number; y?: number; r?: number; o?: number; b?: number; /** Easing into this key. */ e?: Ease }

export interface AnimDef {
  id: string;
  name: string;
  kind: AnimKind;
  /** Default length in seconds. */
  dur: number;
  /** Combo only: repeat the keys across the clip. */
  loop?: boolean;
  keys: AnimKey[];
}

export interface AnimState { s: number; sx: number; sy: number; x: number; y: number; r: number; o: number; b: number }

export const ANIMS = new Map<string, AnimDef>();
export function registerAnim(def: AnimDef) { ANIMS.set(def.id, def); }

const REST: AnimState = { s: 1, sx: 1, sy: 1, x: 0, y: 0, r: 0, o: 1, b: 0 };

function ease(e: Ease | undefined, p: number) {
  switch (e) {
    case 'linear': return p;
    case 'in': return p * p * p;
    case 'inout': return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    case 'back': { const c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }
    case 'backin': { const c = 1.70158; return (c + 1) * p * p * p - c * p * p; }
    case 'bounce': {
      const n = 7.5625, d = 2.75;
      if (p < 1 / d) return n * p * p;
      if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
      if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
      return n * (p -= 2.625 / d) * p + 0.984375;
    }
    case 'elastic': return p === 0 || p === 1 ? p : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    default: return 1 - Math.pow(1 - p, 3);
  }
}

const val = (k: AnimKey, f: keyof AnimState) => (k[f] ?? REST[f]);

/** State of an animation at progress p (0..1 through its keys). */
export function sampleAnim(def: AnimDef, p: number): AnimState {
  const keys = def.keys;
  if (!keys.length) return REST;
  if (p <= keys[0].t) return stateOf(keys[0]);
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (p > b.t) continue;
    const a = keys[i - 1];
    const q = ease(b.e, b.t > a.t ? (p - a.t) / (b.t - a.t) : 1);
    const out = {} as AnimState;
    for (const f of Object.keys(REST) as (keyof AnimState)[]) out[f] = val(a, f) + (val(b, f) - val(a, f)) * q;
    return out;
  }
  return stateOf(keys[keys.length - 1]);
}

function stateOf(k: AnimKey): AnimState {
  const out = {} as AnimState;
  for (const f of Object.keys(REST) as (keyof AnimState)[]) out[f] = val(k, f);
  return out;
}

/** CSS keyframes for the moving tile previews (and anything else that wants to show one). */
export function cssKeyframes(def: AnimDef): Keyframe[] {
  return def.keys.map((k) => {
    const s = stateOf(k);
    return {
      offset: k.t,
      transform: `translate(${s.x * 100}%, ${s.y * 100}%) rotate(${s.r}deg) scale(${s.s * s.sx}, ${s.s * s.sy})`,
      opacity: Math.max(0, Math.min(1, s.o)),
      filter: s.b > 0.01 ? `blur(${(s.b * 3).toFixed(1)}px)` : 'none',
      easing: easingCss(keysAfter(def, k)?.e),
    };
  });
}

const keysAfter = (def: AnimDef, k: AnimKey) => def.keys[def.keys.indexOf(k) + 1];
function easingCss(e: Ease | undefined) {
  switch (e) {
    case 'linear': return 'linear';
    case 'in': return 'cubic-bezier(.55,.06,.68,.19)';
    case 'inout': return 'cubic-bezier(.65,0,.35,1)';
    case 'back': return 'cubic-bezier(.34,1.56,.64,1)';
    case 'backin': return 'cubic-bezier(.36,0,.66,-.56)';
    case 'bounce': case 'elastic': return 'cubic-bezier(.22,1.6,.36,1)';
    default: return 'cubic-bezier(.215,.61,.355,1)';
  }
}
