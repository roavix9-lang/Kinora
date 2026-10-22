import { addTemplateToTimeline } from '../actions';
import { addTemplateMusic } from '../engine/sampleMedia';
import { libDrag, previewTemplate } from './libraryPreview';
import { store } from '../store';
import { buildTemplateProject, TEMPLATE_CATEGORIES, TEMPLATES, TemplateDef, templateDuration } from '../templates';
import { projectToTemplate } from '../engine/makeTemplate';
import { Player } from '../engine/player';
import { onContextMenu } from './contextmenu';
import { CatalogItem, catalogOf, deleteMyTemplate, download, isDownloaded, isDownloading, saveMyTemplate, templateQuota, thumbUrl } from '../engine/assets';
import { MediaItem } from '../types';
import { fmtTime, h, icon, toast } from './dom';
import { importOnly, pickFiles } from './importer';
import { closePopover, dropdown } from './select';
import { loadSamples, onSamplesReady, playTemplate, previewSize, previewVideo, refreshTemplateStills, templateStill } from './templatePreview';

const FAV_KEY = 'kinora.favTemplates';
const favs = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as string[]; } catch { return []; } })());
const saveFavs = () => { try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch { /* ignore */ } };

let query = '';
let fontHooked = false;

type Orient = 'all' | 'landscape' | 'portrait';
const CLIP_OPTS = [
  { id: 'any', name: 'No limit' }, { id: '1-3', name: '1–3 clips' }, { id: '4-6', name: '4–6 clips' },
  { id: '7-9', name: '7–9 clips' }, { id: '10+', name: '10+ clips' },
];
const DUR_OPTS = [
  { id: 'any', name: 'No limit' }, { id: '0-5', name: 'Under 5s' }, { id: '5-10', name: '5–10s' },
  { id: '10-20', name: '10–20s' }, { id: '20+', name: 'Over 20s' },
];
const filters = { orient: 'all' as Orient, clips: 'any', dur: 'any' };
const filtersActive = () => filters.orient !== 'all' || filters.clips !== 'any' || filters.dur !== 'any';

const inRange = (v: number, id: string) => {
  if (id === 'any') return true;
  if (id.endsWith('+')) return v >= parseFloat(id);
  const [a, b] = id.split('-').map(Number);
  return v >= a && v <= b;
};
const orientOf = (t: { ratio: string }) => { const [a, b] = t.ratio.split(':').map(Number); return a / b < 1 ? 'portrait' : 'landscape'; };

/** A template as listed in the catalog (D1); `def` is set once it's downloaded. */
interface TInfo { id: string; name: string; category: string; ratio: string; featured: boolean; slots: number; duration: number; item: CatalogItem; def?: TemplateDef }
const infos = (): TInfo[] => catalogOf('templates').map((item) => {
  const def = isDownloaded('templates', item.id) ? TEMPLATES.find((t) => t.id === item.id) : undefined;
  const m = item.meta as { ratio?: string; featured?: boolean; slots?: number; duration?: number };
  return { id: item.id, name: item.name, category: item.category, ratio: m.ratio ?? '9:16', featured: !!m.featured, slots: m.slots ?? 1, duration: m.duration ?? 0, item, def };
});

