import { CatalogItem, catalogOf, download, downloadedItems, initAssets, isDownloaded, onAssetsChanged, removeDownload, thumbUrl } from '../engine/assets';
import { addTemplateMusic } from '../engine/sampleMedia';
import { loadSamples, playTemplate, previewSize, previewVideo } from './templatePreview';
import {
  createProject, deleteProject, duplicateProject, LibraryFile, listLibraryMedia, listProjects, ProjectMeta, renameProject, restoreProject, trashProject,
} from '../engine/persist';
import { go, parseRoute } from '../router';
import { newProject, sizeFor } from '../store';
import { TEMPLATE_CATEGORIES, TEMPLATES } from '../templates';
import { makeClip, uid } from '../types';
import { confirmDialog, onContextMenu } from './contextmenu';
import { fmtTime, h, icon, toast } from './dom';
import { dropdown } from './select';

// Start page (CapCut): Home with "Create project" and the project list, and a full-page
// template browser. Opening a project or a template starts the editor.

type Page = 'home' | 'templates' | 'library';

const FAV_KEY = 'kinora.favTemplates';
const favs = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as string[]; } catch { return []; } })());
const saveFavs = () => { try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch { /* ignore */ } };

const when = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

export function mountHome(app: HTMLElement, first: Page) {
  document.body.classList.add('home-mode');
  let page: Page = first;
  let showTrash = false;
  let listView = false;
  let query = '';
  let tplQuery = '';
  let chip = 'For You';
  const filters = { orient: 'all', clips: 'any', dur: 'any' };

  const nav = (p: Page, label: string, ic: string) => h(`button.home-nav${page === p ? '.active' : ''}`, {
    type: 'button', onclick: () => { page = p; location.hash = `#/${p}`; render(); },
  }, icon(ic, 18), label);
  const side = h('aside.home-side');
  const main = h('main.home-main');
  app.append(h('div.home', null, side, main));

  function renderSide() {
    side.replaceChildren(
      h('div.home-brand', null, h('div.logo-mark', null, icon('logo', 18)), h('span', null, 'Kinora')),
      nav('home', 'Home', 'home'),
      nav('templates', 'Templates', 'template'),
      h('div.home-side-label', null, 'Management'),
      nav('library', 'Library', 'folder'),
    );
  }

  async function newBlank() {
    const id = await createProject();
    go({ page: 'edit', id });
  }

  // ---- Home ----------------------------------------------------------------------------------

  async function renderHomePage() {
    const all = await listProjects();
    const items = all.filter((p) => !!p.trashed === showTrash && (!query || p.name.toLowerCase().includes(query.toLowerCase())))
      .sort((a, b) => (showTrash ? (b.trashed ?? 0) - (a.trashed ?? 0) : b.updated - a.updated));
    const search = h('input.home-search', { type: 'search', placeholder: 'Search projects', value: query, 'aria-label': 'Search projects' }) as HTMLInputElement;
    search.addEventListener('input', () => { query = search.value; void renderHomePage().then(() => { const s = main.querySelector<HTMLInputElement>('.home-search'); s?.focus(); s?.setSelectionRange(query.length, query.length); }); });
    const grid = h(`div.proj-grid${listView ? '.list' : ''}`);
    for (const p of items) grid.append(projectCard(p));
    main.replaceChildren(...[
      showTrash ? null : h('button.create-banner', { type: 'button', onclick: () => void newBlank() },
        h('span.create-plus', null, icon('plus', 22)), h('span', null, 'Create project')),
      h('div.proj-head', null,
        h('h2', null, showTrash ? 'Trash' : 'Projects'),
        h('div.proj-tools', null,
          h('label.home-search-wrap', null, icon('search', 15), search),
          h('button.home-tool', { type: 'button', title: listView ? 'Grid view' : 'List view', onclick: () => { listView = !listView; void renderHomePage(); } }, icon(listView ? 'grid' : 'list', 16)),
          h(`button.home-tool.wide${showTrash ? '.on' : ''}`, { type: 'button', onclick: () => { showTrash = !showTrash; void renderHomePage(); } }, icon(showTrash ? 'chevronLeft' : 'trash', 15), showTrash ? 'Back to projects' : 'Trash'))),
      items.length ? grid : h('p.hint.home-empty', null, showTrash ? 'Trash is empty.' : query ? 'No projects match.' : 'No projects yet. Click Create project to start.'),
    ].filter((x): x is HTMLElement => !!x));
  }

  function projectCard(p: ProjectMeta) {
    const open = () => { if (!p.trashed) go({ page: 'edit', id: p.id }); };
    const name = h('div.proj-name', null, p.name);
    const startRename = () => {
      const inp = h('input.proj-rename', { value: p.name, 'aria-label': 'Project name' }) as HTMLInputElement;
      const done = async (save: boolean) => { if (save) await renameProject(p.id, inp.value); void renderHomePage(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') void done(true); if (e.key === 'Escape') void done(false); });
      inp.addEventListener('blur', () => void done(true));
      inp.addEventListener('click', (e) => e.stopPropagation());
      name.replaceWith(inp);
      inp.focus(); inp.select();
    };
    const menu = () => p.trashed
      ? [
        { label: 'Restore', onSelect: () => void restoreProject(p.id).then(renderHomePage) },
        { label: 'Delete permanently', danger: true, onSelect: async () => { if (await confirmDialog('Delete project?', `“${p.name}” and its media will be deleted for good. This can't be undone.`)) { await deleteProject(p.id); void renderHomePage(); } } },
      ]
      : [
        { label: 'Open', onSelect: open },
        { label: 'Rename', onSelect: startRename },
        { label: 'Duplicate', onSelect: () => void duplicateProject(p.id).then(renderHomePage) },
        'separator' as const,
        { label: 'Move to Trash', danger: true, onSelect: () => void trashProject(p.id).then(() => { toast(`Moved “${p.name}” to Trash`); void renderHomePage(); }) },
      ];
    const more = h('button.proj-more', { type: 'button', title: 'More', 'aria-label': 'More', onclick: (e: MouseEvent) => { e.stopPropagation(); (e.currentTarget as HTMLElement).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: e.clientX, clientY: e.clientY })); } }, '⋯');
    const card = h('div.proj-card', { role: 'button', tabIndex: 0, title: p.name, onclick: open, onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') open(); } },
      h('div.proj-cover', null, p.cover ? h('img', { src: p.cover, alt: '', draggable: false }) : icon('film', 28), h('span.proj-dur', null, fmtTime(p.duration)), more),
      h('div.proj-info', null, name, h('div.proj-meta', null, p.trashed ? `Trashed ${when(p.trashed)}` : `${when(p.updated)}`)));
    onContextMenu(card, menu);
    return card;
  }

  // ---- Templates -----------------------------------------------------------------------------

  const orientOf = (ratio: string) => { const [a, b] = ratio.split(':').map(Number); return a / b < 1 ? 'portrait' : 'landscape'; };
  const inRange = (v: number, id: string) => {
    if (id === 'any') return true;
    if (id.endsWith('+')) return v >= parseFloat(id);
    const [a, b] = id.split('-').map(Number);
    return v >= a && v <= b;
  };

  async function startFromTemplate(it: CatalogItem, openStrip: boolean) {
    const m = it.meta as { ratio?: string; slots?: number; duration?: number };
    const ratio = m.ratio ?? '9:16';
    const p = newProject();
    [p.width, p.height] = sizeFor(ratio, 1080);
    p.ratio = ratio;
    p.name = it.name;
    const clip = makeClip('template', { name: it.name, start: 0, duration: m.duration ?? 5, template: { id: it.id, media: Array.from({ length: m.slots ?? 1 }, () => null) } });
    p.tracks.find((t) => t.main)!.clips.push(clip);
    if (isDownloaded('templates', it.id) || await download('templates', it.id)) {
      const def = TEMPLATES.find((t) => t.id === it.id);
      if (def) addTemplateMusic(p, def, 0, clip.duration);
    }
    const tl = uid('tl');
    const id = await createProject({ projectTitle: it.name, activeTimelineId: tl, timelines: [{ id: tl, project: p }], openStrip });
    go({ page: 'edit', id });
  }

  function renderTemplatesPage() {
    const search = h('input.home-search.big', { type: 'search', placeholder: 'Search for templates', value: tplQuery, 'aria-label': 'Search templates' }) as HTMLInputElement;
    search.addEventListener('input', () => { tplQuery = search.value; renderGrid(); });
    const fdd = (label: string, key: keyof typeof filters, opts: { id: string; name: string }[]) =>
      h('div.tpl-fdd', null, h('span', null, `${label}:`), dropdown(filters[key], opts, (v) => { filters[key] = v; renderGrid(); }, { className: 'tpl-fdd-dd' }));
    const chips = h('div.tpl-chips', null, ['Favorites', 'For You', 'Yours', ...TEMPLATE_CATEGORIES].map((c) =>
      h(`button.tpl-chip${chip === c ? '.on' : ''}`, { type: 'button', onclick: () => { chip = c; renderTemplatesPage(); } }, c)));
    const grid = h('div.tpl-page-grid');
    main.replaceChildren(
      h('label.home-search-wrap.big', null, icon('search', 16), search),
      h('div.tpl-filters', null,
        fdd('Orientation', 'orient', [{ id: 'all', name: 'All' }, { id: 'landscape', name: 'Landscape' }, { id: 'portrait', name: 'Portrait' }]),
        fdd('Clips', 'clips', [{ id: 'any', name: 'No limit' }, { id: '1-3', name: '1–3' }, { id: '4-6', name: '4–6' }, { id: '7-9', name: '7–9' }, { id: '10+', name: '10+' }]),
        fdd('Duration', 'dur', [{ id: 'any', name: 'No limit' }, { id: '0-5', name: 'Under 5s' }, { id: '5-10', name: '5–10s' }, { id: '10-20', name: '10–20s' }, { id: '20+', name: 'Over 20s' }])),
      chips, grid);
    function renderGrid() {
      const q = tplQuery.trim().toLowerCase();
      const all = catalogOf('templates');
      const items = all.filter((it) => {
        const m = it.meta as { ratio?: string; slots?: number; duration?: number };
        if (chip === 'Favorites' && !favs.has(it.id)) return false;
        if (chip !== 'For You' && chip !== 'Favorites' && it.category !== chip) return false;
        if (filters.orient !== 'all' && orientOf(m.ratio ?? '9:16') !== filters.orient) return false;
        if (!inRange(m.slots ?? 1, filters.clips) || !inRange(m.duration ?? 0, filters.dur)) return false;
        return !q || `${it.name} ${it.category}`.toLowerCase().includes(q);
      });
      grid.replaceChildren(...items.map(tplCard));
      if (!items.length) grid.append(h('p.hint.home-empty', null, !all.length ? (navigator.onLine ? 'Loading templates…' : 'Connect to the internet once to see the templates.') : chip === 'Favorites' ? 'Tap ☆ on a template to save it here.' : chip === 'Yours' ? 'Templates you create in the editor show up here.' : 'No templates match.'));
    }
    renderGrid();
  }

  function tplCard(it: CatalogItem) {
    const m = it.meta as { slots?: number; duration?: number; featured?: boolean };
    const star = () => h(`button.tpl-pg-fav${favs.has(it.id) ? '.on' : ''}`, {
      type: 'button', title: favs.has(it.id) ? 'Remove from favourites' : 'Add to favourites',
      onclick: (e: Event) => { e.stopPropagation(); if (favs.has(it.id)) favs.delete(it.id); else favs.add(it.id); saveFavs(); renderTemplatesPage(); },
    }, icon('star', 14));
    const cover = thumbUrl(it);
    // Hover: CapCut's enlarged card with the length, clip count and the two actions.
    const pop = h('div.tpl-pop', null,
      h('div.tpl-pop-img', null, cover ? h('img', { src: cover, alt: '' }) : null,
        h('div.tpl-pop-info', null, h('div.tpl-pop-name', null, it.name),
          h('div.tpl-pop-meta', null, icon('clock', 12), fmtTime(m.duration ?? 0), icon('film', 12), String(m.slots ?? 1), star()))),
      h('div.tpl-pop-actions', null,
        h('button.ghost-btn', { type: 'button', onclick: (e: Event) => { e.stopPropagation(); void startFromTemplate(it, false); } }, 'Edit more'),
        h('button.primary-btn', { type: 'button', onclick: (e: Event) => { e.stopPropagation(); void startFromTemplate(it, true); } }, 'Use template')));
    // Hovering plays the template's preview video with its song; templates without one
    // (made by people) play live instead, fetching their small file first if needed.
    const video = previewVideo(it, 'tpl-pop-anim');
    const anim = h('canvas.tpl-pop-anim') as HTMLCanvasElement;
    let stop: (() => void) | null = null;
    let hovering = false;
    const startPlay = async () => {
      hovering = true;
      if (video) {
        video.play();
        stop = () => video.stop();
        pop.classList.add('playing');
        return;
      }
      if (!isDownloaded('templates', it.id) && !(await download('templates', it.id))) return;
      const def = TEMPLATES.find((t) => t.id === it.id);
      if (!def || !hovering) return;
      await loadSamples();
      if (!hovering) return;
      const [w, hh] = previewSize(def);
      anim.width = w; anim.height = hh;
      stop?.();
      stop = playTemplate(anim, def);
      pop.classList.add('playing');
    };
    const stopPlay = () => { hovering = false; stop?.(); stop = null; pop.classList.remove('playing'); };
    pop.querySelector('.tpl-pop-img')!.append(video?.el ?? anim);
    // Touch screens have no hover: a tap opens the card's actions (and plays it); a tap elsewhere closes it.
    const touch = matchMedia('(hover: none)').matches;
    const onTap = (e: Event) => {
      if (!touch || (e.target as HTMLElement).closest('button')) return;
      const card = e.currentTarget as HTMLElement;
      const open = !card.classList.contains('open');
      document.querySelectorAll('.tpl-pg-card.open').forEach((c) => c.classList.remove('open'));
      if (open) { card.classList.add('open'); void startPlay(); } else stopPlay();
    };
    return h('div.tpl-pg-card', { title: it.name, onpointerenter: () => { if (!touch) void startPlay(); }, onpointerleave: () => { if (!touch) stopPlay(); }, onclick: onTap },
      h('div.tpl-pg-img', null, cover ? h('img', { src: cover, alt: '', loading: 'lazy', draggable: false }) : null,
        m.featured ? h('span.tpl-badge', null, 'Featured') : null,
        h('div.tpl-pg-meta', null, icon('film', 12), String(m.slots ?? 1), h('span', null, fmtTime(m.duration ?? 0)))),
      h('div.tpl-pg-name', null, it.name), pop);
  }

  // ---- Library -------------------------------------------------------------------------------

  let libTab: 'media' | 'downloads' = 'media';
  let libFilter = 'All';
  let libQuery = '';
  let libSort: 'newest' | 'name' | 'size' = 'newest';
  let libList = false;
  let libFavOnly = false;
  const LIB_FAV = 'kinora.favLibrary';
  const libFavs = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(LIB_FAV) ?? '[]') as string[]; } catch { return []; } })());
  const saveLibFavs = () => { try { localStorage.setItem(LIB_FAV, JSON.stringify([...libFavs])); } catch { /* ignore */ } };
  const urls: string[] = [];
  const kindOf = (f: File) => (f.type.startsWith('video') ? 'Videos' : f.type.startsWith('image') ? 'Images' : f.type.startsWith('audio') ? 'Audio' : 'Other');
  const sizeLabel = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
  const DL_KIND: Record<string, string> = { music: 'Audio', sounds: 'Audio', stickers: 'Images', effects: 'Effects', filters: 'Filters', transitions: 'Transitions', templates: 'Templates' };

  async function renderLibraryPage() {
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const chips = libTab === 'media' ? ['All', 'Videos', 'Images', 'Audio'] : ['All', 'Audio', 'Images', 'Effects', 'Filters', 'Transitions', 'Templates'];
    if (!chips.includes(libFilter)) libFilter = 'All';
    const search = h('input.home-search', { type: 'search', placeholder: 'Search', value: libQuery, 'aria-label': 'Search library' }) as HTMLInputElement;
    search.addEventListener('input', () => { libQuery = search.value; void renderLibraryPage().then(() => { const s = main.querySelector<HTMLInputElement>('.lib-tools .home-search'); s?.focus(); s?.setSelectionRange(libQuery.length, libQuery.length); }); });
    const tab = (id: typeof libTab, label: string) => h(`button.lib-tab${libTab === id ? '.on' : ''}`, { type: 'button', onclick: () => { libTab = id; libFilter = 'All'; void renderLibraryPage(); } }, label);
    const body = h(`div.lib-grid${libList ? '.list' : ''}`);
    main.replaceChildren(
      h('h1.lib-title', null, 'Library'),
      h('div.lib-tabs', null, tab('media', 'My media'), tab('downloads', 'Downloads')),
      h('div.lib-bar', null,
        h('div.lib-chips', null, chips.map((c) => h(`button.lib-chip${libFilter === c ? '.on' : ''}`, { type: 'button', onclick: () => { libFilter = c; void renderLibraryPage(); } }, c))),
        h('div.lib-tools', null,
          h('label.home-search-wrap', null, icon('search', 15), search),
          h(`button.home-tool.wide${libFavOnly ? '.on' : ''}`, { type: 'button', onclick: () => { libFavOnly = !libFavOnly; void renderLibraryPage(); } }, icon('star', 15), 'Favorites'),
          h('button.home-tool.wide', { type: 'button', onclick: () => { libList = !libList; void renderLibraryPage(); } }, icon(libList ? 'list' : 'grid', 15), libList ? 'List' : 'Grid'),
          h('div.lib-sort', null, icon('sort', 15), dropdown(libSort, [{ id: 'newest', name: 'Newest' }, { id: 'name', name: 'Name' }, { id: 'size', name: 'Size' }], (v) => { libSort = v as typeof libSort; void renderLibraryPage(); }, { className: 'lib-sort-dd' })),
          h('button.home-tool', { type: 'button', title: 'Refresh', onclick: () => void renderLibraryPage() }, icon('rotate', 15)))),
      h('div.lib-note', null, icon('download', 16), libTab === 'media'
        ? 'Everything you import is kept on this device, so your projects open even when the original files move.'
        : 'Downloaded music, sound effects, stickers, effects, filters, transitions and templates work offline.'),
      body);
    const q = libQuery.trim().toLowerCase();
    if (libTab === 'media') {
      let items = await listLibraryMedia();
      items = items.filter((m) => (libFilter === 'All' || kindOf(m.file) === libFilter) && (!libFavOnly || libFavs.has(m.id)) && (!q || m.name.toLowerCase().includes(q)));
      items.sort((a, b) => (libSort === 'name' ? a.name.localeCompare(b.name) : libSort === 'size' ? b.file.size - a.file.size : b.file.lastModified - a.file.lastModified));
      if (!items.length) { body.replaceWith(emptyLib()); return; }
      for (const m of items) body.append(mediaTile(m));
    } else {
      let items = downloadedItems();
      items = items.filter((it) => (libFilter === 'All' || DL_KIND[it.kind] === libFilter) && (!libFavOnly || libFavs.has(`${it.kind}:${it.id}`)) && (!q || it.name.toLowerCase().includes(q)));
      items.sort((a, b) => (libSort === 'size' ? b.size - a.size : a.name.localeCompare(b.name)));
      if (!items.length) { body.replaceWith(emptyLib()); return; }
      for (const it of items) body.append(downloadTile(it));
    }
  }

  function emptyLib() {
    return h('div.lib-empty', null, icon('film', 54), h('div', null, 'No assets yet'),
      h('button.primary-btn', { type: 'button', onclick: () => void newBlank() }, 'Start creating'));
  }

  function favBtn(key: string) {
    return h(`button.lib-fav${libFavs.has(key) ? '.on' : ''}`, {
      type: 'button', title: libFavs.has(key) ? 'Remove from favourites' : 'Add to favourites',
      onclick: (e: Event) => { e.stopPropagation(); if (libFavs.has(key)) libFavs.delete(key); else libFavs.add(key); saveLibFavs(); void renderLibraryPage(); },
    }, icon('star', 13));
  }

  function mediaTile(m: LibraryFile) {
    const kind = kindOf(m.file);
    const url = URL.createObjectURL(m.file);
    urls.push(url);
    const preview = kind === 'Images' ? h('img', { src: url, alt: '', loading: 'lazy' })
      : kind === 'Videos' ? h('video', { src: `${url}#t=0.5`, muted: true, preload: 'metadata', playsInline: true })
        : h('div.lib-icon', null, icon('audio', 28));
    if (preview instanceof HTMLVideoElement) {
      preview.addEventListener('pointerenter', () => void preview.play().catch(() => {}));
      preview.addEventListener('pointerleave', () => { preview.pause(); preview.currentTime = 0.5; });
    }
    const save = () => { const a = h('a', { href: url, download: m.name }) as HTMLAnchorElement; a.click(); };
    const useIt = async () => {
      const id = await createProject({ projectTitle: m.name.replace(/\.[^.]+$/, ''), media: [{ id: m.id, name: m.name }] });
      go({ page: 'edit', id });
    };
    const tile = h('div.lib-tile', { title: `${m.name}\nUsed in: ${m.projects.join(', ')}`, onclick: () => void useIt() },
      h('div.lib-thumb', null, preview, favBtn(m.id), h('span.lib-kind', null, kind === 'Videos' ? 'Video' : kind === 'Images' ? 'Image' : 'Audio')),
      h('div.lib-name', null, m.name),
      h('div.lib-meta', null, `${sizeLabel(m.file.size)} · ${m.projects.length} project${m.projects.length > 1 ? 's' : ''}`));
    onContextMenu(tile, () => [
      { label: 'Use in a new project', onSelect: () => void useIt() },
      { label: 'Save a copy to this computer', onSelect: save },
    ]);
    return tile;
  }

  function downloadTile(it: CatalogItem) {
    const key = `${it.kind}:${it.id}`;
    const cover = thumbUrl(it);
    const tile = h('div.lib-tile', { title: it.name },
      h(`div.lib-thumb${it.kind === 'stickers' ? '.contain' : ''}`, null, cover ? h('img', { src: cover, alt: '', loading: 'lazy' }) : h('div.lib-icon', null, icon(it.kind === 'music' || it.kind === 'sounds' ? 'audio' : 'effects', 28)),
        favBtn(key), h('span.lib-kind', null, DL_KIND[it.kind] === 'Audio' ? (it.kind === 'music' ? 'Music' : 'Sound') : DL_KIND[it.kind].replace(/s$/, ''))),
      h('div.lib-name', null, it.name),
      h('div.lib-meta', null, it.size ? sizeLabel(it.size) : 'Saved offline'));
    onContextMenu(tile, () => [{ label: 'Remove download', danger: true, onSelect: () => void removeDownload(it.kind, it.id).then(() => { toast(`Removed “${it.name}” from downloads`); void renderLibraryPage(); }) }]);
    return tile;
  }

  function render() {
    renderSide();
    if (page === 'home') void renderHomePage();
    else if (page === 'templates') renderTemplatesPage();
    else void renderLibraryPage();
  }

  void initAssets();
  onAssetsChanged(() => { if (page === 'templates') renderTemplatesPage(); });
  window.addEventListener('hashchange', () => { const r = parseRoute(); if (r.page !== 'edit' && r.page !== page) { page = r.page; render(); } });
  render();
}
