import { EFFECTS, lookCode } from '../catalog';
import { fxById, fxFragment, FX_VERT } from './fxlib';
import { bakeCurves, curvesNeutral } from './curves';
import { lutData } from './luts';
import { Clip } from '../types';
import { setTransitionParams, transitionByName, transitionFragment, TRANSITION_VERT } from './gltransitions';
import { LayerGeom } from './layout';

export interface Layer {
  id: string;
  source: TexImageSource;
  /** Identity of the pixel content; re-upload is skipped while unchanged. */
  sourceKey: unknown;
  texW: number;
  texH: number;
  /** Clockwise rotation (0/90/180/270) from container metadata. */
  rotation: number;
  geom: LayerGeom;
  clip: Clip;
  /** Adjustment layer: re-draws everything rendered so far through this clip's effect/filter. */
  post?: boolean;
  /** Already-rendered GPU texture (bottom-up rows), drawn instead of uploading `source`. */
  tex?: WebGLTexture;
}

/** A whole sub-timeline (template clip) rendered offscreen, then placed with the clip's geometry. */
export interface NestedLayer {
  nested: true;
  id: string;
  layers: AnyLayer[];
  /** Nested project size. */
  w: number;
  h: number;
  geom: LayerGeom;
  clip: Clip;
}

/** Two clips mid-transition: each is rendered offscreen, then a GL Transition shader blends them. */
export interface XfadeLayer {
  xfade: true;
  from: AnyLayer | null;
  to: AnyLayer | null;
  transition: string;
  progress: number;
}

export type AnyLayer = Layer | XfadeLayer | NestedLayer;
const isXfade = (l: AnyLayer): l is XfadeLayer => 'xfade' in l;
const isNested = (l: AnyLayer): l is NestedLayer => 'nested' in l;

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

const PLACEHOLDER_SRC = new ImageData(1, 1);

