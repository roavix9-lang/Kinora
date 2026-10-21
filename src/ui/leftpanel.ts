import { addLookLayer, addMediaToTimeline, addSticker, addText, applyCrossTransition, updateClip } from '../actions';
import { libDrag, previewLook, previewMedia, previewSticker, previewText, previewTransition } from './libraryPreview';
import { allEffects, TEXT_PRESETS } from '../catalog';
import { FX_CATEGORIES } from '../engine/fxlib';
import { importCube, LUT_CATEGORIES, lutList, removeCustomLut } from '../engine/luts';
import { STICKER_CATEGORIES, stickerDataUrl, STICKERS } from '../stickers';
import { store } from '../store';
import { MediaItem } from '../types';
import { Player } from '../engine/player';
import { closeContextMenu, confirmDialog, onContextMenu } from './contextmenu';
import { clear, fmtTime, h, icon, toast } from './dom';
import { importOnly, pickFiles } from './importer';
import { TEMPLATE_CATEGORIES } from '../templates';
import { captionsTab } from './captionsPanel';
import { templatesTab } from './templatesPanel';
import { mediaMenu, MediaMenuHooks, renameMedia } from './mediaMenu';
import { animateEffect, lookPreview } from './lookPreview';
import { SAMPLE_H, SAMPLE_W } from './sampleImages';
import { animateInto, PREVIEW_SIZE, supportsTransition } from './transitionPreview';
import { AssetKind, CatalogItem, catalogOf, download, isDownloaded, isDownloading, thumbUrl } from '../engine/assets';

const TABS = [
  { id: 'media', name: 'Media', icon: 'media' },
  { id: 'audio', name: 'Audio', icon: 'audio' },
  { id: 'text', name: 'Text', icon: 'text' },
  { id: 'stickers', name: 'Stickers', icon: 'sticker' },
  { id: 'effects', name: 'Effects', icon: 'effects' },
  { id: 'transitions', name: 'Transitions', icon: 'transitions' },
  { id: 'captions', name: 'Captions', icon: 'cc' },
  { id: 'filters', name: 'Filters', icon: 'filters' },
  { id: 'templates', name: 'Templates', icon: 'template' },
];

/** Sub-navigation entries per tab (the left column inside the panel, as in CapCut). */
const SUBNAV: Record<string, string[]> = {
  media: ['All', 'Videos', 'Photos'],
  audio: ['Imported'],
  text: ['Add text', 'Templates'],
  stickers: ['All', ...STICKER_CATEGORIES],
  effects: ['All', 'Basic', ...FX_CATEGORIES],
  transitions: ['All', 'Popular'],
  captions: ['Auto captions', 'Templates', 'Auto lyrics', 'Add captions'],
  filters: ['All', ...LUT_CATEGORIES, 'Custom'],
  templates: ['For You', ...TEMPLATE_CATEGORIES, 'Favorites'],
};

const sub: Record<string, string> = {};
const subOf = (tab: string) => sub[tab] ?? SUBNAV[tab][0];
const FOLDER = 'folder:';

/** Media item / folder whose name is being edited inline. */
let renamingId: string | null = null;
let hooks: MediaMenuHooks;

