import { store } from '../store';
import { registerSticker, StickerDef } from '../stickers';
import { FX, FxDef } from './fxlib';
import { GLTransition, registerTransition } from './gltransitions';
import { registerLut } from './luts';
import { registerTemplate, TEMPLATES, TemplateDef } from '../templates';
import { AnimDef, registerAnim } from './anims';
import { importFiles } from './media';

// Library assets (stickers, effects, filters, transitions, templates) live in Cloudflare:
// the catalog in D1 and the files in R2, served by the kinora-api Worker. The app only
// ships the code. "Download" saves an asset in the browser's Cache Storage, so it keeps
// working offline; downloaded assets register into the in-memory libraries at startup.

export type AssetKind = 'stickers' | 'effects' | 'filters' | 'transitions' | 'animations' | 'templates' | 'music' | 'sounds';

export interface CatalogItem {
  kind: AssetKind;
  id: string;
  name: string;
  category: string;
  sort: number;
  file: string;
  thumb: string | null;
  size: number;
  version: number;
  meta: Record<string, unknown>;
}

export const API = (import.meta.env.VITE_KINORA_API as string | undefined) ?? 'https://kinora-api.roavix9.workers.dev';
const CACHE = 'kinora-assets-v1';
const CATALOG_KEY = 'kinora.catalog';
const DOWNLOADED_KEY = 'kinora.downloaded';

const EMPTY = (): Record<AssetKind, CatalogItem[]> => ({ stickers: [], effects: [], filters: [], transitions: [], animations: [], templates: [], music: [], sounds: [] });
let catalog = EMPTY();
const downloading = new Map<string, Promise<boolean>>();
/** Automatic downloads that failed this session (not retried in a loop while offline). */
const failed = new Set<string>();
const listeners = new Set<() => void>();

const keyOf = (kind: AssetKind, id: string) => `${kind}:${id}`;
const read = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

/** kind:id → version of every downloaded asset. */
let downloaded: Record<string, number> = read(DOWNLOADED_KEY, {});

/** Public URL of an R2 object (keys may contain %-escapes, so each segment is encoded again). */
export const assetUrl = (key: string) => {
  // Music and sound effects stay on their source sites; Jamendo sends no CORS headers, so it
  // goes through the Worker's pass-through (not stored anywhere).
  if (/^https?:/.test(key)) return /(^|\.)jamendo\.com$/.test(new URL(key).hostname) ? `${API}/p?u=${encodeURIComponent(key)}` : key;
  return `${API}/a/${key.split('/').map(encodeURIComponent).join('/')}`;
};
/** R2 files are cached for a year as immutable; the version in the URL makes a replaced file fetch fresh. */
const versioned = (key: string, v: number) => `${assetUrl(key)}${/^https?:/.test(key) ? '' : `?v=${v}`}`;
export const thumbUrl = (item: CatalogItem) => (item.thumb ? (/^https?:/.test(item.thumb) ? item.thumb : versioned(item.thumb, item.version)) : '');
/** Media id a downloaded song / sound effect gets (stable, so saved projects find it again). */
export const libraryMediaId = (kind: AssetKind, id: string) => `lib-${kind}-${id}`;

export const catalogOf = (kind: AssetKind) => (kind === 'templates' ? [...mine, ...catalog.templates] : catalog[kind]);
export const catalogItem = (kind: AssetKind, id: string) => catalogOf(kind).find((x) => x.id === id);
export const isDownloaded = (kind: AssetKind, id: string) => keyOf(kind, id) in downloaded;
export const isDownloading = (kind: AssetKind, id: string) => downloading.has(keyOf(kind, id));
export function onAssetsChanged(fn: () => void) { listeners.add(fn); }
const changed = () => { listeners.forEach((fn) => fn()); store.emit('view', 'media'); };

/** Puts a downloaded asset's data into the matching in-memory library. */
async function register(item: CatalogItem, raw: Response) {
  // Library files are stored gzip-compressed in R2 (and in the offline cache); unpack on use.
  const res = item.file.endsWith('.gz') && raw.body ? new Response(raw.body.pipeThrough(new DecompressionStream('gzip'))) : raw;
  switch (item.kind) {
    case 'stickers': registerSticker(await res.json() as StickerDef); break;
    case 'effects': {
      const def = await res.json() as FxDef;
      const at = FX.findIndex((f) => f.id === def.id);
      if (at >= 0) FX[at] = def; else FX.push(def);
      break;
    }
    case 'filters': registerLut({ id: item.id, name: item.name, category: item.category, data: new Uint8Array(await res.arrayBuffer()), size: Number(item.meta.size) || 33 }); break;
    case 'transitions': registerTransition(await res.json() as GLTransition); break;
    case 'animations': registerAnim({ ...(await res.json() as AnimDef), id: item.id, name: item.name }); break;
    case 'templates': {
      registerTemplate({ ...(await res.json() as TemplateDef), id: item.id, name: item.name });
      break;
    }
    case 'music': case 'sounds': {
      const mid = libraryMediaId(item.kind, item.id);
      if (store.media.has(mid)) break;
      const blob = await res.blob();
      const file = new File([blob], `${item.name}.mp3`, { type: blob.type || 'audio/mpeg' });
      void importFiles([file], [{ id: mid, name: item.name, library: true, deleted: true }]);
      break;
    }
  }
}