/** Templates tab: search, grid of live-preview cards, favourites. */
export function templatesTab(body: HTMLElement, sub: string, rerender: () => void) {
  onSamplesReady(rerender);
  void loadSamples();
  // Covers drawn before the title fonts arrived used a fallback face; redraw once fonts load.
  if (!fontHooked) {
    fontHooked = true;
    document.fonts.addEventListener('loadingdone', () => { refreshTemplateStills(); if (store.leftTab === 'templates') rerender(); });
  }

  const search = h('input.tpl-search-input', { type: 'search', placeholder: 'Search for templates', value: query, 'aria-label': 'Search templates' }) as HTMLInputElement;
  search.addEventListener('input', () => {
    query = search.value;
    renderGrid();
  });
  const filterBtn = h(`button.tpl-filter-btn${filtersActive() ? '.active' : ''}`, { type: 'button', title: 'Filter templates', 'aria-label': 'Filter templates', 'aria-haspopup': 'dialog' }, icon('filter', 16), icon('chevronUp', 10));
  filterBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFilterPanel(filterBtn, () => { filterBtn.classList.toggle('active', filtersActive()); renderGrid(); }); });
  body.append(h('div.tpl-searchbar', null, h('label.tpl-search', null, icon('search', 15), search), filterBtn));
  const heading = h('div.section-label');
  const grid = h('div.tpl-grid');
  body.append(heading, grid);

  function list(): TInfo[] {
    const q = query.trim().toLowerCase();
    return infos().filter((t) => {
      if (sub === 'Favorites' && !favs.has(t.id)) return false;
      if (sub !== 'For You' && sub !== 'Favorites' && t.category !== sub) return false;
      if (filters.orient !== 'all' && orientOf(t) !== filters.orient) return false;
      if (!inRange(t.slots, filters.clips) || !inRange(t.duration, filters.dur)) return false;
      return !q || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
    }).sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
  }

  function renderGrid() {
    grid.replaceChildren();
    const items = list();
    heading.textContent = query ? `Results for “${query}”` : sub;
    if (!items.length && !catalogOf('templates').length) {
      grid.append(h('p.hint', null, navigator.onLine ? 'Loading templates…' : 'Connect to the internet once to see the template library.'));
      return;
    }
    if (!items.length) {
      grid.append(h('p.hint', null, sub === 'Favorites' && !filtersActive() ? 'Tap ☆ on a template to save it here.' : 'No templates match. Try another search or reset the filters.'));
      return;
    }
    // Masonry: two independent columns; each card goes to the shorter one. The right column
    // starts lower and wide templates get shorter cards, so rows mostly don't line up.
    // Masonry with equal gaps: tops line up, card heights differ, so rows below stagger.
    const cols = [h('div.tpl-col'), h('div.tpl-col')];
    const heights = [0, 0];
    for (const t of items) {
      const shape = cardShape(t);
      const i = heights[0] <= heights[1] ? 0 : 1;
      cols[i].append(card(t, renderGrid));
      heights[i] += 1 / CARD_RATIO[shape];
    }
    grid.append(...cols);
  }
  renderGrid();
  // Keep focus in the search box across re-renders.
  if (query) requestAnimationFrame(() => { search.focus(); search.setSelectionRange(query.length, query.length); });
}

let panel: HTMLElement | null = null;
function closeFilterPanel() { panel?.remove(); panel = null; document.querySelector('.tpl-filter-btn')?.classList.remove('open'); }
// Leaving the Templates tab closes the filter panel.
store.on('view', () => { if (store.leftTab !== 'templates') closeFilterPanel(); });