export function mountLeftPanel(panel: HTMLElement, player: Player) {
  const tabRow = h('nav.lp-tabs', { role: 'tablist' });
  const tabScroll = h('div.lp-tabs-scroll', null, tabRow);
  // Arrow-only navigation: the strip ignores wheel / trackpad / touch swipes.
  const lessBtn = h('button.lp-tabs-more.left', { title: 'Previous tabs', 'aria-label': 'Previous tabs', onclick: () => tabScroll.scrollTo({ left: 0, behavior: 'smooth' }) }, icon('chevronLeft', 16));
  const moreBtn = h('button.lp-tabs-more', { title: 'More tabs', 'aria-label': 'More tabs', onclick: () => tabScroll.scrollTo({ left: tabScroll.scrollWidth, behavior: 'smooth' }) }, icon('chevronRight', 16));
  const subnav = h('div.lp-subnav');
  const content = h('div.lp-content');
  panel.append(h('div.lp-tabbar', null, lessBtn, tabScroll, moreBtn), h('div.lp-main', null, subnav, content));

  // Vertical wheel scrolls the tab strip sideways.
  const updateMore = () => {
    lessBtn.classList.toggle('hidden', tabScroll.scrollLeft < 4);
    moreBtn.classList.toggle('hidden', tabScroll.scrollWidth - tabScroll.clientWidth - tabScroll.scrollLeft < 4);
  };
  tabScroll.addEventListener('scroll', updateMore);
  new ResizeObserver(updateMore).observe(tabScroll);

  function renderTabs() {
    clear(tabRow);
    for (const t of TABS) {
      tabRow.append(h(`button.lp-tab${store.leftTab === t.id ? '.active' : ''}`, {
        role: 'tab', 'aria-selected': store.leftTab === t.id,
        onclick: () => { store.leftTab = t.id; store.emit('view'); },
      }, icon(t.icon, 16), h('span', null, t.name)));
    }
    updateMore();
  }

  function renderSubnav() {
    clear(subnav);
    const tab = store.leftTab;
    if (tab === 'media' || tab === 'audio') {
      subnav.append(h('button.lp-import', { onclick: async () => importOnly(await pickFiles()) }, icon('upload', 14), 'Import'));
    }
    if (tab === 'filters') {
      subnav.append(h('button.lp-import', {
        title: 'Import a .cube LUT file',
        onclick: () => importLuts(() => { sub.filters = 'Custom'; renderSubnav(); renderContent(); }),
      }, icon('upload', 14), 'Import LUT'));
    }
    for (const s of SUBNAV[tab]) {
      subnav.append(h(`button.lp-sub${subOf(tab) === s ? '.active' : ''}`, {
        onclick: () => { sub[tab] = s; renderContent(); renderSubnav(); },
      }, s));
    }
    if (tab === 'media') for (const f of store.folders) subnav.append(folderEntry(f));
  }

  function folderEntry(f: { id: string; name: string }) {
    const key = FOLDER + f.id;
    if (renamingId === f.id) {
      return renameInput(f.name, 'lp-sub-input', (name) => {
        if (name.trim()) f.name = name.trim();
        renamingId = null;
        renderSubnav();
      });
    }
    const btn = h(`button.lp-sub.folder${subOf('media') === key ? '.active' : ''}`, {
      title: f.name,
      onclick: () => { sub.media = key; renderContent(); renderSubnav(); },
    }, icon('folder', 14), h('span', null, f.name));
    onContextMenu(btn, () => [
      { label: 'Rename', onSelect: () => { renamingId = f.id; renderSubnav(); } },
      {
        label: 'Delete folder', danger: true, onSelect: async () => {
          const ok = await confirmDialog(`Delete “${f.name}”?`, 'The folder is removed. Its media moves back to All, nothing is deleted.', 'Delete folder');
          if (!ok) return;
          store.folders = store.folders.filter((x) => x.id !== f.id);
          for (const m of store.media.values()) if (m.folderId === f.id) m.folderId = undefined;
          if (sub.media === key) sub.media = 'All';
          store.emit('media');
          renderSubnav();
        },
      },
    ]);
    return btn;
  }

  hooks = {
    player,
    startRename: (m) => { renamingId = m.id; renderContent(); },
    openFolder: (id) => { sub.media = FOLDER + id; store.leftTab = 'media'; store.emit('view'); renderSubnav(); renderContent(); },
  };

  function renderContent() {
    const keep = content.scrollTop;
    clear(content);
    switch (store.leftTab) {
      case 'media': mediaTab(content); break;
      case 'audio': audioTab(content); break;
      case 'text': textTab(content); break;
      case 'stickers': stickerTab(content); break;
      case 'effects': lookTab(content, 'effect'); break;
      case 'filters': lookTab(content, 'filter'); break;
      case 'templates': templatesTab(content, subOf('templates'), renderContent); break;
      case 'transitions': transitionTab(content, renderContent); break;
      case 'captions': captionsTab(content, subOf('captions'), renderContent); break;
    }
    content.scrollTop = keep;
  }

  let lastTab = '';
  const all = () => { renderTabs(); renderSubnav(); content.scrollTop = 0; renderContent(); lastTab = store.leftTab; };
  store.on('view', () => { if (store.leftTab !== lastTab) all(); });
  store.on('media', () => {
    if (['media', 'audio'].includes(store.leftTab)) { renderContent(); renderSubnav(); }
    // Previews use the user's footage, so they refresh when media changes.
    else if (['filters', 'effects', 'transitions'].includes(store.leftTab)) renderContent();
  });
  renderAgain = renderContent;
  const onClipChange = () => {
    if (['effects', 'filters', 'transitions', 'media'].includes(store.leftTab)) renderContent();
    // The caption list re-renders on edits, except while the user is typing in it.
    else if (store.leftTab === 'captions' && subOf('captions') === 'Add captions' && !content.contains(document.activeElement)) renderContent();
  };
  store.on('select', onClipChange);
  store.on('project', onClipChange);
  all();
}