async function openCache() {
  try { return await caches.open(CACHE); } catch { return null; }
}

/** An R2 file from the offline cache, or fetched (and cached) when it isn't there yet. */
export async function fetchCached(key: string): Promise<Blob> {
  const url = assetUrl(key);
  const cache = await openCache();
  const hit = await cache?.match(url);
  if (hit) return hit.blob();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await cache?.put(url, res.clone());
  return res.blob();
}

/** Downloads an asset (and its tile picture) for offline use. Resolves true when ready. */
export function download(kind: AssetKind, id: string, extra?: CatalogItem): Promise<boolean> {
  const k = keyOf(kind, id);
  const running = downloading.get(k);
  if (running) return running;
  if (extra && !catalogItem(kind, id)) { catalog[kind] = [...catalog[kind], extra]; write(CATALOG_KEY, catalog); }
  const item = catalogItem(kind, id);
  if (!item) return Promise.resolve(false);
  const job = (async () => {
    try {
      const res = await fetch(versioned(item.file, item.version));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cache = await openCache();
      await cache?.put(assetUrl(item.file), res.clone());
      if (item.thumb) {
        const t = await fetch(thumbUrl(item)).catch(() => null);
        if (t?.ok) await cache?.put(thumbUrl(item), t);
      }
      await register(item, res);
      downloaded = { ...downloaded, [k]: item.version };
      write(DOWNLOADED_KEY, downloaded);
      return true;
    } catch {
      failed.add(k);
      return false;
    } finally {
      downloading.delete(k);
      changed();
    }
  })();
  downloading.set(k, job);
  changed();
  return job;
}

/** Downloads anything a project refers to that isn't here yet (e.g. an opened project). */
export function ensureAssets(refs: { kind: AssetKind; id: string }[]) {
  for (const r of refs) {
    if (!isDownloaded(r.kind, r.id) && !failed.has(keyOf(r.kind, r.id)) && catalogItem(r.kind, r.id)) void download(r.kind, r.id);
  }
}

/** Every library asset a project uses, including what its templates use inside. */
function projectRefs(): { kind: AssetKind; id: string }[] {
  const refs: { kind: AssetKind; id: string }[] = [];
  for (const t of store.project.tracks) for (const c of t.clips) {
    if (c.sticker) refs.push({ kind: 'stickers', id: c.sticker.id });
    if (c.effect?.id && c.effect.id !== 'none') refs.push({ kind: 'effects', id: c.effect.id });
    if (c.filter?.id && c.filter.id !== 'none') refs.push({ kind: 'filters', id: c.filter.id });
    if (c.lut?.id && c.lut.id !== 'none') refs.push({ kind: 'filters', id: c.lut.id });
    if (c.crossIn?.type) refs.push({ kind: 'transitions', id: c.crossIn.type });
    for (const a of [c.transitionIn, c.transitionOut, c.combo]) if (a && a.type !== 'none') refs.push({ kind: 'animations', id: a.type });
    if (c.template) {
      refs.push({ kind: 'templates', id: c.template.id });
      const def = TEMPLATES.find((x) => x.id === c.template!.id);
      if (def) {
        if (def.transition) refs.push({ kind: 'transitions', id: def.transition });
        for (const sl of def.slots) {
          if (sl.transition) refs.push({ kind: 'transitions', id: sl.transition });
          if (sl.effect) refs.push({ kind: 'effects', id: sl.effect });
          for (const a of [sl.anim, sl.animOut, sl.combo]) if (a) refs.push({ kind: 'animations', id: a });
        }
        for (const tx of def.texts ?? []) for (const a of [tx.anim, tx.animOut]) if (a) refs.push({ kind: 'animations', id: a });
        if (def.filter) refs.push({ kind: 'filters', id: def.filter });
        for (const fx of [def.effectLayer, ...(def.effectLayers ?? [])]) if (fx) refs.push({ kind: 'effects', id: fx.id });
        for (const st of def.stickers ?? []) refs.push({ kind: 'stickers', id: st.id });
      }
    }
  }
  return refs;
}

/**
 * Startup: registers everything already downloaded (from Cache Storage, works offline),
 * then refreshes the catalog from D1 in the background.
 */
export async function initAssets() {
  catalog = { ...EMPTY(), ...read<Partial<Record<AssetKind, CatalogItem[]>>>(CATALOG_KEY, {}) };
  const cache = await openCache();
  if (cache) {
    await Promise.all(Object.keys(downloaded).map(async (k) => {
      const [kind, ...rest] = k.split(':');
      const item = catalogItem(kind as AssetKind, rest.join(':'));
      if (!item) return;
      const res = await cache.match(assetUrl(item.file));
      if (res) await register(item, res).catch(() => {});
    }));
  }
  changed();
  store.on('project', () => ensureAssets(projectRefs()));
  onAssetsChanged(() => ensureAssets(projectRefs()));
  void refreshCatalog();
  void refreshMyTemplates();
}

