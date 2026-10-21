import { setTransitionParams, transitionByName, transitionFragment, TRANSITION_VERT } from '../engine/gltransitions';
import { SAMPLE_H, SAMPLE_W, samplePair } from './sampleImages';

// Renders GL Transition thumbnails with one shared, offscreen WebGL context.
const W = SAMPLE_W, H = SAMPLE_H;

let gl: WebGL2RenderingContext | null = null;
let canvas: HTMLCanvasElement | null = null;
const progs = new Map<string, WebGLProgram | null>();
const stills = new Map<string, string>();
let texFrom: WebGLTexture | null = null, texTo: WebGLTexture | null = null;
let texKey = '';

function init(): WebGL2RenderingContext | null {
  if (gl) return gl;
  canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) return null;
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  // Canvas rows are top-down; flip so the sample frames read upright in GL's bottom-up uv space.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  texFrom = makeTex();
  texTo = makeTex();
  return gl;
}

function makeTex() {
  const t = gl!.createTexture()!;
  gl!.bindTexture(gl!.TEXTURE_2D, t);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
  return t;
}

/** Uploads the current sample pictures (the user's footage, or built-in scenes). */
function syncSamples() {
  const pair = samplePair();
  if (pair.key === texKey) return;
  texKey = pair.key;
  stills.clear();
  for (const [t, src] of [[texFrom, pair.from], [texTo, pair.to]] as const) {
    gl!.bindTexture(gl!.TEXTURE_2D, t);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, src);
  }
}

function program(name: string): WebGLProgram | null {
  if (progs.has(name)) return progs.get(name)!;
  const g = init();
  const t = transitionByName(name);
  let p: WebGLProgram | null = null;
  if (g && t) {
    const sh = (type: number, src: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, src);
      g.compileShader(s);
      return g.getShaderParameter(s, g.COMPILE_STATUS) ? s : null;
    };
    const vs = sh(g.VERTEX_SHADER, TRANSITION_VERT), fs = sh(g.FRAGMENT_SHADER, transitionFragment(t));
    if (vs && fs) {
      p = g.createProgram()!;
      g.attachShader(p, vs);
      g.attachShader(p, fs);
      g.bindAttribLocation(p, 0, 'aPos');
      g.linkProgram(p);
      if (!g.getProgramParameter(p, g.LINK_STATUS)) p = null;
      else {
        g.useProgram(p);
        g.uniform1i(g.getUniformLocation(p, 'from'), 0);
        g.uniform1i(g.getUniformLocation(p, 'to'), 1);
        setTransitionParams(g, p, t);
      }
    }
  }
  progs.set(name, p);
  return p;
}

/** Draws the transition at `progress` into the shared canvas; returns it (or null if unsupported). */
function draw(name: string, progress: number): HTMLCanvasElement | null {
  const p = program(name);
  if (!p || !gl || !canvas) return null;
  syncSamples();
  gl.viewport(0, 0, W, H);
  gl.useProgram(p);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texFrom);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texTo);
  gl.uniform1f(gl.getUniformLocation(p, 'progress'), progress);
  gl.uniform1f(gl.getUniformLocation(p, 'ratio'), W / H);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return canvas;
}

/** Still thumbnail (mid-transition) as a data URL, cached per transition. */
export function transitionStill(name: string): string | null {
  if (gl) syncSamples();
  const hit = stills.get(name);
  if (hit) return hit;
  const c = draw(name, 0.45);
  if (!c) return null;
  const url = c.toDataURL('image/jpeg', 0.85);
  stills.set(name, url);
  return url;
}

export const supportsTransition = (name: string) => !!program(name);

/** Animates the transition into `target` while hovered; returns a stop function. */
export function animateInto(target: HTMLCanvasElement, name: string): () => void {
  const ctx = target.getContext('2d')!;
  let raf = 0;
  const t0 = performance.now();
  const tick = () => {
    const k = ((performance.now() - t0) / 1400) % 1.4; // 1 s transition + short hold
    const c = draw(name, Math.min(1, k));
    if (c) ctx.drawImage(c, 0, 0, target.width, target.height);
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(raf);
}

export const PREVIEW_SIZE = { w: W, h: H };
