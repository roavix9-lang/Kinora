// GL Transitions (https://gl-transitions.com, MIT): the open-source library of GLSL
// transition shaders. Each one defines `vec4 transition(vec2 uv)` using getFromColor /
// getToColor / progress / ratio, plus its own parameter uniforms.

export interface GLTransition {
  name: string;
  glsl: string;
  paramsTypes: Record<string, string>;
  defaultParams: Record<string, number | boolean | number[]>;
  author: string;
  license: string;
}

let all: GLTransition[] = [];
const listeners = new Set<() => void>();

/** Transitions are served from R2 (see src/engine/assets.ts); downloaded ones register here. */
export function registerTransition(t: GLTransition) {
  const at = all.findIndex((x) => x.name === t.name);
  if (at >= 0) all[at] = t; else all = [...all, t];
  listeners.forEach((fn) => fn());
}

/** Kept for callers that waited on the old bundled chunk: resolves with what is downloaded. */
export function loadTransitions(): Promise<GLTransition[]> { return Promise.resolve(all); }

export const transitions = () => all;
export const transitionByName = (name: string) => all.find((t) => t.name === name);
export function onTransitionsLoaded(fn: () => void) { listeners.add(fn); }

/** "wipeLeft" → "Wipe Left", "Revolve_Left" → "Revolve Left", "CrossZoom" → "Cross Zoom". */
export function displayName(name: string) {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace('Rigth', 'Right');
}

/** A curated starter set, shown under "Popular". */
export const POPULAR = [
  'fade', 'fadecolor', 'Dreamy', 'CrossZoom', 'directionalwarp', 'wipeLeft', 'wipeRight', 'wipeUp', 'wipeDown',
  'circleopen', 'cube', 'SimpleZoom', 'LinearBlur', 'Swirl', 'GlitchMemories', 'pixelize', 'Radial', 'ripple',
  'doorway', 'Bounce', 'windowslice', 'burn', 'squeeze', 'StarWipe', 'Slides', 'DreamyZoom', 'morph', 'colorphase',
];

const FRAG_HEAD = `precision highp float;
varying vec2 _uv;
uniform sampler2D from, to;
uniform float progress, ratio;
vec4 getFromColor(vec2 uv) { return texture2D(from, uv); }
vec4 getToColor(vec2 uv) { return texture2D(to, uv); }
`;

export const TRANSITION_VERT = `attribute vec2 aPos;
varying vec2 _uv;
void main() { gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); _uv = aPos; }`;

export const transitionFragment = (t: GLTransition) => `${FRAG_HEAD}\n${t.glsl}\nvoid main() { gl_FragColor = transition(_uv); }`;

/** Sets a transition's parameter uniforms to their defaults. */
export function setTransitionParams(gl: WebGL2RenderingContext, prog: WebGLProgram, t: GLTransition) {
  for (const [name, type] of Object.entries(t.paramsTypes)) {
    const loc = gl.getUniformLocation(prog, name);
    if (!loc) continue;
    const v = t.defaultParams[name];
    switch (type) {
      case 'float': gl.uniform1f(loc, Number(v)); break;
      case 'int': gl.uniform1i(loc, Number(v)); break;
      case 'bool': gl.uniform1i(loc, v ? 1 : 0); break;
      case 'vec2': gl.uniform2fv(loc, v as number[]); break;
      case 'vec3': gl.uniform3fv(loc, v as number[]); break;
      case 'vec4': gl.uniform4fv(loc, v as number[]); break;
      case 'ivec2': gl.uniform2iv(loc, v as number[]); break;
    }
  }
}