async function refreshCatalog() {
  try {
    const res = await fetch(`${API}/catalog`, { cache: 'no-cache' });
    if (!res.ok) return;
    const fresh = { ...EMPTY(), ...(await res.json() as Partial<Record<AssetKind, CatalogItem[]>>) };
    const first = !Object.values(catalog).some((l) => l.length);
    catalog = fresh;
    write(CATALOG_KEY, fresh);
    // Newer versions of downloaded assets update quietly.
    for (const [k, v] of Object.entries(downloaded)) {
      const [kind, ...rest] = k.split(':');
      const item = catalogItem(kind as AssetKind, rest.join(':'));
      if (item && item.version > v) void download(item.kind, item.id);
    }
    changed();
    if (first) {
      // First run: register downloaded items that had no catalog entry yet.
      const cache = await openCache();
      if (cache) for (const k of Object.keys(downloaded)) {
        const [kind, ...rest] = k.split(':');
        const item = catalogItem(kind as AssetKind, rest.join(':'));
        const r = item && await cache.match(assetUrl(item.file));
        if (item && r) await register(item, r).catch(() => {});
      }
      changed();
    }
  } catch { /* offline: keep the saved catalog */ }
}

// ---- user templates (Templates › Yours) ----------------------------------------------------

/** This device's secret key for its templates (only its SHA-256 is stored in the cloud). */
function deviceKey(): string {
  let k = read<string>('kinora.deviceKey', '');
  if (!k) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    k = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    write('kinora.deviceKey', k);
  }
  return k;
}

let mine: CatalogItem[] = read<CatalogItem[]>('kinora.myTemplates', []);
const saveMine = () => write('kinora.myTemplates', mine);

/** Loads this device's saved templates from the cloud (kept locally for offline use). */
export async function refreshMyTemplates() {
  try {
    const res = await fetch(`${API}/templates/mine`, { headers: { 'x-kinora-owner': deviceKey() }, cache: 'no-store' });
    if (!res.ok) return;
    mine = await res.json() as CatalogItem[];
    saveMine();
    changed();
  } catch { /* offline: keep the saved list */ }
}

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Saves a template to the cloud: gzip-compressed JSON plus a small WebP cover. */
/** How many templates this device can still create this week (null when offline / unknown). */
export async function templateQuota(): Promise<{ left: number; perWeek: number } | null> {
  try {
    const res = await fetch(`${API}/templates/quota`, { headers: { 'x-kinora-owner': deviceKey() }, cache: 'no-store' });
    return res.ok ? await res.json() as { left: number; perWeek: number } : null;
  } catch { return null; }
}

export async function saveMyTemplate(def: TemplateDef, cover: Blob | null): Promise<CatalogItem> {
  const raw = new Blob([JSON.stringify(def)]).stream().pipeThrough(new CompressionStream('gzip'));
  const gz = new Uint8Array(await new Response(raw).arrayBuffer());
  const body = JSON.stringify({
    name: def.name, category: def.category, ratio: def.ratio, slots: def.slots.length,
    duration: def.slots.reduce((n, s) => n + s.dur, 0), gz: toB64(gz),
    thumb: cover ? toB64(new Uint8Array(await cover.arrayBuffer())) : undefined,
  });
  const res = await fetch(`${API}/templates`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-kinora-owner': deviceKey() }, body });
  const out = await res.json() as CatalogItem & { error?: string };
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  mine = [out, ...mine.filter((m) => m.id !== out.id)];
  saveMine();
  // Usable straight away (and offline): register it and keep the compressed file cached.
  registerTemplate({ ...def, id: out.id });
  try { await (await caches.open(CACHE)).put(assetUrl(out.file), new Response(gz, { headers: { 'Content-Type': 'application/gzip' } })); } catch { /* storage blocked */ }
  downloaded = { ...downloaded, [keyOf('templates', out.id)]: out.version };
  write(DOWNLOADED_KEY, downloaded);
  changed();
  return out;
}

export async function deleteMyTemplate(id: string) {
  const res = await fetch(`${API}/templates/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-kinora-owner': deviceKey() } });
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
  mine = mine.filter((m) => m.id !== id);
  saveMine();
  changed();
}

/** Everything saved for offline use (Library › Downloads). */
export function downloadedItems(): CatalogItem[] {
  const out: CatalogItem[] = [];
  for (const k of Object.keys(downloaded)) {
    const [kind, ...rest] = k.split(':');
    const it = catalogItem(kind as AssetKind, rest.join(':'));
    if (it) out.push(it);
  }
  return out;
}

/** Removes an offline copy (it can be downloaded again any time). */
export async function removeDownload(kind: AssetKind, id: string) {
  const it = catalogItem(kind, id);
  const { [keyOf(kind, id)]: _gone, ...rest } = downloaded;
  downloaded = rest;
  write(DOWNLOADED_KEY, downloaded);
  try {
    const cache = await caches.open(CACHE);
    if (it) { await cache.delete(assetUrl(it.file)); if (it.thumb) await cache.delete(thumbUrl(it)); }
  } catch { /* storage blocked */ }
  changed();
}