// ---- shared pieces ------------------------------------------------------------

function importZone(label: string) {
  const zone = h('button.import-zone', { type: 'button', onclick: async () => importOnly(await pickFiles()) },
    h('div.import-icon', null, icon('upload', 20)),
    h('div.import-title', null, label),
    h('div.import-sub', null, 'or drag & drop files here'),
  );
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('over');
    if (e.dataTransfer?.files.length) await importOnly([...e.dataTransfer.files]);
  });
  return zone;
}

function bitmapCanvas(bmp: ImageBitmap) {
  const cv = h('canvas') as HTMLCanvasElement;
  cv.width = bmp.width;
  cv.height = bmp.height;
  cv.getContext('2d')!.drawImage(bmp, 0, 0);
  return cv;
}

const usedMedia = () => {
  const s = new Set<string>();
  for (const t of store.project.tracks) for (const c of t.clips) if (c.mediaId) s.add(c.mediaId);
  return s;
};

function mediaCard(m: MediaItem, used: boolean) {
  const thumb = h('div.media-thumb');
  const still = m.poster ?? m.thumbs[0];
  if (still) thumb.append(bitmapCanvas(still));
  else if (m.kind === 'audio') thumb.append(h('div.media-audio-icon', null, icon('audio', 26)));
  if (m.status === 'loading') thumb.append(h('div.media-loading', null, h('div.spinner')));
  if (m.status === 'error') thumb.append(h('div.media-lost', { title: m.error }, 'Media lost'));
  if (used) thumb.append(h('span.media-added', null, 'Added'));
  if (m.kind !== 'image' && m.status === 'ready') {
    thumb.append(h('span.media-dur', { title: m.kind === 'video' && !m.hasAudio ? 'No audio track' : undefined },
      m.kind === 'video' && !m.hasAudio ? icon('mute', 10) : null, fmtTime(m.duration)));
  }
  if (m.kind === 'video' && Math.max(m.width, m.height) >= 3840) thumb.append(h('span.media-4k', null, '4K'));
  thumb.append(h('button.media-add', {
    title: 'Add to timeline',
    onclick: (e: Event) => { e.stopPropagation(); addMediaToTimeline(m); },
  }, icon('plus', 16)));
  const card = h(`div.media-card${store.mediaSelectedId === m.id ? '.selected' : ''}`, {
    draggable: renamingId !== m.id,
    title: `${m.name}${m.width ? ` · ${m.width}×${m.height}` : ''}${m.codec ? ` · ${m.codec}` : ''}${m.fps ? ` · ${m.fps}fps` : ''}`,
    ondblclick: () => addMediaToTimeline(m),
  }, thumb, mediaName(m, 'media-name'));
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer!.setData('kinora/media', m.id);
    e.dataTransfer!.effectAllowed = 'copy';
  });
  selectable(card, m);
  card.addEventListener('click', () => previewMedia(m, card));
  card.dataset.pkey = `media:${m.id}`;
  return card;
}

// ---- tabs -----------------------------------------------------------------------