/** CapCut-style filter panel: orientation, clip count, duration, reset. */
function toggleFilterPanel(anchor: HTMLElement, changed: () => void) {
  if (panel) { closeFilterPanel(); return; }
  const render = () => {
    const seg = (id: Orient, content: Node | string, label: string) =>
      h(`button.tpl-orient${filters.orient === id ? '.active' : ''}`, { type: 'button', title: label, 'aria-label': label, 'aria-pressed': filters.orient === id, onclick: () => { filters.orient = id; changed(); render(); } }, content);
    filterArrow();
    panel!.replaceChildren(
      h('div.tpl-fp-label', null, 'Orientation'),
      h('div.tpl-orients', null,
        seg('all', 'All', 'All orientations'),
        seg('landscape', h('i.tpl-orient-ico.land'), 'Landscape'),
        seg('portrait', h('i.tpl-orient-ico.port'), 'Portrait')),
      h('div.tpl-fp-label', null, 'Clips'),
      dropdown(filters.clips, CLIP_OPTS, (v) => { filters.clips = v; changed(); }, { className: 'compact' }),
      h('div.tpl-fp-label', null, 'Duration'),
      dropdown(filters.dur, DUR_OPTS, (v) => { filters.dur = v; changed(); }, { className: 'compact' }),
      h('div.tpl-fp-sep'),
      h('button.tpl-fp-reset', { type: 'button', onclick: () => { Object.assign(filters, { orient: 'all', clips: 'any', dur: 'any' }); changed(); render(); } }, 'Reset'),
    );
  };
  panel = h('div.tpl-filter-panel', { role: 'dialog', 'aria-label': 'Template filters' });
  // Arrow points up while open, down while closed (as in CapCut).
  function filterArrow() { anchor.classList.toggle('open', !!panel); }
  render();
  document.body.append(panel);
  const r = anchor.getBoundingClientRect();
  const pw = 250;
  panel.style.top = `${r.bottom + 6}px`;
  panel.style.left = `${Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8))}px`;
  const onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    // Clicks inside the panel or its dropdown menus keep it open.
    if (panel?.contains(t) || anchor.contains(t) || (t as Element).closest?.('.popover')) return;
    closeFilterPanel();
    window.removeEventListener('pointerdown', onDown, true);
  };
  window.addEventListener('pointerdown', onDown, true);
}

/** Portrait templates get tall 9:16 cards; wide ones a slightly shorter 2:3 card. */
/**
 * Card shapes: portrait templates 9:16 or 3:4, landscape 16:9 or 4:3 (never smaller than 16:9).
 * The taller variant is picked per template so each always keeps the same shape, and the mix of
 * heights staggers the two columns.
 */
const CARD_RATIO = { tall: 9 / 16, portrait: 3 / 4, wide: 16 / 9, landscape: 4 / 3 } as const;
type CardShape = keyof typeof CARD_RATIO;
const cardShape = (t: TInfo): CardShape => {
  // Every third template of each orientation (in library order) gets the taller card.
  const same = catalogOf('templates').filter((x) => orientOf({ ratio: String(x.meta.ratio ?? '9:16') }) === orientOf(t));
  const taller = same.findIndex((x) => x.id === t.id) % 3 === 1;
  return orientOf(t) === 'portrait' ? (taller ? 'portrait' : 'tall') : (taller ? 'landscape' : 'wide');
};
const ratioOf = (t: { ratio: string }) => { const [a, b] = t.ratio.split(':').map(Number); return a / b; };