const VERT = `#version 300 es
in vec2 aPos;
uniform vec2 uCanvas;
uniform vec2 uCenter;
uniform vec2 uSize;
uniform float uRot;
out vec2 vUv;
void main() {
  vec2 p = (aPos - 0.5) * uSize;
  float c = cos(uRot), s = sin(uRot);
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + uCenter;
  vec2 cl = p / uCanvas * 2.0 - 1.0;
  gl_Position = vec4(cl.x, -cl.y, 0.0, 1.0);
  vUv = aPos;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform int uRot90;
uniform bool uFlipX;
uniform bool uFlipY;
uniform vec2 uTexel;
uniform float uOpacity;
uniform int uWipeMode;
uniform float uWipe;
uniform float uBlur;
uniform float uTime;
// adjust
uniform float uBrightness, uContrast, uSaturation, uExposure, uTemp, uTint, uHue, uVignette, uSharpen;
uniform float uHighlight, uShadow, uWhites, uBlacks, uBrilliance, uClarity, uParticles, uFade;
uniform bool uAdjOn;
uniform bool uHslOn;
uniform float uHsl[24];
uniform bool uCurvesOn;
uniform sampler2D uCurves;
uniform bool uWheelsOn;
uniform vec4 uLift, uGammaW, uGain, uOffsetW;
uniform float uWheelAmt;
uniform vec4 uSatW; // saturation per wheel: shadows, mid, high, offset
uniform highp sampler3D uLut2;
uniform bool uLut2On;
uniform float uLut2Scale, uLut2Offset, uLut2Amt;
uniform bool uSkin;
uniform int uMaskType;
uniform vec4 uMaskRect;
uniform vec2 uMaskScale;
uniform float uMaskRound;
uniform float uMaskRot, uMaskFeather;
uniform bool uMaskInv;
uniform highp sampler3D uLut;
uniform bool uLutOn;
uniform float uLutScale;
uniform float uLutOffset;
uniform float uFilterAmt;
uniform int uEffect;
uniform float uEffectAmt;
uniform vec4 uKey;      // rgb, enabled
uniform vec2 uKeyParam; // similarity, smoothness

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec2 rawUv(vec2 uv) {
  if (uFlipX) uv.x = 1.0 - uv.x;
  if (uFlipY) uv.y = 1.0 - uv.y;
  if (uRot90 == 1) return vec2(uv.y, 1.0 - uv.x);
  if (uRot90 == 2) return vec2(1.0 - uv.x, 1.0 - uv.y);
  if (uRot90 == 3) return vec2(1.0 - uv.y, uv.x);
  return uv;
}

vec4 tap(vec2 uv) { return texture(uTex, rawUv(clamp(uv, 0.0, 1.0))); }

vec4 blurred(vec2 uv, float r) {
  vec4 acc = vec4(0.0);
  float tot = 0.0;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float a = fi * 2.39996;
    float d = sqrt((fi + 0.5) / 24.0) * r;
    float w = 1.0 - d / (r + 1e-5) * 0.5;
    acc += tap(uv + vec2(cos(a), sin(a)) * d) * w;
    tot += w;
  }
  return acc / tot;
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 sat(vec3 c, float s) { return mix(vec3(luma(c)), c, s); }
vec3 contrast(vec3 c, float k) { return (c - 0.5) * k + 0.5; }

const float HSL_CENTERS[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 225.0, 270.0, 315.0);

float maskValue(vec2 uv) {
  // Measured in units of the layer's short side, so a circle stays round on any layer shape.
  vec2 p = (uv - uMaskRect.xy) * uMaskScale;
  float cr = cos(-uMaskRot), sr = sin(-uMaskRot);
  p = vec2(p.x * cr - p.y * sr, p.x * sr + p.y * cr);
  vec2 hh = max(uMaskRect.zw * 0.5, vec2(1e-3));
  vec2 q = p / hh;
  float f = max(uMaskFeather, 0.001);
  if (uMaskType == 1) return smoothstep(-f, f, -q.y);
  if (uMaskType == 2) return 1.0 - smoothstep(1.0 - f, 1.0 + f, abs(q.y));
  if (uMaskType == 3) return 1.0 - smoothstep(1.0 - f, 1.0 + f, length(q));
  if (uMaskType == 4) {
    float m = min(hh.x, hh.y), r = uMaskRound * m;
    vec2 d = abs(p) - hh + r;
    float sd = (length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r) / m;
    return 1.0 - smoothstep(-f, f, sd);
  }
  if (uMaskType == 5) {
    float a = atan(q.x, -q.y);
    float rs = 0.45 + 0.55 * pow(abs(cos(a * 2.5)), 4.0);
    return 1.0 - smoothstep(rs - f, rs + f, length(q));
  }
  if (uMaskType == 6) {
    float x = q.x * 1.1, y = -q.y * 1.1 + 0.15;
    float v = pow(x * x + y * y - 1.0, 3.0) - x * x * y * y * y;
    return smoothstep(f, -f, v);
  }
  return 1.0;
}

void main() {
  vec2 uv = vUv;
  if (uWipeMode == 1 && uv.x > uWipe) discard;
  if (uWipeMode == 2 && uv.x < 1.0 - uWipe) discard;

  // geometry effects
  if (uEffect == 4) { float n = mix(160.0, 18.0, uEffectAmt); vec2 cells = vec2(n, n * uTexel.x / uTexel.y); uv = (floor(uv * cells) + 0.5) / cells; }
  if (uEffect == 6) uv.x = uv.x > 0.5 ? 1.0 - uv.x : uv.x;

  float blur = uBlur + (uEffect == 1 ? uEffectAmt * 1.5 : 0.0);
  vec4 col;
  if (blur > 0.001) col = blurred(uv, blur * 0.02);
  else if (uEffect == 2) {
    float t = floor(uTime * 12.0);
    float band = step(0.82, hash(vec2(floor(uv.y * 24.0), t))) * uEffectAmt;
    vec2 off = vec2((hash(vec2(t, 3.0)) - 0.5) * 0.06 * band + 0.012 * uEffectAmt * sin(uTime * 20.0), 0.0);
    col = vec4(tap(uv + off + vec2(0.01 * uEffectAmt, 0)).r, tap(uv + off).g, tap(uv + off - vec2(0.01 * uEffectAmt, 0)).b, tap(uv).a);
  } else if (uEffect == 7) {
    float wob = sin(uv.y * 800.0 + uTime * 10.0) * 0.0015 * uEffectAmt + (hash(vec2(floor(uv.y * 120.0), floor(uTime * 30.0))) - 0.5) * 0.004 * uEffectAmt;
    col = vec4(tap(uv + vec2(wob + 0.006 * uEffectAmt, 0)).r, tap(uv + vec2(wob, 0)).g, tap(uv + vec2(wob - 0.006 * uEffectAmt, 0)).b, tap(uv).a);
  } else if (uEffect == 11) {
    float o = 0.015 * uEffectAmt;
    col = vec4(tap(uv + vec2(o, 0)).r, tap(uv).g, tap(uv - vec2(o, 0)).b, tap(uv).a);
  } else col = tap(uv);

  if (uSharpen > 0.0 || uEffect == 12) {
    vec3 n = tap(uv + vec2(uTexel.x, 0)).rgb + tap(uv - vec2(uTexel.x, 0)).rgb + tap(uv + vec2(0, uTexel.y)).rgb + tap(uv - vec2(0, uTexel.y)).rgb;
    if (uEffect == 12) {
      float e = length(col.rgb * 4.0 - n) * 2.5;
      col.rgb = mix(col.rgb, vec3(1.0 - clamp(e, 0.0, 1.0)), uEffectAmt);
    }
    if (uSharpen > 0.0) col.rgb += (col.rgb * 4.0 - n) * uSharpen * 0.8;
  }

  // chroma key (distance in CbCr plane)
  if (uKey.a > 0.5) {
    vec2 kc = vec2(dot(uKey.rgb, vec3(-0.169, -0.331, 0.5)), dot(uKey.rgb, vec3(0.5, -0.419, -0.081)));
    vec2 pc = vec2(dot(col.rgb, vec3(-0.169, -0.331, 0.5)), dot(col.rgb, vec3(0.5, -0.419, -0.081)));
    float d = distance(kc, pc);
    float a = smoothstep(uKeyParam.x * 0.4, uKeyParam.x * 0.4 + uKeyParam.y * 0.3 + 0.001, d);
    col.a *= a;
    // spill suppression
    col.rgb = mix(vec3(luma(col.rgb)), col.rgb, a);
  }

  vec3 orig = col.rgb;
  vec3 c = col.rgb;
  if (uAdjOn) {
    c *= pow(2.0, uExposure * 1.5);
    c += uBrightness * 0.35;
    float L = luma(c);
    float shw = 1.0 - smoothstep(0.0, 0.55, L), hiw = smoothstep(0.45, 1.0, L);
    c += uShadow * 0.3 * shw;
    c += uHighlight * 0.3 * hiw;
    c *= 1.0 + uWhites * 0.25;
    c += uBlacks * 0.12 * (1.0 - smoothstep(0.0, 0.35, L));
    c += uBrilliance * (0.22 * shw - 0.14 * hiw);
    if (uClarity > 0.001) {
      vec3 b = blurred(uv, 0.03).rgb;
      c += (c - b) * uClarity * 1.6 * (1.0 - abs(L - 0.5) * 1.4);
    }
    c = contrast(c, 1.0 + uContrast);
    c = sat(c, 1.0 + uSaturation);
    c += vec3(uTemp * 0.12, uTint * 0.08, -uTemp * 0.12);
    if (abs(uHue) > 0.01) { vec3 h = rgb2hsv(clamp(c, 0.0, 1.0)); h.x = fract(h.x + uHue / 360.0); c = hsv2rgb(h); }
  }

  if (uHslOn) {
    vec3 h = rgb2hsv(clamp(c, 0.0, 1.0));
    float deg = h.x * 360.0;
    float colorful = smoothstep(0.04, 0.22, h.y);
    float dh = 0.0, ds = 0.0, dv = 0.0;
    for (int i = 0; i < 8; i++) {
      float d = abs(mod(deg - HSL_CENTERS[i] + 180.0, 360.0) - 180.0);
      float w = max(0.0, 1.0 - d / 38.0) * colorful;
      dh += w * uHsl[i * 3];
      ds += w * uHsl[i * 3 + 1];
      dv += w * uHsl[i * 3 + 2];
    }
    h.x = fract(h.x + dh * 30.0 / 360.0);
    h.y = clamp(h.y * (1.0 + ds), 0.0, 1.0);
    h.z = clamp(h.z * (1.0 + dv * 0.6), 0.0, 1.0);
    c = hsv2rgb(h);
  }

  if (uCurvesOn) {
    vec3 x = clamp(c, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0;
    c = vec3(texture(uCurves, vec2(x.r, 0.5)).r, texture(uCurves, vec2(x.g, 0.5)).g, texture(uCurves, vec2(x.b, 0.5)).b);
    x = clamp(c, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0;
    c = vec3(texture(uCurves, vec2(x.r, 0.5)).a, texture(uCurves, vec2(x.g, 0.5)).a, texture(uCurves, vec2(x.b, 0.5)).a);
  }

  if (uWheelsOn) {
    vec3 lift = (uLift.rgb + uLift.a) * 0.3;
    vec3 gain = 1.0 + (uGain.rgb + uGain.a) * 0.5;
    vec3 gam = 1.0 + (uGammaW.rgb + uGammaW.a) * 0.6;
    vec3 g = (clamp(c, 0.0, 1.0) + lift * (1.0 - clamp(c, 0.0, 1.0))) * gain;
    g = pow(max(g, vec3(0.0)), 1.0 / max(gam, vec3(0.05)));
    g += (uOffsetW.rgb + uOffsetW.a) * 0.2;
    // Left arcs: saturation weighted by tone range (offset = whole picture).
    float Lw = luma(clamp(g, 0.0, 1.0));
    float ws = 1.0 - smoothstep(0.0, 0.5, Lw), wh = smoothstep(0.5, 1.0, Lw), wm = clamp(1.0 - ws - wh, 0.0, 1.0);
    float sf = 1.0 + uSatW.x * ws + uSatW.y * wm + uSatW.z * wh + uSatW.w;
    g = mix(vec3(Lw), g, max(sf, 0.0));
    c = mix(c, g, uWheelAmt);
  }

  // Filter = 3D LUT; scale/offset address texel centres so hardware trilinear is exact.
  if (uLutOn) c = mix(c, texture(uLut, clamp(c, 0.0, 1.0) * uLutScale + uLutOffset).rgb, uFilterAmt);

  // Adjust › LUT, optionally easing off on skin tones.
  if (uLut2On) {
    vec3 l = texture(uLut2, clamp(c, 0.0, 1.0) * uLut2Scale + uLut2Offset).rgb;
    float k = uLut2Amt;
    if (uSkin) {
      vec3 hs = rgb2hsv(clamp(orig, 0.0, 1.0));
      float deg = hs.x * 360.0;
      float skin = smoothstep(0.0, 12.0, deg) * (1.0 - smoothstep(40.0, 55.0, deg)) * smoothstep(0.12, 0.25, hs.y) * (1.0 - smoothstep(0.65, 0.8, hs.y));
      k *= 1.0 - 0.75 * skin;
    }
    c = mix(c, l, k);
  }

  if (uEffect == 3) c += (hash(vUv * 1000.0 + fract(uTime * 7.0) * 100.0) - 0.5) * 0.22 * uEffectAmt;
  if (uEffect == 5) c = mix(c, 1.0 - c, uEffectAmt);
  if (uEffect == 7) c = mix(c, c * (0.85 + 0.15 * sin(vUv.y * 900.0)), uEffectAmt) + (hash(vUv * 500.0 + uTime) - 0.5) * 0.06 * uEffectAmt;
  if (uEffect == 8) c += pow(max(0.0, sin(uTime * 3.14159 * 2.0)), 12.0) * uEffectAmt * 0.8;

  if (uAdjOn) {
    c = c * (1.0 - 0.25 * uFade) + 0.12 * uFade;
    if (uParticles > 0.001) c += (hash(vUv * 1200.0 + fract(uTime * 9.0) * 50.0) - 0.5) * 0.25 * uParticles;
    // Vignette: positive darkens the edges, negative brightens them.
    if (abs(uVignette) > 0.001) { vec2 d = vUv - 0.5; c *= 1.0 - smoothstep(0.25, 0.85, length(d) * 1.2) * uVignette; }
  }

  if (uMaskType > 0) {
    float m = maskValue(vUv);
    if (uMaskInv) m = 1.0 - m;
    c = mix(orig, c, m);
  }

  outColor = vec4(clamp(c, 0.0, 1.0) * col.a * uOpacity, col.a * uOpacity);
}`;