function mediaTab(body: HTMLElement) {
  const f = subOf('media');
  const live = [...store.media.values()].filter((m) => !m.deleted);
  const items = f.startsWith(FOLDER)
    ? live.filter((m) => m.folderId === f.slice(FOLDER.length))
    : live.filter((m) => m.kind !== 'audio' && (f === 'All' || (f === 'Videos' ? m.kind === 'video' : m.kind === 'image')));
  if (f.startsWith(FOLDER) && !items.length) { body.append(h('p.hint', null, 'This folder is empty. Right-click media and choose “New folder with selected item”.')); return; }
  if (!live.length) {
    body.append(importZone('Import media'));
    body.append(h('p.hint', null, 'Videos and photos are decoded on your device with WebCodecs. Nothing is uploaded.'));
    return;
  }
  if (!items.length) { body.append(h('p.hint', null, `No ${f.toLowerCase()} yet.`)); return; }
  const used = usedMedia();
  const grid = h('div.media-grid');
  for (const m of items) grid.append(m.kind === 'audio' ? audioRow(m) : mediaCard(m, used.has(m.id)));
  body.append(grid);
}

function audioTab(body: HTMLElement) {
  const items = [...store.media.values()].filter((m) => m.kind === 'audio' && !m.deleted);
  if (!items.length) {
    body.append(importZone('Import audio'));
    body.append(h('p.hint', null, 'Import music, voice-overs or sound effects. To use a video’s sound separately, select the clip and choose Audio › Extract audio.'));
    return;
  }
  const list = h('div.audio-list');
  for (const m of items) list.append(audioRow(m));
  body.append(list);
}

function audioRow(m: MediaItem) {
  const wave = h('canvas.audio-wave') as HTMLCanvasElement;
  const dpr = window.devicePixelRatio || 1;
  wave.width = 200 * dpr; wave.height = 20 * dpr;
  if (m.peaks) {
    const ctx = wave.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#5eead4';
    const n = m.peaks.length;
    for (let x = 0; x < 200; x += 2) {
      const v = m.peaks[Math.floor((x / 200) * n)] ?? 0;
      const bh = Math.max(1, v * 18);
      ctx.fillRect(x, 10 - bh / 2, 1.2, bh);
    }
  }
  const row = h(`div.audio-row${store.mediaSelectedId === m.id ? '.selected' : ''}${m.status === 'error' ? '.lost' : ''}`, { draggable: renamingId !== m.id, ondblclick: () => addMediaToTimeline(m) },
    h('div.audio-icon', null, icon('audio', 16)),
    h('div.audio-meta', null, mediaName(m, 'audio-name'), m.status === 'loading' ? h('div.spinner.small') : m.status === 'error' ? h('span.lost-label', null, 'Media lost') : wave),
    h('span.audio-dur', null, m.status === 'ready' ? fmtTime(m.duration) : ''),
    h('button.icon-btn.small', { title: 'Add to timeline', onclick: (e: Event) => { e.stopPropagation(); addMediaToTimeline(m); } }, icon('plus', 16)),
  );
  row.addEventListener('dragstart', (e) => e.dataTransfer!.setData('kinora/media', m.id));
  selectable(row, m);
  row.addEventListener('click', () => previewMedia(m, row));
  row.dataset.pkey = `media:${m.id}`;
  return row;
}

/** Click selects (cyan outline); right-click / two-finger tap / long-press opens the menu. */
function selectable(el: HTMLElement, m: MediaItem) {
  const select = () => {
    if (store.mediaSelectedId === m.id) return;
    store.mediaSelectedId = m.id;
    document.querySelectorAll('.media-card.selected, .audio-row.selected').forEach((x) => x.classList.remove('selected'));
    el.classList.add('selected');
  };
  el.addEventListener('click', select);
  onContextMenu(el, () => { select(); return mediaMenu(m, hooks); });
}

function mediaName(m: MediaItem, cls: string) {
  if (renamingId !== m.id) return h(`div.${cls}`, null, m.name);
  return renameInput(m.name, `${cls}-input`, (name) => {
    renamingId = null;
    renameMedia(m, name);
    store.emit('media');
  });
}