function card(t: TInfo, refresh: () => void) {
  const def = t.def;
  const shape = cardShape(t);
  // Content that doesn't match the card's shape sits over a blurred fill.
  const letterbox = Math.abs(ratioOf(t) - CARD_RATIO[shape]) > 0.05;
  // Covers come pre-rendered from R2; drawing them live froze the app on every tab switch.
  const still = thumbUrl(t.item) || (def ? templateStill(def) : null);
  const video = previewVideo(t.item, 'tpl-anim');
  const anim = def && !video ? h('canvas.tpl-anim', { width: previewSize(def)[0], height: previewSize(def)[1] }) as HTMLCanvasElement : null;
  const busy = isDownloading('templates', t.id);
  const thumb = h(`div.tpl-thumb.${shape}`, { style: { aspectRatio: String(CARD_RATIO[shape]) } },
    still && letterbox ? h('img.tpl-bg', { src: still, alt: '', draggable: false, loading: 'lazy' }) : null,
    still ? h('img.tpl-still', { src: still, alt: '', draggable: false, loading: 'lazy' }) : h('div.spinner'),
    video?.el ?? anim,
    t.featured ? h('span.tpl-badge', null, 'Featured') : null,
    h('div.tpl-meta', null,
      h('span', { title: 'Clips' }, icon('film', 12), String(t.slots)),
      h('span', { title: 'Length' }, fmtTime(t.duration))),
    def
      ? h('button.tpl-add', { type: 'button', title: 'Add to timeline', onclick: (e: Event) => { e.stopPropagation(); addTemplateToTimeline(def); } }, icon('plus', 15))
      : h(`button.dl-btn.tpl-dl${busy ? '.busy' : ''}`, {
        type: 'button', title: 'Download for offline use', 'aria-label': `Download ${t.name}`,
        onclick: (e: Event) => { e.stopPropagation(); void download('templates', t.id); },
      }, busy ? h('div.spinner.small') : icon('download', 14)),
    h(`button.tpl-fav${favs.has(t.id) ? '.on' : ''}`, {
      type: 'button', title: favs.has(t.id) ? 'Remove from favourites' : 'Add to favourites', 'aria-pressed': favs.has(t.id),
      onclick: (e: Event) => {
        e.stopPropagation();
        if (favs.has(t.id)) favs.delete(t.id); else favs.add(t.id);
        saveFavs();
        refresh();
      },
    }, icon('star', 14)));
  // Hover plays on the card; once clicked, the template plays in the player instead, so the
  // card stays still until the pointer leaves it.
  let stopCard: (() => void) | null = null;
  const stopHover = () => { stopCard?.(); stopCard = null; thumb.classList.remove('playing'); };
  thumb.addEventListener('pointerenter', () => {
    if (inPlayer === t.id) return;
    if (video) { video.play(); stopCard = () => video.stop(); } else if (def && anim) stopCard = playTemplate(anim, def);
    else return;
    thumb.classList.add('playing');
  });
  thumb.addEventListener('pointerleave', () => { stopHover(); if (inPlayer === t.id) inPlayer = null; });
  // Click previews in the player (downloading first if needed); double-click opens “Use template”.
  const el: HTMLElement = h('div.tpl-card', {
    role: 'button', tabindex: 0, title: t.name,
    onclick: async () => {
      inPlayer = t.id;
      stopHover();
      if (!def && !(await download('templates', t.id))) { toast(`Couldn't download “${t.name}”. Check your connection.`, 'error'); return; }
      const d = TEMPLATES.find((x) => x.id === t.id);
      if (d) void previewTemplate(d, el);
    },
    ondblclick: () => { if (def) openUseTemplate(def); },
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' && def) openUseTemplate(def); },
  }, thumb, h('div.tpl-name', null, t.name));
  if (def) libDrag(el, { kind: 'template', id: t.id });
  el.dataset.pkey = `template:${t.id}`;
  if (t.category === 'Yours') {
    onContextMenu(el, () => [{
      label: 'Delete template', danger: true,
      onSelect: () => void deleteMyTemplate(t.id).then(() => toast(`Deleted “${t.name}”`), () => toast("Couldn't delete it. Check your connection.", 'error')),
    }]);
  }
  return el;
}

/** Template last clicked into the player (its card doesn't also play on hover). */
let inPlayer: string | null = null;

// ---- "Use template" dialog ----------------------------------------------------------

const usable = () => [...store.media.values()].filter((m) => !m.deleted && !m.sample && m.status === 'ready' && (m.kind === 'video' || m.kind === 'image'));

