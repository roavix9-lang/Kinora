// Effect shader library. Each effect is a GLSL snippet defining `vec4 effect(vec2 uv)`;
// the compositor runs it as a full-frame pass over the clip (or, for effect layers, over
// everything below). uv is GL-convention: (0,0) bottom-left, y up.
// Available: getColor(uv), uTime (s), uAmount (0..1), uRatio (w/h), uTexel (1/px),
// helpers hash, noise, luma, hueRotate, blurAt, edge.

export interface FxDef { id: string; name: string; category: string; moving: boolean; glsl: string }

export const FX_CATEGORIES = ['Light', 'Retro', 'Glitch', 'Distort', 'Blur', 'Artistic', 'Party', 'Weather'];

// The effect library is served from R2 (see src/engine/assets.ts); downloaded effects register here.
export const FX: FxDef[] = [];

export const fxById = (id: string) => FX.find((f) => f.id === id);

const HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uTime, uAmount, uRatio, uOpacity;
uniform vec2 uTexel;
vec4 getColor(vec2 uv) { return texture(uTex, clamp(uv, 0.0, 1.0)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
vec4 blurAt(vec2 uv, float r) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 2.39996;
    float d = sqrt((float(i) + 0.5) / 16.0) * r;
    acc += getColor(uv + vec2(cos(a) / uRatio, sin(a)) * d);
  }
  return acc / 16.0;
}
float edge(vec2 uv) {
  vec2 t = uTexel;
  float tl = luma(getColor(uv + vec2(-t.x, t.y)).rgb), tc = luma(getColor(uv + vec2(0.0, t.y)).rgb), tr = luma(getColor(uv + t).rgb);
  float ml = luma(getColor(uv - vec2(t.x, 0.0)).rgb), mr = luma(getColor(uv + vec2(t.x, 0.0)).rgb);
  float bl = luma(getColor(uv - t).rgb), bc = luma(getColor(uv - vec2(0.0, t.y)).rgb), br = luma(getColor(uv + vec2(t.x, -t.y)).rgb);
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  return length(vec2(gx, gy));
}
`;

export const FX_VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); vUv = aPos; }`;

export const fxFragment = (f: FxDef) => `${HEAD}\n${f.glsl}\nvoid main() { vec4 c = effect(vUv); outColor = c * uOpacity; }`;