/** Inline text field: Enter/blur saves, Escape cancels. */
function renameInput(value: string, cls: string, done: (v: string) => void) {
  const inp = h(`input.rename-input.${cls}`, { value, spellcheck: false, 'aria-label': 'Name' }) as HTMLInputElement;
  let finished = false;
  const finish = (v: string) => { if (finished) return; finished = true; done(v); };
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(inp.value);
    if (e.key === 'Escape') finish(value);
  });
  inp.addEventListener('blur', () => finish(inp.value));
  inp.addEventListener('click', (e) => e.stopPropagation());
  inp.addEventListener('dblclick', (e) => e.stopPropagation());
  closeContextMenu();
  requestAnimationFrame(() => { inp.focus(); inp.select(); });
  return inp;
}

function textTab(body: HTMLElement) {
  if (subOf('text') === 'Add text') {
    const card = h('div.add-text-card', { role: 'button', tabIndex: 0, draggable: true, onclick: () => previewText({}, 'Text', card) },
      h('span.add-text-sample', null, 'Default text'),
      h('button.add-text-plus', { type: 'button', title: 'Add to timeline', onclick: (e: Event) => { e.stopPropagation(); addText({}, 'Text'); } }, icon('plus', 14)));
    libDrag(card, { kind: 'text', id: '' });
    card.dataset.pkey = 'text:Text';
    body.append(card);
    body.append(h('p.hint', null, 'Adds a text layer at the playhead. Edit the words and style in the panel on the right.'));
  }
  const grid = h('div.preset-grid');
  for (const [i, p] of TEXT_PRESETS.entries()) {
    const addBtn = h('button.card-add', {
      title: 'Add to timeline',
      onclick: (e: Event) => { e.stopPropagation(); addText(p.style, p.name); },
    }, icon('plus', 14));
    const tile: HTMLElement = h('div.preset', {
      role: 'button',
      tabIndex: 0,
      onclick: () => previewText(p.style, p.name, tile),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addText(p.style, p.name); } },
      title: p.name,
    }, h('span', { style: p.css }, p.style.content ?? 'Default text'), addBtn);
    libDrag(tile, { kind: 'text', id: String(i) });
    tile.dataset.pkey = `text:${p.name}`;
    grid.append(tile);
  }
  body.append(grid);
}

/**
 * Download badge for a library item that isn't on this device yet (CapCut's ↓ arrow).
 * Downloaded items work offline; the badge turns into a spinner while downloading.
 */
function dlBadge(kind: AssetKind, id: string, name: string, small = false) {
  const busy = isDownloading(kind, id);
  return h(`button.dl-btn${small ? '.small' : ''}${busy ? '.busy' : ''}`, {
    type: 'button', title: 'Download for offline use', 'aria-label': `Download ${name}`,
    onclick: (e: Event) => { e.stopPropagation(); void download(kind, id); },
  }, busy ? h('div.spinner.small') : icon('download', small ? 12 : 14));
}

/** Click on a not-yet-downloaded item: download it, then run `then` (usually the preview). */
async function fetchThen(kind: AssetKind, id: string, name: string, then: () => void) {
  if (isDownloaded(kind, id)) { then(); return; }
  if (await download(kind, id)) then();
  else toast(`Couldn't download “${name}”. Check your connection.`, 'error');
}

const libraryEmpty = (body: HTMLElement, kind: AssetKind, what: string) => {
  if (catalogOf(kind).length) return false;
  body.append(h('p.hint', null, navigator.onLine ? `Loading ${what}…` : `Connect to the internet once to see the ${what} library.`));
  return true;
};