function openUseTemplate(t: TemplateDef) {
  const picks: (MediaItem | undefined)[] = t.slots.map(() => undefined);
  let active = 0;
  let stopPreview: (() => void) | null = null;

  const close = () => { stopPreview?.(); closePopover(); backdrop.remove(); };
  const modal = h('div.modal.tpl-modal', { role: 'dialog', 'aria-label': `Use template ${t.name}` });
  const backdrop = h('div.modal-backdrop', {
    onpointerdown: (e: Event) => { if (e.target === backdrop) close(); },
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'Escape') close(); },
  }, modal);

  const [pw, ph] = previewSize(t, 480);
  const preview = h('canvas.tpl-preview', { width: pw, height: ph, style: { aspectRatio: t.ratio.replace(':', ' / ') } }) as HTMLCanvasElement;
  stopPreview = playTemplate(preview, t);

  const slotsEl = h('div.tpl-slots');
  const pickerEl = h('div.tpl-picker');
  const useBtn = h('button.primary-btn', { type: 'button', onclick: create }, 'Use template') as HTMLButtonElement;

  function still(m: MediaItem) {
    const bmp = m.poster ?? m.thumbs[0];
    if (!bmp) return h('div.tpl-slot-empty', null, icon('image', 16));
    const c = h('canvas') as HTMLCanvasElement;
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    return c;
  }

  function render() {
    slotsEl.replaceChildren(...t.slots.map((s, i) => h(`button.tpl-slot${i === active ? '.active' : ''}${picks[i] ? '.filled' : ''}`, {
      type: 'button', title: `Clip ${i + 1}`, onclick: () => { active = i; render(); },
    }, picks[i] ? still(picks[i]!) : h('div.tpl-slot-empty', null, icon('plus', 16)),
    h('span.tpl-slot-dur', null, `${s.dur.toFixed(1)}s`), h('span.tpl-slot-num', null, String(i + 1)))));

    const media = usable();
    pickerEl.replaceChildren(
      ...media.map((m) => h('button.tpl-pick', {
        type: 'button', title: m.name,
        onclick: () => {
          picks[active] = m;
          const next = picks.findIndex((p) => !p);
          if (next >= 0) active = next;
          render();
        },
      }, still(m), m.kind === 'video' ? h('span.tpl-pick-dur', null, fmtTime(m.duration)) : null)),
      h('button.tpl-pick.add', { type: 'button', title: 'Import media', onclick: async () => { await importOnly(await pickFiles()); render(); } }, icon('upload', 18), h('span', null, 'Import')),
    );
    const filled = picks.filter(Boolean).length;
    useBtn.disabled = filled < t.slots.length;
    useBtn.textContent = filled < t.slots.length ? `Choose ${t.slots.length - filled} more` : 'Use template';
  }

  function autofill() {
    const media = usable();
    if (!media.length) { toast('Import some videos or photos first'); return; }
    t.slots.forEach((_, i) => { picks[i] = media[i % media.length]; });
    render();
  }

  function create() {
    if (picks.some((p) => !p)) return;
    const p = buildTemplateProject(t, picks);
    // The template's song comes along on its own track, as long as the edit (user videos can shorten it).
    const length = p.tracks.find((tr) => tr.main)?.clips.reduce((n, c) => Math.max(n, c.start + c.duration), 0) ?? 0;
    if (length > 0) addTemplateMusic(p, t, 0, length);
    close();
    store.addTimeline(p);
    toast(`Template “${t.name}” opened as a new timeline. Edit anything you like.`, 'ok');
  }

  modal.append(
    h('div.modal-head', null, h('h2', null, t.name), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div.tpl-body', null,
      preview,
      h('div.tpl-side', null,
        h('div.tpl-info', null, `${t.ratio} · ${t.slots.length} clips · ${fmtTime(templateDuration(t))}`),
        h('div.section-label', null, 'Your clips'),
        slotsEl,
        h('div.tpl-side-head', null, h('div.section-label', null, 'Choose media'), h('button.ghost-btn', { type: 'button', onclick: autofill }, 'Auto-fill')),
        pickerEl,
      ),
    ),
    h('div.modal-foot', null, h('button.ghost-btn', { type: 'button', onclick: close }, 'Cancel'), useBtn),
  );
  render();
  document.body.append(backdrop);
  store.on('media', () => { if (backdrop.isConnected) render(); });
}

// ---- "Create template" ----------------------------------------------------------------------

