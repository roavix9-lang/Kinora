import { store } from '../store';
import { registerSticker, StickerDef } from '../stickers';
import { FX, FxDef } from './fxlib';
import { GLTransition, registerTransition } from './gltransitions';
import { registerLut } from './luts';
import { registerTemplate, TEMPLATES, TemplateDef } from '../templates';

// Library assets (stickers, effects, filters, transitions, templates) live in Cloudflare:
// the catalog in D1 and the files in R2, served by the kinora-api Worker. The app only
// ships the code. "Download" saves an asset in the browser's Cache Storage, so it keeps
// working offline; downloaded assets register into the in-memory libraries at startup.

export type AssetKind = 'stickers' | 'effects' | 'filters' | 'transitions' | 'templates';

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

const EMPTY = (): Record<AssetKind, CatalogItem[]> => ({ stickers: [], effects: [], filters: [], transitions: [], templates: [] });
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
export const assetUrl = (key: string) => `${API}/a/${key.split('/').map(encodeURIComponent).join('/')}`;
export const thumbUrl = (item: CatalogItem) => (item.thumb ? assetUrl(item.thumb) : '');

export const catalogOf = (kind: AssetKind) => catalog[kind];
export const catalogItem = (kind: AssetKind, id: string) => catalog[kind].find((x) => x.id === id);
export const isDownloaded = (kind: AssetKind, id: string) => keyOf(kind, id) in downloaded;
export const isDownloading = (kind: AssetKind, id: string) => downloading.has(keyOf(kind, id));
export function onAssetsChanged(fn: () => void) { listeners.add(fn); }
const changed = () => { listeners.forEach((fn) => fn()); store.emit('view', 'media'); };

/** Puts a downloaded asset's data into the matching in-memory library. */
async function register(item: CatalogItem, res: Response) {
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
    case 'templates': registerTemplate(await res.json() as TemplateDef); break;
  }
}

async function openCache() {
  try { return await caches.open(CACHE); } catch { return null; }
}

/** Downloads an asset (and its tile picture) for offline use. Resolves true when ready. */
export function download(kind: AssetKind, id: string): Promise<boolean> {
  const k = keyOf(kind, id);
  const running = downloading.get(k);
  if (running) return running;
  const item = catalogItem(kind, id);
  if (!item) return Promise.resolve(false);
  const job = (async () => {
    try {
      const res = await fetch(assetUrl(item.file));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cache = await openCache();
      await cache?.put(assetUrl(item.file), res.clone());
      if (item.thumb) {
        const t = await fetch(assetUrl(item.thumb)).catch(() => null);
        if (t?.ok) await cache?.put(assetUrl(item.thumb), t);
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
    if (c.template) {
      refs.push({ kind: 'templates', id: c.template.id });
      const def = TEMPLATES.find((x) => x.id === c.template!.id);
      if (def) {
        if (def.transition) refs.push({ kind: 'transitions', id: def.transition });
        for (const sl of def.slots) if (sl.transition) refs.push({ kind: 'transitions', id: sl.transition });
        if (def.filter) refs.push({ kind: 'filters', id: def.filter });
        if (def.effectLayer) refs.push({ kind: 'effects', id: def.effectLayer.id });
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