function stickerTab(body: HTMLElement) {
  if (libraryEmpty(body, 'stickers', 'stickers')) return;
  const cat = subOf('stickers');
  const cats = cat === 'All' ? STICKER_CATEGORIES : [cat];
  for (const c of cats) {
    const items = catalogOf('stickers').filter((x) => x.category === c);
    if (!items.length) continue;
    if (cat === 'All') body.append(h('div.section-label', null, c));
    const grid = h('div.sticker-grid');
    for (const item of items) {
      const have = isDownloaded('stickers', item.id);
      const def = have ? STICKERS.find((x) => x.id === item.id) : undefined;
      const img = h('img', { src: def ? stickerDataUrl(def) : thumbUrl(item), alt: item.name, draggable: false, loading: 'lazy' });
      const badge = def
        ? h('button.card-add', { title: 'Add to timeline', onclick: (e: Event) => { e.stopPropagation(); addSticker(def); } }, icon('plus', 14))
        : dlBadge('stickers', item.id, item.name);
      const tile: HTMLElement = h('div.sticker', {
        role: 'button',
        tabIndex: 0,
        onclick: () => void fetchThen('stickers', item.id, item.name, () => { const d = STICKERS.find((x) => x.id === item.id); if (d) previewSticker(d, tile); }),
        onkeydown: (e: KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && def) { e.preventDefault(); addSticker(def); } },
        title: item.name,
      }, img, badge);
      if (def) libDrag(tile, { kind: 'sticker', id: item.id });
      tile.dataset.pkey = `sticker:${item.id}`;
      grid.append(tile);
    }
    body.append(grid);
  }
}

function lookTab(body: HTMLElement, field: 'filter' | 'effect') {
  // A selected effect/filter layer of this kind is edited in place; otherwise a click previews.
  const sel = store.selected?.type === field ? store.selected : null;
  const current = sel?.[field].id;
  const kind: AssetKind = field === 'effect' ? 'effects' : 'filters';
  const cat = subOf(field === 'effect' ? 'effects' : 'filters');
  // Built-in "Basic" effects and imported .cube filters live in the app; the rest come from R2.
  type Tile = { id: string; name: string; local: boolean; custom?: boolean; item?: CatalogItem };
  let items: Tile[] = [];
  if (field === 'effect') {
    if (cat === 'All' || cat === 'Basic') items.push(...allEffects().filter((e) => e.category === 'Basic').map((e) => ({ id: e.id, name: e.name, local: true })));
    if (cat !== 'Basic') items.push(...catalogOf('effects').filter((x) => cat === 'All' || x.category === cat).map((x) => ({ id: x.id, name: x.name, local: false, item: x })));
  } else {
    if (cat !== 'Custom') items.push(...catalogOf('filters').filter((x) => cat === 'All' || x.category === cat).map((x) => ({ id: x.id, name: x.name, local: false, item: x })));
    items.push(...lutList().filter((l) => l.category === 'Custom' && (cat === 'All' || cat === 'Custom')).map((l) => ({ id: l.id, name: l.name, local: true, custom: true })));
    if (cat === 'Custom' && !items.length) {
      body.append(h('p.hint', null, 'Import a .cube LUT from Premiere, DaVinci Resolve, Lightroom or a LUT pack and it will show up here as a filter.'));
    }
  }
  if (!items.length && libraryEmpty(body, kind, field === 'effect' ? 'effects' : 'filters')) return;
  const grid = h('div.look-grid');
  for (const l of items) {
    const have = l.local || isDownloaded(kind, l.id);
    const apply = () => {
      if (sel) {
        updateClip(sel.id, (x) => { x[field] = { ...x[field], id: l.id }; x.name = l.name; });
        toast(`Changed to ${l.name}`, 'ok');
      } else addLookLayer(field, l.id, l.name);
    };
    const badge = current === l.id
      ? h('span.look-check', null, icon('check', 12))
      : have
        ? h('button.card-add.small', { title: 'Add to timeline', onclick: (e: Event) => { e.stopPropagation(); apply(); } }, icon('plus', 12))
        : dlBadge(kind, l.id, l.name, true);
    // Local items render their tile; library items use the picture from R2 (no shader compile).
    const src = l.item ? thumbUrl(l.item) : lookPreview(field, l.id);
    const swatch = h('div.look-swatch.look-prev', null, h('img', { src, alt: '', draggable: false, loading: 'lazy' }), badge);
    if (field === 'effect' && have) {
      // Hover plays the effect live (motion effects like shake / glitch need time to read).
      const anim = h('canvas.look-anim', { width: SAMPLE_W, height: SAMPLE_H }) as HTMLCanvasElement;
      swatch.insertBefore(anim, swatch.children[1]);
      let stop: (() => void) | null = null;
      swatch.addEventListener('pointerenter', () => { stop = animateEffect(anim, l.id); swatch.classList.add('playing'); });
      swatch.addEventListener('pointerleave', () => { stop?.(); stop = null; swatch.classList.remove('playing'); });
    }
    const tile: HTMLElement = h(`button.look${current === l.id ? '.active' : ''}`, {
      title: l.name,
      onclick: () => void fetchThen(kind, l.id, l.name, () => (sel ? apply() : void previewLook(field, l.id, l.name, tile))),
    }, swatch, h('span', null, l.name));
    if (have) libDrag(tile, { kind: field, id: l.id, name: l.name });
    tile.dataset.pkey = `${field}:${l.id}`;
    if (l.custom) {
      onContextMenu(tile, () => [{ label: 'Remove LUT', danger: true, onSelect: () => { removeCustomLut(l.id); store.emit('view'); renderAgain?.(); } }]);
    }
    grid.append(tile);
  }
  body.append(grid);
}