/** A small WebP cover from the player's current frame (max 384 px on the long side). */
async function coverFromPlayer(player: Player): Promise<Blob | null> {
  try {
    player.draw(store.currentTime);
    const src = player.canvas;
    const k = Math.min(1, 384 / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * k));
    c.height = Math.max(1, Math.round(src.height * k));
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob(r, 'image/webp', 0.7));
  } catch { return null; }
}

/** Longest edit that can be saved as a template (the Worker checks this too). */
const MAX_TEMPLATE_SECONDS = 300;

/** Saves the current timeline's edit as a template (Templates › Yours). */
export async function openCreateTemplate(player: Player, after: () => void) {
  const main = store.project.tracks.find((t) => t.main);
  const clips = (main?.clips ?? []).filter((c) => c.type === 'video' || c.type === 'image').length;
  if (!clips) { toast('Add videos or photos to the main track first, then save the edit as a template.'); return; }
  const length = (main?.clips ?? []).reduce((n, c) => Math.max(n, c.start + c.duration), 0);
  if (length > MAX_TEMPLATE_SECONDS) { toast(`Templates can be at most 5 minutes. This edit is ${fmtTime(length)}; trim it first.`, 'error'); return; }
  const cover = await coverFromPlayer(player);
  const coverUrl = cover ? URL.createObjectURL(cover) : '';
  let category = TEMPLATE_CATEGORIES[0];
  const name = h('input.text-field', { value: store.projectTitle === 'Untitled project' ? '' : store.projectTitle, placeholder: 'Template name', maxlength: 60, 'aria-label': 'Template name' }) as HTMLInputElement;
  const saveBtn = h('button.primary-btn', { type: 'button' }, 'Save template') as HTMLButtonElement;
  // Weekly limit (checked again by the server): show what's left, block saving at 0.
  const quotaNote = h('p.hint.tpl-quota');
  void templateQuota().then((q) => {
    if (!q) return;
    quotaNote.textContent = q.left > 0 ? `${q.left} of ${q.perWeek} templates left this week.` : `You've created ${q.perWeek} templates this week. You can create more in a few days.`;
    if (q.left <= 0) saveBtn.disabled = true;
  });
  const close = () => { closePopover(); backdrop.remove(); if (coverUrl) URL.revokeObjectURL(coverUrl); };
  const backdrop = h('div.modal-backdrop', {
    onpointerdown: (e: Event) => { if (e.target === backdrop) close(); },
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && e.target === name) saveBtn.click(); },
  }, h('div.modal.small.tpl-create', { role: 'dialog', 'aria-label': 'Create template' },
    h('div.modal-head', null, h('h2', null, 'Create template'), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div.tpl-create-body', null,
      coverUrl ? h('img.tpl-create-cover', { src: coverUrl, alt: '' }) : null,
      h('div.tpl-create-fields', null,
        h('div.ex-field', null, h('label', null, 'Name'), name),
        h('div.ex-field', null, h('label', null, 'Category'), dropdown(category, TEMPLATE_CATEGORIES.map((c) => ({ id: c, name: c })), (v) => { category = v; })),
        h('p.hint', null, `Saves the edit (${clips} clip${clips > 1 ? 's' : ''}, timing, transitions, text, stickers and looks), not your videos. Anyone using it fills in their own clips.`),
        quotaNote)),
    h('div.modal-foot', null, h('button.ghost-btn', { type: 'button', onclick: close }, 'Cancel'), saveBtn)));
  saveBtn.addEventListener('click', async () => {
    const title = name.value.trim();
    if (!title) { name.focus(); toast('Give the template a name'); return; }
    const def = projectToTemplate(store.project, title, category);
    if (!def) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await saveMyTemplate(def, cover);
      toast(`Saved “${title}” to your templates`, 'ok');
      close();
      after();
    } catch (err) {
      toast(`Couldn't save the template: ${err instanceof Error ? err.message : String(err)}`, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save template';
    }
  });
  document.body.append(backdrop);
  name.focus();
}
