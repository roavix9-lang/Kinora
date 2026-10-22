import { addMediaToTimeline } from '../actions';
import { AssetKind, assetUrl, CatalogItem, catalogOf, download, isDownloaded, isDownloading, libraryMediaId, thumbUrl } from '../engine/assets';
import { store } from '../store';
import { fmtTime, h, icon, toast } from './dom';

// Audio tab library (CapCut): music and sound effects under CC0 / CC BY licences, listed from
// the D1 catalog, plus live search on Openverse. Rows play a preview on click; ↓ saves the track
// for offline use, then + adds it to the timeline.

const FAV_KEY = 'kinora.favAudio';
const favs = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as string[]; } catch { return []; } })());
const saveFavs = () => { try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch { /* ignore */ } };
const favKey = (it: CatalogItem) => `${it.kind}:${it.id}`;

let query = '';
let online: CatalogItem[] = [];
let onlineFor = '';
let searchTimer = 0;

/** Categories for the left column, from the catalog (in catalog order). */
export function audioCategories(kind: 'music' | 'sounds') {
  return [...new Set(catalogOf(kind).map((x) => x.category))];
}

// ---- preview playback -----------------------------------------------------------------

const player = new Audio();
player.preload = 'none';
let playingKey = '';
/** Cover icon on every row: pause on the track that's playing, play on the rest. */
function syncRows() {
  document.querySelectorAll<HTMLElement>('.au-row').forEach((r) => {
    const on = r.dataset.key === playingKey && !player.paused;
    r.classList.toggle('playing', on);
    const btn = r.querySelector('.au-play');
    if (btn && btn.getAttribute('data-icon') !== (on ? 'pause' : 'play')) {
      btn.setAttribute('data-icon', on ? 'pause' : 'play');
      btn.replaceChildren(icon(on ? 'pause' : 'play', 14));
    }
  });
}
player.addEventListener('play', syncRows);
player.addEventListener('pause', syncRows);
player.addEventListener('ended', () => { playingKey = ''; syncRows(); });
function togglePreview(it: CatalogItem) {
  const k = favKey(it);
  if (playingKey === k && !player.paused) { player.pause(); return; }
  if (playingKey !== k) { playingKey = k; player.src = assetUrl(it.file); }
  void player.play().catch(() => toast('Could not play this track', 'error'));
  syncRows();
}
/** Stops the preview (e.g. when the player starts). */
export function stopAudioPreview() { player.pause(); }
store.on('playing', () => { if (store.playing) stopAudioPreview(); });

// ---- online search (Openverse, CC0 / CC BY only) ------------------------------------------

