// 3D colour look-up tables: every filter is a LUT the compositor samples on the GPU.
// Built-in looks are generated from small colour functions; users can import .cube files.

export const LUT_SIZE = 33;

type RGB = [number, number, number];
type Grade = (c: RGB) => RGB;

export interface LutDef {
  id: string;
  name: string;
  category: string;
  /** Built-ins: colour function baked on first use. */
  grade?: Grade;
  /** Imported: baked RGB8 data, red fastest, then green, then blue (.cube order). */
  data?: Uint8Array;
  size?: number;
}

export const LUT_CATEGORIES = ['Life', 'Film', 'Cinematic', 'Retro', 'B&W', 'Mood'];

const clamp = (v: number) => Math.min(1, Math.max(0, v));

// Built-in looks are served from R2 as baked LUT data (see src/engine/assets.ts) and register here.
const BUILTIN: LutDef[] = [];

/** Adds a downloaded built-in look. */
export function registerLut(def: LutDef) {
  const at = BUILTIN.findIndex((l) => l.id === def.id);
  if (at >= 0) BUILTIN[at] = def; else BUILTIN.push(def);
}

// ---- registry ---------------------------------------------------------------------

const custom: LutDef[] = [];
const baked = new Map<string, Uint8Array>();
const SAVED = 'kinora.customLuts';

export const lutList = (): LutDef[] => [...BUILTIN, ...custom];
export const lutById = (id: string) => lutList().find((l) => l.id === id);
export const lutName = (id: string) => (id === 'none' ? 'None' : lutById(id)?.name ?? id);

/** RGB8 data for a filter (baking built-ins on first use), or null for none/unknown. */
export function lutData(id: string): { size: number; data: Uint8Array } | null {
  const def = lutById(id);
  if (!def) return null;
  if (def.data) return { size: def.size!, data: def.data };
  let data = baked.get(id);
  if (!data) {
    const n = LUT_SIZE;
    data = new Uint8Array(n * n * n * 3);
    let o = 0;
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
      const out = def.grade!([r / (n - 1), g / (n - 1), b / (n - 1)]);
      data[o++] = Math.round(clamp(out[0]) * 255);
      data[o++] = Math.round(clamp(out[1]) * 255);
      data[o++] = Math.round(clamp(out[2]) * 255);
    }
    baked.set(id, data);
  }
  return { size: LUT_SIZE, data };
}

/** Parses an Adobe/Resolve .cube file (3D LUTs up to 65³). */
export function parseCube(text: string): { size: number; data: Uint8Array; title?: string } {
  let size = 0, title: string | undefined;
  let min: RGB = [0, 0, 0], max: RGB = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [key, ...rest] = line.split(/\s+/);
    if (key === 'TITLE') title = line.slice(5).trim().replace(/^"|"$/g, '');
    else if (key === 'LUT_3D_SIZE') size = parseInt(rest[0], 10);
    else if (key === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported; use a 3D .cube file.');
    else if (key === 'DOMAIN_MIN') min = rest.map(Number) as RGB;
    else if (key === 'DOMAIN_MAX') max = rest.map(Number) as RGB;
    else if (/^[-\d.]/.test(key)) values.push(Number(key), Number(rest[0]), Number(rest[1]));
  }
  if (!size || size < 2 || size > 65) throw new Error('Missing or unsupported LUT_3D_SIZE');
  if (values.length < size * size * size * 3) throw new Error('The .cube file is incomplete');
  const data = new Uint8Array(size * size * size * 3);
  for (let i = 0; i < data.length; i++) {
    const ch = i % 3;
    data[i] = Math.round(clamp((values[i] - min[ch]) / (max[ch] - min[ch] || 1)) * 255);
  }
  return { size, data, title };
}

const toB64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b: string) => Uint8Array.from(atob(b), (ch) => ch.charCodeAt(0));

function persist() {
  try {
    localStorage.setItem(SAVED, JSON.stringify(custom.map((l) => ({ id: l.id, name: l.name, size: l.size, data: toB64(l.data!) }))));
  } catch { /* storage full or blocked: keeps working for this session */ }
}

/** Adds an imported .cube as a "Custom" filter. */
export function importCube(text: string, fileName: string): LutDef {
  const { size, data, title } = parseCube(text);
  const def: LutDef = { id: `lut-${Date.now().toString(36)}`, name: title || fileName.replace(/\.cube$/i, ''), category: 'Custom', data, size };
  custom.push(def);
  persist();
  return def;
}

export function removeCustomLut(id: string) {
  const i = custom.findIndex((l) => l.id === id);
  if (i >= 0) { custom.splice(i, 1); persist(); }
}

// Restore imported LUTs from previous sessions.
try {
  for (const s of JSON.parse(localStorage.getItem(SAVED) ?? '[]') as { id: string; name: string; size: number; data: string }[]) {
    custom.push({ id: s.id, name: s.name, category: 'Custom', size: s.size, data: fromB64(s.data) });
  }
} catch { /* ignore corrupt storage */ }