let renderAgain: (() => void) | null = null;

/** Opens a file picker for .cube LUTs and adds each as a Custom filter. */
function importLuts(after: () => void) {
  const input = h('input', { type: 'file', accept: '.cube', multiple: true }) as HTMLInputElement;
  input.addEventListener('change', async () => {
    for (const f of [...(input.files ?? [])]) {
      try {
        const def = importCube(await f.text(), f.name);
        toast(`Imported LUT “${def.name}”`, 'ok');
      } catch (err) {
        toast(`${f.name}: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    }
    after();
  });
  input.click();
}

function transitionTab(body: HTMLElement, _rerender: () => void) {
  if (libraryEmpty(body, 'transitions', 'transitions')) return;
  const sel = store.selected;
  const current = sel && (sel.type === 'video' || sel.type === 'image') ? sel.crossIn?.type : undefined;
  const all = catalogOf('transitions');
  const items = subOf('transitions') === 'Popular'
    ? all.filter((x) => Number(x.meta.popular) >= 0).sort((a, b) => Number(a.meta.popular) - Number(b.meta.popular))
    : all;
  const grid = h('div.look-grid');
  for (const item of items) {
    const name = item.id, label = item.name;
    const have = isDownloaded('transitions', name);
    const apply = () => applyCrossTransition(name, label);
    const still = h('img.tr-still', { src: thumbUrl(item), alt: '', draggable: false, loading: 'lazy' });
    const badge = current === name
      ? h('span.look-check', null, icon('check', 12))
      : have
        ? h('button.card-add.small', { title: 'Add to timeline', onclick: (e: Event) => { e.stopPropagation(); apply(); } }, icon('plus', 12))
        : dlBadge('transitions', name, label, true);
    const swatch = h('div.look-swatch.tr-prev', null, still, badge);
    if (have && supportsTransition(name)) {
      const anim = h('canvas.tr-anim', { width: PREVIEW_SIZE.w, height: PREVIEW_SIZE.h }) as HTMLCanvasElement;
      swatch.insertBefore(anim, badge);
      let stop: (() => void) | null = null;
      swatch.addEventListener('pointerenter', () => { stop = animateInto(anim, name); swatch.classList.add('playing'); });
      swatch.addEventListener('pointerleave', () => { stop?.(); stop = null; swatch.classList.remove('playing'); });
    }
    const tile: HTMLElement = h(`button.look${current === name ? '.active' : ''}`, {
      title: label, onclick: () => void fetchThen('transitions', name, label, () => void previewTransition(name, tile)),
    }, swatch, h('span', null, label));
    if (have) libDrag(tile, { kind: 'transition', id: name, name: label });
    tile.dataset.pkey = `transition:${name}`;
    grid.append(tile);
  }
  body.append(grid);
}