async function searchOnline(q: string, rerender: () => void) {
  try {
    const url = `https://api.openverse.org/v1/audio/?${new URLSearchParams({ q, license: 'cc0,by', page_size: '20' })}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json() as { results: Record<string, unknown>[] };
    if (q !== query.trim()) return;
    online = data.results.filter((r) => r.url && Number(r.duration) > 0).map((r, i) => ({
      kind: (Number(r.duration) <= 20000 ? 'sounds' : 'music') as AssetKind,
      id: String(r.id), name: String(r.title).replace(/\.(wav|mp3|aiff?|flac|ogg)$/i, '').slice(0, 80), category: 'Search', sort: i,
      file: String(r.url), thumb: (r.thumbnail as string) ?? null, size: 0, version: 1,
      meta: { artist: r.creator ?? '', duration: Math.round(Number(r.duration) / 1000), license: r.license, licenseVersion: r.license_version, licenseUrl: r.license_url, attribution: r.attribution, landing: r.foreign_landing_url, source: r.source },
    }));
    onlineFor = q;
    rerender();
  } catch { /* offline */ }
}

// ---- rows ---------------------------------------------------------------------------------

const licenseLabel = (it: CatalogItem) => (it.meta.license === 'cc0' ? 'CC0' : `CC ${String(it.meta.license ?? '').toUpperCase()}`);

function row(it: CatalogItem, rerender: () => void) {
  const have = isDownloaded(it.kind, it.id);
  const busy = isDownloading(it.kind, it.id);
  const media = have ? store.media.get(libraryMediaId(it.kind, it.id)) : undefined;
  const meta = it.meta as { artist?: string; duration?: number; attribution?: string };
  const add = () => {
    if (!media || media.status !== 'ready') { toast('Still preparing this track…'); return; }
    addMediaToTimeline(media);
    if (it.meta.license !== 'cc0' && meta.attribution) toast(`Credit the artist when you publish: ${meta.attribution.split('. To view')[0]}.`);
  };
  // The icon sits behind the cover, so tracks without artwork (or a broken one) still look right.
  const thumb = h('div.au-cover.au-icon', null, icon(it.kind === 'sounds' ? 'effects' : 'audio', 18),
    it.thumb ? h('img.au-img', { src: thumbUrl(it), alt: '', loading: 'lazy', draggable: false, onerror: (e: Event) => (e.target as HTMLElement).remove() }) : null);
  const fav = h(`button.au-btn.au-fav${favs.has(favKey(it)) ? '.on' : ''}`, {
    type: 'button', title: favs.has(favKey(it)) ? 'Remove from favourites' : 'Add to favourites',
    onclick: (e: Event) => { e.stopPropagation(); if (favs.has(favKey(it))) favs.delete(favKey(it)); else favs.add(favKey(it)); saveFavs(); rerender(); },
  }, icon('star', 15));
  const action = have
    ? h('button.au-btn.au-add', { type: 'button', title: 'Add to timeline', onclick: (e: Event) => { e.stopPropagation(); add(); } }, icon('plus', 16))
    : h(`button.au-btn${busy ? '.busy' : ''}`, {
      type: 'button', title: 'Download for offline use', 'aria-label': `Download ${it.name}`,
      onclick: async (e: Event) => {
        e.stopPropagation();
        if (!(await download(it.kind, it.id, it))) toast(`Couldn't download “${it.name}”. Check your connection.`, 'error');
      },
    }, busy ? h('div.spinner.small') : icon('download', 15));
  const el: HTMLElement = h(`div.au-row${playingKey === favKey(it) && !player.paused ? '.playing' : ''}`, {
    'data-key': favKey(it), role: 'button', tabIndex: 0, title: meta.attribution ?? it.name,
    onclick: () => togglePreview(it),
    ondblclick: () => { if (have) add(); },
  },
  h('div.au-thumb', null, thumb, h('span.au-play', { 'data-icon': playingKey === favKey(it) && !player.paused ? 'pause' : 'play' }, icon(playingKey === favKey(it) && !player.paused ? 'pause' : 'play', 14))),
  h('div.au-info', null,
    h('div.au-title', null, it.name),
    h('div.au-sub', null, `${meta.artist || 'Unknown artist'} · ${fmtTime(meta.duration ?? 0)}`, h('span.au-lic', { title: meta.attribution }, licenseLabel(it)))),
  fav, action);
  if (have && media) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => { e.dataTransfer!.setData('kinora/media', media.id); e.dataTransfer!.effectAllowed = 'copy'; });
  }
  return el;
}

/** Content of the Audio tab for a library section (`music:Cat`, `sounds:Cat` or `Favorites`). */
export function audioLibrary(body: HTMLElement, sub: string, rerender: () => void) {
  const search = h('input.tpl-search-input', { type: 'search', placeholder: 'Search music and sound effects', value: query, 'aria-label': 'Search audio' }) as HTMLInputElement;
  search.addEventListener('input', () => {
    query = search.value;
    clearTimeout(searchTimer);
    const q = query.trim();
    if (q.length >= 2) searchTimer = window.setTimeout(() => void searchOnline(q, rerender), 400);
    renderList();
  });
  body.append(h('div.tpl-searchbar', null, h('label.tpl-search', null, icon('search', 15), search)));
  const heading = h('div.section-label');
  const list = h('div.au-list');
  body.append(heading, list);

  function renderList() {
    list.replaceChildren();
    const q = query.trim().toLowerCase();
    const all = [...catalogOf('music'), ...catalogOf('sounds')];
    let items: CatalogItem[];
    if (q) {
      const local = all.filter((it) => `${it.name} ${it.meta.artist ?? ''} ${it.category}`.toLowerCase().includes(q));
      const extra = onlineFor === query.trim() ? online.filter((o) => !local.some((l) => l.id === o.id)) : [];
      items = [...local, ...extra];
      heading.textContent = `Results for “${query.trim()}”`;
    } else if (sub === 'Favorites') {
      items = all.filter((it) => favs.has(favKey(it)));
      heading.textContent = 'Favorites';
    } else {
      const [kind, cat] = sub.split(':') as ['music' | 'sounds', string];
      items = catalogOf(kind).filter((it) => it.category === cat);
      heading.textContent = cat;
    }
    if (!all.length) { list.append(h('p.hint', null, navigator.onLine ? 'Loading the audio library…' : 'Connect to the internet once to see the audio library.')); return; }
    if (!items.length) { list.append(h('p.hint', null, sub === 'Favorites' && !q ? 'Tap ☆ on a track to save it here.' : 'Nothing found. Try another search.')); return; }
    for (const it of items) list.append(row(it, rerender));
  }
  renderList();
  if (query) requestAnimationFrame(() => { search.focus(); search.setSelectionRange(query.length, query.length); });
}