type UniformMap = Record<string, WebGLUniformLocation | null>;

interface TexSlot { tex: WebGLTexture; key: unknown; w: number; h: number; used: number }

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class Compositor {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: UniformMap = {};
  private textures = new Map<string, TexSlot>();
  private frame = 0;
  /** Copy of the frame so far, used as input by adjustment (effect/filter) layers. */
  private scratch: { tex: WebGLTexture; w: number; h: number } | null = null;
  private targets: Target[] = [];
  private transitionProgs = new Map<string, WebGLProgram | null>();
  private luts = new Map<string, { tex: WebGLTexture; size: number } | null>();
  private fxProgs = new Map<string, WebGLProgram | null>();
  /** Framebuffer currently being drawn into (null = canvas); restored after offscreen passes. */
  private curFb: WebGLFramebuffer | null = null;
  private aniso: EXT_texture_filter_anisotropic | null;

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true, desynchronized: true,
    } as WebGLContextAttributes) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.prog = this.link(VERT, FRAG);
    gl.useProgram(this.prog);
    const names = [
      'uCanvas', 'uCenter', 'uSize', 'uRot', 'uTex', 'uRot90', 'uFlipX', 'uFlipY', 'uTexel', 'uOpacity', 'uWipeMode', 'uWipe', 'uBlur', 'uTime',
      'uBrightness', 'uContrast', 'uSaturation', 'uExposure', 'uTemp', 'uTint', 'uHue', 'uVignette', 'uSharpen',
      'uLut', 'uLutOn', 'uLutScale', 'uLutOffset', 'uFilterAmt', 'uEffect', 'uEffectAmt', 'uKey', 'uKeyParam',
      'uHighlight', 'uShadow', 'uWhites', 'uBlacks', 'uBrilliance', 'uClarity', 'uParticles', 'uFade', 'uAdjOn',
      'uHslOn', 'uHsl', 'uCurvesOn', 'uCurves', 'uWheelsOn', 'uLift', 'uGammaW', 'uGain', 'uOffsetW', 'uWheelAmt', 'uSatW',
      'uLut2', 'uLut2On', 'uLut2Scale', 'uLut2Offset', 'uLut2Amt', 'uSkin',
      'uMaskType', 'uMaskRect', 'uMaskScale', 'uMaskRound', 'uMaskRot', 'uMaskFeather', 'uMaskInv',
    ];
    for (const n of names) this.u[n] = gl.getUniformLocation(this.prog, n);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = 0;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(this.u.uTex, 0);
    gl.uniform1i(this.u.uLut, 3);
    gl.uniform1i(this.u.uLut2, 4);
    gl.uniform1i(this.u.uCurves, 5);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  private link(vs: string, fs: string) {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
      return sh;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    // Every program reads the shared unit quad from attribute 0.
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
    return p;
  }

  resize(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** False when the texture for `id` already holds `key`, so the caller can skip creating a source. */
  needsUpload(id: string, key: unknown) {
    return this.textures.get(id)?.key !== key;
  }

  private upload(layer: Layer): TexSlot {
    const gl = this.gl;
    let slot = this.textures.get(layer.id);
    if (!slot) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      slot = { tex, key: null, w: 0, h: 0, used: 0 };
      this.textures.set(layer.id, slot);
    }
    gl.bindTexture(gl.TEXTURE_2D, slot.tex);
    if (slot.key !== layer.sourceKey) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.source);
      // Mipmaps avoid shimmer/aliasing when a 4K frame or large photo is drawn small.
      gl.generateMipmap(gl.TEXTURE_2D);
      slot.key = layer.sourceKey;
      slot.w = layer.texW;
      slot.h = layer.texH;
    }
    slot.used = this.frame;
    return slot;
  }

  /** Draws layers bottom-to-top onto a canvas of `projW`×`projH` logical pixels. */
  render(layers: AnyLayer[], projW: number, projH: number, background: string) {
    const gl = this.gl;
    this.frame++;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const [r, g, b] = hexToRgb(background);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    this.projW = projW;
    this.projH = projH;
    gl.uniform2f(this.u.uCanvas, projW, projH);
    this.drawList(layers);
    this.gc();
  }

  private projW = 1;
  private projH = 1;

  private drawList(layers: AnyLayer[]) {
    for (const L of layers) {
      if (isXfade(L)) this.drawXfade(L);
      else if (isNested(L)) this.drawNested(L);
      else this.drawLayer(L);
    }
  }

  private drawNested(n: NestedLayer) {
    const gl = this.gl;
    const t = this.target(3);
    const prevFb = this.curFb;
    const outerW = this.projW, outerH = this.projH;
    // Render the sub-timeline full-frame into its own buffer (opaque black background).
    this.curFb = t.fb;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, t.w, t.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    this.projW = n.w; this.projH = n.h;
    gl.uniform2f(this.u.uCanvas, n.w, n.h);
    this.drawList(n.layers);
    // Back to the outer timeline: draw the result like any clip.
    this.curFb = prevFb;
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    this.projW = outerW; this.projH = outerH;
    gl.uniform2f(this.u.uCanvas, outerW, outerH);
    this.drawLayer({ id: n.id, source: PLACEHOLDER_SRC, sourceKey: null, texW: t.w, texH: t.h, rotation: 0, geom: n.geom, clip: n.clip, tex: t.tex });
  }

  /** Draws a layer; library effects (fxlib) run as an extra full-frame pass. */
  private drawLayer(L: Layer) {
    const fx = fxById(L.clip.effect.id);
    if (!fx) { this.drawLayerBase(L); return; }
    const gl = this.gl;
    if (L.post) {
      // Effect layer: process everything rendered so far.
      const s = this.snapshot();
      this.fxPass(fx.id, s.tex, L, L.geom.opacity);
      return;
    }
    const t = this.target(2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, t.w, t.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.drawLayerBase(L);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.curFb);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.fxPass(fx.id, t.tex, L, 1);
  }

  private fxPass(id: string, tex: WebGLTexture, L: Layer, opacity: number) {
    const gl = this.gl;
    const prog = this.fxProgram(id);
    if (!prog) return;
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    gl.uniform1i(u('uTex'), 1);
    gl.uniform1f(u('uTime'), L.geom.local);
    gl.uniform1f(u('uAmount'), L.clip.effect.intensity);
    gl.uniform1f(u('uRatio'), this.canvas.width / this.canvas.height);
    gl.uniform2f(u('uTexel'), 1 / this.canvas.width, 1 / this.canvas.height);
    gl.uniform1f(u('uOpacity'), opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(this.prog);
  }

  private fxProgram(id: string): WebGLProgram | null {
    if (this.fxProgs.has(id)) return this.fxProgs.get(id)!;
    const def = fxById(id);
    let prog: WebGLProgram | null = null;
    if (def) {
      try { prog = this.link(FX_VERT, fxFragment(def)); } catch (err) { console.warn(`[kinora] effect ${id} failed to compile`, err); }
    }
    this.fxProgs.set(id, prog);
    return prog;
  }

  /** True if an effect's shader compiles on this GPU. */
  supportsFx(id: string) { return !!this.fxProgram(id); }

  private drawLayerBase(L: Layer) {
    const gl = this.gl;
    const G = L.geom;
    if (G.opacity <= 0.001 || G.w < 0.5 || G.h < 0.5) return;
    let texW = L.texW, texH = L.texH;
    gl.activeTexture(gl.TEXTURE0);
    if (L.tex) {
      gl.bindTexture(gl.TEXTURE_2D, L.tex);
    } else if (L.post) {
      // Snapshot the canvas (drawing buffer rows are bottom-up, hence uFlipY).
      const s = this.snapshot();
      texW = s.w; texH = s.h;
    } else this.upload(L);
    const c = L.clip;
    const a = c.adjust;
    const rot90 = ((Math.round(L.rotation / 90) % 4) + 4) % 4;
    const dispW = rot90 % 2 ? texH : texW;
    const dispH = rot90 % 2 ? texW : texH;
    const u = this.u;
    gl.uniform2f(u.uCenter, G.cx, G.cy);
    gl.uniform2f(u.uSize, G.w, G.h);
    gl.uniform1f(u.uRot, G.rotation);
    gl.uniform1i(u.uRot90, rot90);
    gl.uniform1i(u.uFlipX, G.flipX ? 1 : 0);
    gl.uniform1i(u.uFlipY, L.post || L.tex ? 1 : 0);
    gl.uniform2f(u.uTexel, 1 / Math.max(1, dispW), 1 / Math.max(1, dispH));
    gl.uniform1f(u.uOpacity, G.opacity);
    gl.uniform1i(u.uWipeMode, G.wipeMode);
    gl.uniform1f(u.uWipe, G.wipe);
    gl.uniform1f(u.uBlur, G.blur);
    gl.uniform1f(u.uTime, G.local);
    gl.uniform1f(u.uBrightness, a.brightness);
    gl.uniform1f(u.uContrast, a.contrast);
    gl.uniform1f(u.uSaturation, a.saturation);
    gl.uniform1f(u.uExposure, a.exposure);
    gl.uniform1f(u.uTemp, a.temperature);
    gl.uniform1f(u.uTint, a.tint);
    gl.uniform1f(u.uHue, a.hue);
    gl.uniform1f(u.uVignette, a.vignette);
    gl.uniform1f(u.uSharpen, a.sharpen);
    const lut = c.filter.id !== 'none' ? this.lutTexture(c.filter.id) : null;
    gl.uniform1i(u.uLutOn, lut ? 1 : 0);
    if (lut) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_3D, lut.tex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(u.uLutScale, (lut.size - 1) / lut.size);
      gl.uniform1f(u.uLutOffset, 0.5 / lut.size);
    }
    gl.uniform1f(u.uFilterAmt, c.filter.intensity);
    this.setGradeUniforms(c);
    const short = Math.max(1, Math.min(G.w, G.h));
    gl.uniform2f(u.uMaskScale, G.w / short, G.h / short);
    gl.uniform1i(u.uEffect, lookCode(EFFECTS, c.effect.id));
    gl.uniform1f(u.uEffectAmt, c.effect.intensity);
    const [kr, kg, kb] = hexToRgb(c.chroma.color);
    gl.uniform4f(u.uKey, kr, kg, kb, c.chroma.enabled ? 1 : 0);
    gl.uniform2f(u.uKeyParam, c.chroma.similarity, c.chroma.smoothness);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Offscreen RGBA render target the size of the canvas. */
  private target(i: number): Target {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    let t = this.targets[i];
    if (!t) {
      const tex = gl.createTexture()!;
      const fb = gl.createFramebuffer()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      t = this.targets[i] = { fb, tex, w: 0, h: 0 };
    }
    if (t.w !== w || t.h !== h) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      t.w = w; t.h = h;
    }
    return t;
  }

  private curveTex = new Map<string, { tex: WebGLTexture; key: string }>();

  /** Adjust tab: tone, HSL, curves, wheels, LUT, mask. Absent settings are neutral. */
  private setGradeUniforms(c: Clip) {
    const gl = this.gl, u = this.u, a = c.adjust;
    gl.uniform1i(u.uAdjOn, c.adjustOn === false ? 0 : 1);
    gl.uniform1f(u.uHighlight, a.highlight ?? 0);
    gl.uniform1f(u.uShadow, a.shadow ?? 0);
    gl.uniform1f(u.uWhites, a.whites ?? 0);
    gl.uniform1f(u.uBlacks, a.blacks ?? 0);
    gl.uniform1f(u.uBrilliance, a.brilliance ?? 0);
    gl.uniform1f(u.uClarity, a.clarity ?? 0);
    gl.uniform1f(u.uParticles, a.particles ?? 0);
    gl.uniform1f(u.uFade, a.fade ?? 0);

    const hslOn = !!c.hsl && c.hslOn !== false && c.hsl.some((b) => b.some((v) => Math.abs(v) > 1e-4));
    gl.uniform1i(u.uHslOn, hslOn ? 1 : 0);
    if (hslOn) gl.uniform1fv(u.uHsl, c.hsl!.flat());

    const curvesOn = !curvesNeutral(c.curves);
    gl.uniform1i(u.uCurvesOn, curvesOn ? 1 : 0);
    if (curvesOn) {
      const key = JSON.stringify(c.curves);
      let slot = this.curveTex.get(c.id);
      if (!slot) {
        const tex = gl.createTexture()!;
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        slot = { tex, key: '' };
        this.curveTex.set(c.id, slot);
      }
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, slot.tex);
      if (slot.key !== key) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bakeCurves(c.curves!));
        slot.key = key;
      }
      gl.activeTexture(gl.TEXTURE0);
    }

    const w = c.wheels;
    const wheelsOn = !!w && w.enabled && w.intensity > 0 && [w.shadows, w.mid, w.high, w.offset].some((x) => x.some((v) => Math.abs(v ?? 0) > 1e-4));
    gl.uniform1i(u.uWheelsOn, wheelsOn ? 1 : 0);
    if (wheelsOn) {
      gl.uniform4fv(u.uLift, w!.shadows.slice(0, 4) as number[]);
      gl.uniform4fv(u.uGammaW, w!.mid.slice(0, 4) as number[]);
      gl.uniform4fv(u.uGain, w!.high.slice(0, 4) as number[]);
      gl.uniform4fv(u.uOffsetW, w!.offset.slice(0, 4) as number[]);
      gl.uniform4f(u.uSatW, w!.shadows[4] ?? 0, w!.mid[4] ?? 0, w!.high[4] ?? 0, w!.offset[4] ?? 0);
      gl.uniform1f(u.uWheelAmt, w!.intensity);
    }

    const lut2 = c.lut && c.lut.id !== 'none' ? this.lutTexture(c.lut.id) : null;
    gl.uniform1i(u.uLut2On, lut2 ? 1 : 0);
    if (lut2) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_3D, lut2.tex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(u.uLut2Scale, (lut2.size - 1) / lut2.size);
      gl.uniform1f(u.uLut2Offset, 0.5 / lut2.size);
      gl.uniform1f(u.uLut2Amt, c.lut!.intensity);
      gl.uniform1i(u.uSkin, c.lut!.protectSkin ? 1 : 0);
    }

    const MASKS = { split: 1, filmstrip: 2, circle: 3, rectangle: 4, star: 5, heart: 6 } as const;
    const m = c.adjMask;
    gl.uniform1i(u.uMaskType, m && m.enabled ? MASKS[m.type] : 0);
    if (m && m.enabled) {
      gl.uniform4f(u.uMaskRect, m.x, m.y, m.w, m.h);
      gl.uniform1f(u.uMaskRot, (m.rotation * Math.PI) / 180);
      gl.uniform1f(u.uMaskFeather, m.feather);
      gl.uniform1i(u.uMaskInv, m.invert ? 1 : 0);
      gl.uniform1f(u.uMaskRound, m.round ?? 0);
    }
  }

  /** 3D texture for a filter's LUT (uploaded once per compositor). */
  private lutTexture(id: string) {
    if (this.luts.has(id)) return this.luts.get(id)!;
    const d = lutData(id);
    let entry: { tex: WebGLTexture; size: number } | null = null;
    if (d) {
      const gl = this.gl;
      const tex = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_3D, tex);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, d.size, d.size, d.size, 0, gl.RGB, gl.UNSIGNED_BYTE, d.data);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.activeTexture(gl.TEXTURE0);
      entry = { tex, size: d.size };
    }
    this.luts.set(id, entry);
    return entry;
  }

  private transitionProgram(name: string): WebGLProgram | null {
    if (this.transitionProgs.has(name)) return this.transitionProgs.get(name)!;
    const t = transitionByName(name);
    let prog: WebGLProgram | null = null;
    if (t) {
      try {
        prog = this.link(TRANSITION_VERT, transitionFragment(t));
        const gl = this.gl;
        gl.useProgram(prog);
        gl.uniform1i(gl.getUniformLocation(prog, 'from'), 1);
        gl.uniform1i(gl.getUniformLocation(prog, 'to'), 2);
        setTransitionParams(gl, prog, t);
      } catch (err) {
        console.warn(`[kinora] transition ${name} failed to compile`, err);
        prog = null;
      }
    }
    this.transitionProgs.set(name, prog);
    return prog;
  }

  private drawXfade(x: XfadeLayer) {
    const gl = this.gl;
    // Render each side into its own transparent offscreen buffer.
    const prevFb = this.curFb;
    const sides = [x.from, x.to].map((L, i) => {
      const t = this.target(i);
      this.curFb = t.fb;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.viewport(0, 0, t.w, t.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (L) this.drawList([L]);
      return t;
    });
    // Restore whatever we were drawing into (the canvas, or a template's buffer).
    this.curFb = prevFb;
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const prog = this.transitionProgram(x.transition) ?? this.transitionProgram('fade');
    if (prog) {
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, sides[0].tex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, sides[1].tex);
      gl.uniform1f(gl.getUniformLocation(prog, 'progress'), Math.min(1, Math.max(0, x.progress)));
      gl.uniform1f(gl.getUniformLocation(prog, 'ratio'), this.canvas.width / this.canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.useProgram(this.prog);
  }

  private snapshot() {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    if (!this.scratch) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.scratch = { tex, w: 0, h: 0 };
    }
    gl.bindTexture(gl.TEXTURE_2D, this.scratch.tex);
    // The drawing buffer has no alpha channel, so copy as RGB.
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, w, h, 0);
    this.scratch.w = w;
    this.scratch.h = h;
    return this.scratch;
  }

  /** Frees textures of layers not drawn for a while. */
  private gc() {
    if (this.frame % 120 !== 0) return;
    for (const [id, slot] of this.textures) {
      if (this.frame - slot.used > 240) {
        this.gl.deleteTexture(slot.tex);
        this.textures.delete(id);
      }
    }
  }

  dispose() {
    for (const s of this.textures.values()) this.gl.deleteTexture(s.tex);
    this.textures.clear();
    if (this.scratch) this.gl.deleteTexture(this.scratch.tex);
    // Sparse: buffer 2 (effect pass) can exist without the transition buffers 0/1.
    for (const t of this.targets) if (t) { this.gl.deleteTexture(t.tex); this.gl.deleteFramebuffer(t.fb); }
    for (const p of this.transitionProgs.values()) if (p) this.gl.deleteProgram(p);
    for (const l of this.luts.values()) if (l) this.gl.deleteTexture(l.tex);
    for (const p of this.fxProgs.values()) if (p) this.gl.deleteProgram(p);
    for (const t of this.curveTex.values()) this.gl.deleteTexture(t.tex);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
